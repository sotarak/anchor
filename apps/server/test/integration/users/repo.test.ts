import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteUserGuarded, updateUserGuarded } from "#src/users/repo";
import { createUserWithSession, resetDb } from "#test/support";

beforeEach(resetDb);

const roleOf = async (id: string) =>
  (await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(id).first<{ role: string }>())
    ?.role;

describe("guarded user writes re-check the owner rule in SQL", () => {
  // The routes check the actor against a row read earlier; these guards close the race where the
  // target is promoted to owner between that read and the write.
  it("a non-owner actor cannot update an owner row or grant the owner role", async () => {
    await createUserWithSession({ role: "owner" });
    const target = await createUserWithSession({ role: "owner" });
    const member = await createUserWithSession({ role: "member" });
    const now = Date.now();
    const asAdmin = { actorIsOwner: false };
    expect(await updateUserGuarded(env.DB, target.userId, { role: "member" }, now, asAdmin)).toBe(
      "forbidden",
    );
    expect(await updateUserGuarded(env.DB, target.userId, { disabledAt: now }, now, asAdmin)).toBe(
      "forbidden",
    );
    expect(await updateUserGuarded(env.DB, member.userId, { role: "owner" }, now, asAdmin)).toBe(
      "forbidden",
    );
    expect(await updateUserGuarded(env.DB, member.userId, { role: "admin" }, now, asAdmin)).toBe(
      "ok",
    );
    expect(await roleOf(target.userId)).toBe("owner");
    expect(
      await updateUserGuarded(env.DB, target.userId, { role: "member" }, now, {
        actorIsOwner: true,
      }),
    ).toBe("ok");
  });

  it("a non-owner actor cannot delete an owner row", async () => {
    await createUserWithSession({ role: "owner" });
    const target = await createUserWithSession({ role: "owner" });
    expect(await deleteUserGuarded(env.DB, target.userId, { actorIsOwner: false })).toBe(
      "forbidden",
    );
    expect(await roleOf(target.userId)).toBe("owner");
    expect(await deleteUserGuarded(env.DB, target.userId, { actorIsOwner: true })).toBe("ok");
  });
});
