import type { ReactNode } from "react";
import { RiAnchorLine } from "react-icons/ri";

/**
 * Public pages (setup, login, invite, reset). The centered panel is the one sanctioned card
 * outside templates and empty states: there is no app shell to anchor a signed-out page.
 */
export function AuthLayout({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg-weak p-4">
      <div className="flex w-full max-w-sm flex-col gap-5 rounded-xl border bg-bg-white p-6 shadow-xs">
        <div className="flex flex-col gap-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-bg-strong text-white [&_svg]:size-4">
            <RiAnchorLine />
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="text-label-md text-text-strong">{title}</h1>
            {description ? <p className="text-paragraph-sm text-text-sub">{description}</p> : null}
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
