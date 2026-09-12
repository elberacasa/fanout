import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { staysInside } from "../src/gate/isolate.ts";

/*
 * The containment boundary, tested directly.
 *
 * A cold reader refuted the claim that nothing could escape the review copy, and the attack needed two halves:
 * a link chain whose `..` segments a lexical resolver folds away, *and* a decoy file sitting at the path that
 * folding produces. Without the decoy the lexical resolver throws and the link is cut for the wrong reason —
 * which is exactly how the first version of this test passed while the code was still wrong.
 */

let base: string;
let copy: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "fanout-links-"));
  copy = join(base, "copy");
  mkdirSync(copy);
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("staysInside", () => {
  it("accepts a link to a file inside the copy", () => {
    writeFileSync(join(copy, "real.txt"), "ok\n");
    symlinkSync("real.txt", join(copy, "alias"));
    expect(staysInside(copy, join(copy, "alias"))).toBe(true);
  });

  it("accepts a link to the copy's own root", () => {
    symlinkSync(".", join(copy, "here"));
    expect(staysInside(copy, join(copy, "here"))).toBe(true);
  });

  it("rejects a link straight out of the copy", () => {
    writeFileSync(join(base, "secret.txt"), "TOKEN\n");
    symlinkSync(join(base, "secret.txt"), join(copy, "leak"));
    expect(staysInside(copy, join(copy, "leak"))).toBe(false);
  });

  /*
   * The one that matters, and the one a lexical resolver gets wrong. `a` points at the copy root, so the kernel
   * follows it there and `..` then lands in the parent — while Node's JavaScript `realpathSync` folds `a/..` away
   * as text and answers `<copy>/secret.txt`, which the decoy makes a real, containable-looking path.
   */
  it("rejects a chain whose escape only the operating system can see", () => {
    writeFileSync(join(base, "secret.txt"), "THE REAL SECRET\n");
    writeFileSync(join(copy, "secret.txt"), "DECOY\n");
    symlinkSync(".", join(copy, "a"));
    symlinkSync("a/../secret.txt", join(copy, "leak"));

    expect(staysInside(copy, join(copy, "leak"))).toBe(false);
  });

  it("rejects a link that leads nowhere", () => {
    symlinkSync("missing.txt", join(copy, "dangling"));
    expect(staysInside(copy, join(copy, "dangling"))).toBe(false);
  });

  it("rejects a link that loops back on itself", () => {
    symlinkSync("loop", join(copy, "loop"));
    expect(staysInside(copy, join(copy, "loop"))).toBe(false);
  });
});
