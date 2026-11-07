import type { SecretDto, SecretValueType } from "@anchor/shared";
import { expect, it } from "vitest";
import type { AnchorSecret } from "../../src/index";

// Compile-time drift checks, enforced by `pnpm typecheck`: a revealed SecretDto must be an
// AnchorSecret, and the SDK's value types must be exactly the server's.
type Revealed = SecretDto & { value: string };
const fromServer = (s: Revealed): AnchorSecret => s;
type SameTypes = [SecretValueType] extends [AnchorSecret["type"]]
  ? [AnchorSecret["type"]] extends [SecretValueType]
    ? true
    : false
  : false;
const sameTypes: SameTypes = true;

it("keeps AnchorSecret in step with the server's SecretDto", () => {
  expect(typeof fromServer).toBe("function");
  expect(sameTypes).toBe(true);
});
