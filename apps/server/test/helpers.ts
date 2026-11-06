import { exports } from "cloudflare:workers";

export const TEST_ORIGIN = "http://anchor.test";

export function api(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(TEST_ORIGIN + path, init));
}
