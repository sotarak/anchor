import { describe, expect, it } from "vitest";
import { rateLimitKey } from "#src/lib/ip";

describe("rateLimitKey", () => {
  it.each([
    ["1.2.3.4", "1.2.3.4"],
    ["::ffff:1.2.3.4", "1.2.3.4"],
    ["::FFFF:1.2.3.4", "1.2.3.4"],
    ["2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64"],
    ["2001:0DB8:0001:0002::1", "2001:db8:1:2::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["not-an-ip", "not-an-ip"],
  ])("%s → %s", (input, key) => {
    expect(rateLimitKey(input)).toBe(key);
  });

  it("null stays null", () => expect(rateLimitKey(null)).toBeNull());
});
