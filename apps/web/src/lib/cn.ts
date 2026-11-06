import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** The token type scale: `text-label-sm` etc. are font sizes, so they must not drop colors. */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: [(v: string) => /^(label|paragraph|subheading)-(2xs|xs|sm|md|lg)$/.test(v)] },
        "text-code-xs",
        "text-code-2xs",
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
