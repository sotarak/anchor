import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QrCode } from "@/components/qr-code";

const URI = "otpauth://totp/Anchor:dev%40example.io?secret=JBSWY3DPEHPK3PXP&issuer=Anchor";

describe("QrCode", () => {
  it("renders one svg path and no foreign content", () => {
    const { container } = render(<QrCode value={URI} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.querySelectorAll("path")).toHaveLength(1);
    expect(svg?.querySelector("foreignObject")).toBeNull();
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("QR code");
  });

  it("draws different modules for different values", () => {
    const a = render(<QrCode value={URI} />)
      .container.querySelector("path")
      ?.getAttribute("d");
    const b = render(<QrCode value={`${URI}x`} />)
      .container.querySelector("path")
      ?.getAttribute("d");
    expect(a).toMatch(/^M\d+ \d+h1v1h-1z/);
    expect(a).not.toBe(b);
  });
});
