import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Who is allowed to say that a person clicked.
 *
 * `via: "direct"` on an approval is the strongest claim anything in this product makes: not that an agent
 * reported a conversation, but that the daemon received the click itself — over loopback, with its own token,
 * from the page it served. Every other approval is `relayed`, which is a language model's account of what
 * somebody said, and an agent that never asked writes a byte-identical event (ADR 0020).
 *
 * That distinction is worth exactly as much as the number of places that can write it. One place can be read and
 * reasoned about; a second one added later, by someone who saw the first and copied it, quietly turns the
 * strongest evidence in the ledger into the weakest — and nothing would fail. This test is the thing that fails.
 *
 * It is deliberately a source check rather than a behaviour check. There is no input that makes a wrongly-written
 * `direct` observable: the event looks right, the gate accepts it, the history reads as though a person acted.
 * The only moment it can be caught is the moment it is written.
 */

const SOURCE = new URL("../src/", import.meta.url).pathname;

/** The one file that receives a real click, and may therefore say so. */
const ALLOWED = "api/server.ts";

function sourceFiles(directory: string, prefix = ""): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) return sourceFiles(full, `${prefix}${name}/`);
    return name.endsWith(".ts") ? [`${prefix}${name}`] : [];
  });
}

describe("claiming that a person approved", () => {
  it("is written in exactly one file, the one that receives the click", () => {
    /*
     * Any quote style, because the first version of this matched double quotes only — and a cold reader refuted
     * it in a minute by pointing out that `via: 'direct'` walks straight past. Prettier would have rewritten
     * that eventually, which is not the same as the guard holding.
     *
     * A value reached indirectly — `via: DIRECT`, a variable, a template with a hole in it — still escapes, and
     * no source check can close that. This raises the cost of adding a second writer by accident; it cannot stop
     * someone determined to add one on purpose.
     */
    const claimants = sourceFiles(SOURCE).filter((file) =>
      /via:\s*["'`]direct["'`]/.test(readFileSync(join(SOURCE, file), "utf8")),
    );

    expect(claimants).toEqual([ALLOWED]);
  });

  it("is written by the route that answers a browser, not by anything a tool can reach", () => {
    const server = readFileSync(join(SOURCE, ALLOWED), "utf8");
    const approve = /async function approve\([\s\S]*?\n}/.exec(server)?.[0] ?? "";

    // Inside `approve`, which is only reachable through POST /approve — past the Origin and token checks.
    expect(approve).toContain('via: "direct"');
  });
});
