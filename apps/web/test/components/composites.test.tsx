import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { FilterChip } from "@/components/data/filter-chip";
import { SearchChip } from "@/components/data/search-chip";
import { TableFooter } from "@/components/data/table-footer";
import { ConfirmDialog } from "@/components/overlays/confirm-dialog";
import { OneTimeSecretDialog } from "@/components/overlays/one-time-secret-dialog";
import { MaskedValue } from "@/components/secrets/masked-value";
import { Toaster } from "@/components/ui/sonner";

const VALUE = "s3cr3t-COMPOSITE";

function StatusFilter({ initial = [] as string[] }) {
  const [value, setValue] = useState(initial);
  return (
    <FilterChip
      label="Status"
      options={[
        { value: "active", label: "Active" },
        { value: "revoked", label: "Revoked" },
        { value: "expired", label: "Expired" },
      ]}
      value={value}
      onChange={setValue}
    />
  );
}

function Search() {
  const [q, setQ] = useState("");
  return <SearchChip value={q} onChange={setQ} placeholder="Search keys" />;
}

describe("MaskedValue", () => {
  it("masked value hides text until reveal and re-masks on toggle", async () => {
    const user = userEvent.setup();
    const reveal = vi.fn().mockResolvedValue(VALUE);
    render(<MaskedValue reveal={reveal} />);
    expect(screen.getByText("••••••••")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(VALUE);
    await user.click(screen.getByRole("button", { name: "Reveal value" }));
    expect(await screen.findByText(VALUE)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide value" }));
    expect(document.body.textContent).not.toContain(VALUE);
    expect(screen.getByText("••••••••")).toBeInTheDocument();
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it("copy writes to clipboard and shows Copied toast", async () => {
    const user = userEvent.setup();
    const reveal = vi.fn().mockResolvedValue(VALUE);
    render(
      <>
        <MaskedValue reveal={reveal} />
        <Toaster />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Copy value" }));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(VALUE);
    // Copying does not reveal the value on screen.
    expect(screen.queryByText(VALUE)).toBeNull();
  });
});

describe("OneTimeSecretDialog", () => {
  it("one-time dialog ignores Escape and outside click; closes only via the done button", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(
      <OneTimeSecretDialog
        open
        title="Copy your service token"
        label="ci-deploy"
        value="anc_st_TOKENVALUE"
        notice="This token is shown once."
        onDone={onDone}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Copy your service token" });
    await user.keyboard("{Escape}");
    // A modal Radix dialog sets pointer-events: none on the body; an outside click is a
    // pointerdown on the overlay.
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).not.toBeNull();
    fireEvent.pointerDown(overlay as Element);
    fireEvent.click(overlay as Element);
    expect(dialog).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(screen.getByText("anc_st_TOKENVALUE")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "I've copied it" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("ConfirmDialog", () => {
  it("confirm dialog calls onConfirm and disables the button while pending", async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete secret API_KEY"
        description="This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={onConfirm}
      />,
    );
    const confirm = screen.getByRole("button", { name: "Delete" });
    expect(confirm.className).toContain("bg-error-base");
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    finish();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe("filters", () => {
  it("filter chip shows the active value and clears", async () => {
    const user = userEvent.setup();
    render(<StatusFilter />);
    await user.click(screen.getByRole("button", { name: "Status" }));
    await user.click(screen.getByRole("checkbox", { name: "Active" }));
    await user.click(screen.getByRole("checkbox", { name: "Revoked" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Status: Active +1" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear Status" }));
    expect(screen.getByRole("button", { name: "Status" })).toBeInTheDocument();
  });

  it('search chip turns into an input and focuses on "/"', async () => {
    const user = userEvent.setup();
    render(<Search />);
    expect(screen.queryByRole("searchbox")).toBeNull();
    await user.keyboard("/");
    const box = screen.getByRole("searchbox", { name: "Search keys" });
    expect(box).toHaveFocus();
    await user.type(box, "api");
    expect(box).toHaveValue("api");
    // "/" typed inside the field is text, not the shortcut.
    await user.type(box, "/x");
    expect(box).toHaveValue("api/x");
  });
});

describe("TableFooter", () => {
  it('table footer renders "N results" and disables prev on the first page', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(
      <TableFooter
        total={12}
        canPrev={false}
        canNext
        onPrev={() => {}}
        onNext={onNext}
        pageSize={10}
        pageSizes={[10, 25, 50]}
        onPageSize={() => {}}
      />,
    );
    expect(screen.getByText("12 results")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(onNext).toHaveBeenCalled();
    expect(screen.getByText("10 / page")).toBeInTheDocument();
  });

  it('renders "N shown" when the total is unknown', () => {
    render(
      <TableFooter
        total={null}
        shown={7}
        canPrev
        canNext={false}
        onPrev={() => {}}
        onNext={() => {}}
        pageSize={50}
        pageSizes={[25, 50, 100]}
        onPageSize={() => {}}
      />,
    );
    expect(screen.getByText("7 shown")).toBeInTheDocument();
  });
});
