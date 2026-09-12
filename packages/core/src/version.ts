import { readFileSync } from "node:fs";

/*
 * What version of Fanout this actually is.
 *
 * Read from the package that is running, never written down twice. Two hand-maintained strings had already drifted
 * apart from the packages they named and from each other — the CLI said 0.5.0-dev and the MCP server said
 * 0.6.0-dev while both shipped from 0.7.0 — which is a small lie until someone reports a bug against a version
 * that never existed.
 */

/**
 * The version in a package's own `package.json`, given any file inside that package.
 *
 * Pass `import.meta.url` from the caller. It walks up looking for the manifest, which is what makes it work
 * identically from `src/main.ts` in a checkout and from `dist/main.js` inside `node_modules`.
 */
export function versionOf(fromUrl: string): string {
  let directory = new URL(".", fromUrl);
  for (let depth = 0; depth < 8; depth++) {
    try {
      const text = readFileSync(new URL("package.json", directory), "utf8");
      const parsed: unknown = JSON.parse(text);
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === "string") return version;
    } catch {
      // Not this directory. Keep walking up until the package root or we run out of patience.
    }
    const parent = new URL("..", directory);
    if (parent.href === directory.href) break;
    directory = parent;
  }
  // Saying so beats inventing a number: an unknown version is a fact, and a wrong one sends someone hunting.
  return "unknown";
}
