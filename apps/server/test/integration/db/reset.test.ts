import { describe, expect, it } from "vitest";
import { listAppTables, TABLES_CHILD_FIRST } from "#test/support";

describe("resetDb", () => {
  it("covers every table the migrations create", async () => {
    expect([...TABLES_CHILD_FIRST].sort()).toEqual(await listAppTables());
  });
});
