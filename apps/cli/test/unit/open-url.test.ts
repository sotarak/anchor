import { describe, expect, it } from "vitest";
import type { Spawner } from "#src/context";
import { openUrl } from "#src/open-url";

function spawner(code = 0) {
  const calls: [string, string[]][] = [];
  const spawn: Spawner = async (cmd, args) => {
    calls.push([cmd, args]);
    return { code, stdout: "", stderr: "" };
  };
  return { spawn, calls };
}
const URL = "https://anchor.example/cli/login?code=WDJB-MJHT";

describe("openUrl", () => {
  it("uses the platform opener with the URL as one argument", async () => {
    const cases: [NodeJS.Platform, [string, string[]]][] = [
      ["darwin", ["open", [URL]]],
      ["linux", ["xdg-open", [URL]]],
      ["win32", ["cmd", ["/c", "start", "", URL]]],
    ];
    for (const [platform, expected] of cases) {
      const s = spawner();
      expect(await openUrl(URL, platform, s.spawn)).toBe(true);
      expect(s.calls).toEqual([expected]);
    }
  });

  it("refuses anything but http(s) URLs", async () => {
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "not a url"]) {
      const s = spawner();
      expect(await openUrl(url, "darwin", s.spawn)).toBe(false);
      expect(s.calls).toEqual([]);
    }
  });

  it("a non-zero exit or a spawn failure is false", async () => {
    expect(await openUrl(URL, "linux", spawner(3).spawn)).toBe(false);
    const throwing: Spawner = async () => {
      throw new Error("ENOENT");
    };
    expect(await openUrl(URL, "linux", throwing)).toBe(false);
  });
});
