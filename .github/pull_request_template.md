## What this changes

<!-- One paragraph: the behaviour before, the behaviour after, and why. -->

## Proof

<!-- Test counts, and for a bug fix: the test that fails on the old code. Say plainly what you could not verify. -->

## Checklist

- [ ] `npm run check` passes locally (typecheck, lint, tests)
- [ ] Each commit is one idea, green on its own, and follows [docs/COMMITS.md](../docs/COMMITS.md)
- [ ] A bug fix ships with a test that fails on the old code
- [ ] Docs changed in the same commit as the behaviour they describe
- [ ] No credentials, private code or customer data in code, fixtures, prompts or messages
- [ ] Isolation kept: agents get no secrets, never commit, and stay inside their declared scope
- [ ] If an agent wrote part of this: `Built-by:` trailer, and `docs/BUILD_LOG.md` says what review changed

## Related

<!-- Refs: #123 -->
