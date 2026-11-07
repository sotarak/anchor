import { type ReactNode, useState } from "react";
import { Header, type HeaderState, SetHeaderContext } from "./header";
import { Sidebar } from "./sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const [header, setHeader] = useState<HeaderState>({ title: null });
  return (
    <SetHeaderContext.Provider value={setHeader}>
      <div className="flex h-dvh w-full bg-bg-white">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header title={header.title} parent={header.parent} actions={header.actions} />
          <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">{children}</main>
        </div>
      </div>
    </SetHeaderContext.Provider>
  );
}
