import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("runtime", () => {
  it("provides node:sqlite without flags (Node 22.13+)", () => {
    const db = new DatabaseSync(":memory:");
    const row = db.prepare("SELECT sqlite_version() AS version").get();
    db.close();
    expect(row).toHaveProperty("version");
  });
});
