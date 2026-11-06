import { CliError, EXIT } from "../errors";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Returns the URL's origin. Requires https:, except for loopback hosts. */
export function normalizeApiUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new CliError(EXIT.USAGE, `Invalid API URL: ${input}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new CliError(EXIT.USAGE, `Invalid API URL: ${input}`);
  }
  if (url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname)) {
    throw new CliError(
      EXIT.USAGE,
      `Refusing to use insecure http:// API URL ${url.origin}`,
      "Use https://",
    );
  }
  return url.origin;
}
