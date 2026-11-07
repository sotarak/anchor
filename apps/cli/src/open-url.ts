import type { Spawner } from "./context";

/**
 * Opens an http(s) URL in the default browser. The URL is passed as one argument, never through
 * a shell. Any failure is false: the caller has already printed the URL.
 */
export async function openUrl(
  url: string,
  platform: NodeJS.Platform,
  spawner: Spawner,
): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const [cmd, args]: [string, string[]] =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? // `start` treats its first quoted argument as the window title, hence the empty one.
          ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    return (await spawner(cmd, args)).code === 0;
  } catch {
    return false;
  }
}
