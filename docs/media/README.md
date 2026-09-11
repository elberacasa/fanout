# Media

Screenshots and recordings of Fanout actually working. Nothing here is a mockup: if an image shows a number, a
diff or a run, it came from a real run, and the caption says which build produced it.

## What goes here, and when

| File | Shows | Lands with |
|---|---|---|
| `demo.gif` | The 30-second story: one prompt, a plan, four vendors building in parallel, reviews, proof, merge | P0 · 10 |
| `mission-view.png` | The live mission view: lanes, phase bars, tool ticker, diff peek, review queue | P0 · 8 |
| `crew-check.png` | The crew as detected on a real machine, with versions and sign-in state | P0 · 6 |
| `merge-gate.png` | A merge decision: review, checks, proof that the new test fails on the old code | P0 · 7 |

## Rules

- **Real runs only.** No mockups, no staged numbers. A recording that is sped up says so on screen.
- **Nothing private.** Record against a sample repository, never a customer's. Check every visible path, prompt,
  file name and diff before committing.
- **Readable small.** The GIF must be legible at the width GitHub renders a README image (about 900 px).
- **Keep them light.** Under 8 MB for a GIF, under 500 KB for a PNG, so cloning stays fast.
- **Caption the build.** Record the commit or tag in the README caption, so an old image is obviously old.
