import { encode } from "uqr";

const QUIET_ZONE = 2;

/**
 * A QR code drawn as one SVG path, built in React from uqr's module matrix: no generated markup
 * is injected, so the encoded value (a TOTP secret) never becomes HTML.
 */
export function QrCode({ value, size = 176 }: { value: string; size?: number }) {
  const { data } = encode(value, { border: 0 });
  let d = "";
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
    });
  });
  const extent = data.length + QUIET_ZONE * 2;
  return (
    <svg
      role="img"
      aria-label="QR code"
      width={size}
      height={size}
      viewBox={`0 0 ${extent} ${extent}`}
      shapeRendering="crispEdges"
      className="rounded-lg bg-bg-white text-text-strong ring-1 ring-stroke-soft"
    >
      <path d={d} fill="currentColor" />
    </svg>
  );
}
