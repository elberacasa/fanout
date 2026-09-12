import { readFileSync } from "node:fs";

/*
 * The mission view's page, read from disk beside this file.
 *
 * It is one self-contained HTML file with no framework, no bundler and no dependencies (ADR 0019), because this
 * page renders your private source code and every dependency it carried would be one more thing that could read
 * it. Kept as `.html` rather than a template string so it stays a file a person can open, lint and read.
 *
 * Read on every request rather than cached. It is a few kilobytes off a local disk for a page only this machine
 * can reach, and caching it meant an edit did nothing until the daemon was restarted — which is how the first
 * version of this was reviewed against a screen that had not changed.
 */

/** The page, with `{{TOKEN}}` still in it: the daemon stamps its own token in as it serves. */
export function missionViewHtml(): string {
  return readFileSync(new URL("./view.html", import.meta.url), "utf8");
}
