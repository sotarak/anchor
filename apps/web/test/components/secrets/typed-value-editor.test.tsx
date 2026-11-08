import type { SecretValueType } from "@anchor/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TypedValueEditor } from "@/components/secrets/typed-value-editor";

function Harness({
  type,
  initial,
  onChange,
}: {
  type: SecretValueType;
  initial: string;
  onChange: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="v">Value</label>
      <TypedValueEditor
        id="v"
        type={type}
        value={value}
        onChange={(v) => {
          onChange(v);
          setValue(v);
        }}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

/** Renders the editor with real state and records every emitted value. */
function setup(type: SecretValueType, initial = "") {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<Harness type={type} initial={initial} onChange={onChange} />);
  return { user, onChange, value: () => screen.getByTestId("value").textContent };
}

describe("TypedValueEditor", () => {
  it("text grows from one line", async () => {
    const { user, onChange } = setup("string");
    const box = screen.getByLabelText("Value");
    expect(box.tagName).toBe("TEXTAREA");
    expect(box).toHaveAttribute("rows", "1");
    await user.type(box, "hello");
    expect(onChange).toHaveBeenLastCalledWith("hello");
    await user.type(box, "{Enter}world");
    expect(box).toHaveAttribute("rows", "2");
  });

  it("number uses a decimal keypad", async () => {
    const { user, onChange } = setup("number");
    const input = screen.getByLabelText("Value");
    expect(input).toHaveAttribute("inputmode", "decimal");
    await user.type(input, "0.25");
    expect(onChange).toHaveBeenLastCalledWith("0.25");
  });

  it("boolean starts with nothing selected and emits true/false", async () => {
    const { user, onChange } = setup("boolean");
    const options = screen.getAllByRole("radio");
    expect(options.map((o) => o.textContent)).toEqual(["true", "false"]);
    for (const o of options) expect(o).toHaveAttribute("aria-checked", "false");
    await user.click(screen.getByRole("radio", { name: "false" }));
    expect(onChange).toHaveBeenLastCalledWith("false");
    expect(screen.getByRole("radio", { name: "false" })).toHaveAttribute("aria-checked", "true");
  });

  it("boolean opened on stored true selects it", () => {
    setup("boolean", "true");
    expect(screen.getByRole("radio", { name: "true" })).toHaveAttribute("aria-checked", "true");
  });

  it("json Format pretty-prints valid JSON and leaves invalid JSON alone", async () => {
    const { user, value } = setup("json", '{"a":[1]}');
    await user.click(screen.getByRole("button", { name: "Format" }));
    expect(value()).toBe('{\n  "a": [\n    1\n  ]\n}');
    const box = screen.getByLabelText("Value");
    await user.clear(box);
    await user.type(box, "{{");
    await user.click(screen.getByRole("button", { name: "Format" }));
    expect(value()).toBe("{");
  });

  it("list: add, edit, remove; Enter adds a row; paste of 3 lines makes 3 items", async () => {
    const { user, value } = setup("list");
    await user.type(screen.getByRole("textbox", { name: "Item 1" }), "a{Enter}b");
    expect(screen.getByRole("textbox", { name: "Item 2" })).toHaveFocus();
    expect(value()).toBe('["a","b"]');
    await user.click(screen.getByRole("button", { name: "Add item" }));
    await user.click(screen.getByRole("textbox", { name: "Item 3" }));
    await user.paste("x\r\ny\n\nz");
    expect(value()).toBe('["a","b","x","y","z"]');
    await user.click(screen.getByRole("button", { name: "Remove item 2" }));
    expect(value()).toBe('["a","x","y","z"]');
    expect(screen.getAllByRole("textbox").map((t) => (t as HTMLInputElement).value)).toEqual([
      "a",
      "x",
      "y",
      "z",
    ]);
  });

  it("list drops blank rows from the stored value", async () => {
    const { user, value } = setup("list");
    await user.type(screen.getByRole("textbox", { name: "Item 1" }), "a");
    await user.click(screen.getByRole("button", { name: "Add item" }));
    await user.type(screen.getByRole("textbox", { name: "Item 2" }), "   ");
    expect(value()).toBe('["a"]');
  });

  it("list opened on stored text keeps that text until an item changes", async () => {
    const { user, onChange } = setup("list", '["a", "b"]');
    const first = screen.getByRole("textbox", { name: "Item 1" });
    expect(first).toHaveValue("a");
    expect(screen.getByRole("textbox", { name: "Item 2" })).toHaveValue("b");
    expect(onChange).not.toHaveBeenCalled();
    await user.type(first, "2");
    expect(onChange).toHaveBeenLastCalledWith('["a2","b"]');
  });

  it("list opened on plain text stores its lines as a JSON array once", () => {
    const { onChange, value } = setup("list", "a\r\n\nb");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(value()).toBe('["a","b"]');
  });

  it("list opened on JSON that is not a string array stores it as one item", () => {
    const { value } = setup("list", "[1, 2]");
    expect(screen.getByRole("textbox", { name: "Item 1" })).toHaveValue("[1, 2]");
    expect(value()).toBe('["[1, 2]"]');
  });

  it("list opened empty emits nothing", () => {
    const { onChange } = setup("list", "");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("pem Load from file reads the file and shows the detected block", async () => {
    const { user, onChange } = setup("pem");
    const pem = "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n";
    await user.upload(screen.getByLabelText("PEM file"), new File([pem], "key.pem"));
    expect(await screen.findByText("Detected: PRIVATE KEY")).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(pem);
    expect(screen.getByRole("button", { name: "Load from file" })).toBeInTheDocument();
  });

  it("pem a binary file loads as text without throwing", async () => {
    const { user, onChange } = setup("pem");
    await user.upload(
      screen.getByLabelText("PEM file"),
      new File([new Uint8Array([0x30, 0x82, 0x01])], "cert.cer"),
    );
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(screen.queryByText(/^Detected:/)).toBeNull();
  });

  it("blur reaches the caller once focus leaves a list", async () => {
    const onBlur = vi.fn();
    render(
      <>
        <TypedValueEditor id="v" type="list" value="" onChange={() => {}} onBlur={onBlur} />
        <button type="button">outside</button>
      </>,
    );
    const first = screen.getByRole("textbox", { name: "Item 1" });
    fireEvent.focus(first);
    fireEvent.blur(first, { relatedTarget: screen.getByRole("button", { name: "Add item" }) });
    expect(onBlur).not.toHaveBeenCalled();
    fireEvent.blur(first, { relatedTarget: screen.getByRole("button", { name: "outside" }) });
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});
