# Debug run: 17 September 2026

An end-to-end check of the repo against the "safe to inherit, easy to debug, safe to re-run" bar in `CLAUDE.md`, run after Phase 4 closed. Goal was to verify claims already made in `rules.md`, `decisions.md` and `test/results.md`, not to re-derive them: read every doc, traced the Code node sources against `rules.md` line by line, ran `workflow/simulate.mjs` and inspected the generated workflow JSON directly rather than trusting the prose about it.

No outcome in the Phase 4 oracle changed. The live `test/results.md` (11/11 on the evaluated set, run against the real n8n Cloud deployment) stands as recorded; none of the fixes below touch the logic that produced those results.

## Method

1. Read `CLAUDE.md`, `rules.md`, `decisions.md` in full.
2. Read every file in `workflow/code/` and checked each guard, filter step, rank rule and sequence against the matching row in `rules.md`.
3. Ran `node workflow/simulate.mjs` (offline, against the Phase 1 dumps, no network calls) and compared its verdict to `rules.md`'s "Expected outcomes" tables by hand.
4. Inspected `workflow/nous-mso-mobile-recommendation.json` directly with small Node scripts: HTTP node retry settings, `onError` wiring, and the connection graph around the error-handling nodes, to check the claims in `decisions.md` items 22 and 23 against the actual generated JSON rather than the description of it.
5. Read `test/harness.mjs`, `probe/mutate.mjs` and `probe/reset.mjs` for how they protect the one-shot evaluated tickets from an accidental second write.

## Findings and fixes

### 1. `workflow/simulate.mjs`: oracle table silently missing 4 entries (fixed)

**What was wrong.** Line 149 had a trailing `//` comment on ticket 20's entry. In JavaScript a `//` comment runs to the end of the physical line, and the entries for tickets 21 to 24 had been typed after that comment on the same line:

```js
20: [...], // dump predates the Phase 1 mutation; ... here. 21: [...], 22: [...], 23: [...], 24: [...],
```

Everything after `//` was dead text. `EXPECTED[21]` through `EXPECTED[24]` were `undefined`.

**Effect.** Running `node workflow/simulate.mjs` reported those four tickets as `FAIL`, even though their computed stage, status and note matched `rules.md`'s sandbox table exactly. Confirmed by evaluating the object literal directly: `Object.keys(EXPECTED)` stopped at `20`. The "24/24 pass" claim in `decisions.md` (Phase 3) was true when it was last actually run clean, but the tool as it stood would no longer reproduce that result. A false failure like this is worse than a crash: it trains a reader to expect and discount 4 failures on every run, which is exactly the run that would hide a real regression in those four tickets.

**Fix.** Moved the comment to its own line above ticket 20's entry, so the object literal is no longer truncated:

```js
// 20: dump predates the Phase 1 mutation; live, 020 exits at I1b. Not in the poll list, so stays Waiting here.
18: ['446512118', 'completed'], 19: ['446512118', 'completed'], 20: ['5060559097', 'waiting'],
21: ['446512118', 'completed'], 22: ['446512118', 'completed'], 23: ['440806104', 'manual'], 24: ['446512118', 'completed'],
```

**Verified.** `node workflow/simulate.mjs` now prints `All tickets match rules.md` (24/24), rerun after every subsequent change in this pass to confirm no regression.

### 2. Guard I0 existed in code but nowhere in the docs (fixed)

**What was wrong.** `workflow/code/intake-guards.js` checks `!ctx.householdId || !ctx.userId` before I1a and routes to Manual as shape `I0`. It is real and load-bearing: it is what actually backs the sentence in `rules.md`'s Triggers section, "A Waiting ticket missing any stored property goes to Manual." But `rules.md`'s "Guards, in order" table started at I1a, and I0 appeared in no other doc. `CLAUDE.md` tells a reader to treat `rules.md` as the source of truth before touching the code; a reader who did that would meet a guard the spec never mentioned.

**Fix.**
- Added an `I0` row to the guard table in `rules.md`, with the check, outcome and note text taken from the actual code (no Slack, matching the code).
- Replaced the vague "waiting ticket without stored input" reference in the Triggers section with a pointer to the new I0 row.
- Logged it in `decisions.md` under "Added by interpretation" (item 24) so its provenance is recorded like every other guard.

No logic changed. This was a documentation gap, not a bug: the guard already behaved correctly, it just wasn't written down anywhere a reviewer would find it.

### 3. `probe/reset.mjs` defaulted to a live write (fixed)

**What was wrong.** `node probe/reset.mjs` with no arguments ran in LIVE mode and immediately PATCHed all 11 evaluated tickets back to their starting properties. `--dry-run` was opt-in. The evaluated tickets are one-shot and, per `CLAUDE.md`, a reset requires asking Nous, so a bare invocation (a fat-fingered command, a copy-paste without the flag, a future run from muscle memory) had no guard rail.

**Fix.** Flipped the default: no flag or `--dry-run` now previews only; `--live` is required to write. A bare invocation now prints "No flag given: defaulting to --dry-run" instead of writing.

**Verified.** Checked the flag-parsing logic in isolation (`process.argv` with no flag resolves `DRY_RUN: true, LIVE: false`; with `--live` resolves the opposite). Did not run the script live against the mock, since the evaluated tickets are already spent for this exercise and there is nothing to gain from writing to them again.

### 4. `build-manual.js`: one unguarded path to a silent crash (fixed)

**What was wrong.** `workflow/code/unhandled-error.js` has a defensive fallback: if `$('Config').item.json` fails to resolve through n8n's paired-item chain, it falls back to `ctx = $json`, which may carry no `cfg`. The node it hands off to, `build-manual.js`, read `j.cfg.stages.manual` unconditionally, with no check. `Build manual` is deliberately not wired back to `Unhandled error` (documented in `decisions.md` item 23, to avoid a loop). So the combination of "paired-item resolution to Config fails" and "the item reaches Build manual" would have thrown inside a node with nowhere for the error to go: no ticket write, no Slack alert, execution just stops red in the editor. That is the one path in the whole build that could have contradicted the workflow's own engineering bar, item 4: "no silent exceptions."

This is a low-probability edge case. It requires the paired-item fallback in `unhandled-error.js` to actually fire, which is presumably rare enough that it was written as a defensive `try/catch` rather than assumed never to happen. But a defensive fallback that itself has no fallback isn't finished.

**Fix.** `build-manual.js` now falls back to the known Manual stage ID (`440806104`) and the known attempts property name (`automation_attempts`) if `j.cfg` is missing, and appends a flag to the written note (`[cfg missing on this item; stage ID hardcoded as a fallback, check Unhandled error upstream]`) so a human sees it happened. The ticket still moves to Manual and still gets a note either way; it no longer depends on `cfg` surviving every hop.

**Verified.** Rebuilt the workflow JSON (`node workflow/build.mjs`) from the updated Code sources and re-ran `node workflow/simulate.mjs`: 24/24 still pass, confirming the change didn't alter behaviour on any path that was actually exercised (the fallback only engages when `cfg` is absent, which none of the 24 dumps trigger).

## What was checked and left alone

- HTTP node retry settings and `onError` wiring in the generated JSON were checked against `decisions.md` items 22 and 23 directly (not just read as prose) and found to match exactly: all fallible HTTP nodes retry 4x at 2s except `POST recommendation` and `POST WhatsApp`; `GET ticket (poll)` drops a failed item with no error-output wiring; `Slack: info` has no error output; `Unhandled error` and `Build manual` are not wired back to themselves. No changes needed.
- `test/harness.mjs`'s one-shot guard (refuses to re-fire a ticket with an existing result file unless `FORCE=1`) and `probe/mutate.mjs`'s hardcoded ticket-ID allowlist were read and are sound. No changes needed.
- Open, undecided items already flagged honestly in `decisions.md` ("Flagged, not applied" and "Open questions for onsite") were left untouched. They're judgement calls for the onsite, not bugs.

## Files touched

| File | Change |
|---|---|
| `workflow/simulate.mjs` | Moved a trailing comment so the EXPECTED oracle for tickets 21 to 24 is no longer swallowed |
| `rules.md` | Added the I0 guard row; pointed the Triggers section at it |
| `decisions.md` | Logged I0 as item 24; logged this debug pass as items 24 to 27 |
| `probe/reset.mjs` | Default flipped from LIVE to `--dry-run`; `--live` now required to write |
| `workflow/code/build-manual.js` | Added a fallback for a missing `cfg` so the node can't crash silently |
| `workflow/04-outcome-branches.json`, `workflow/05-error-handling.json`, `workflow/nous-mso-mobile-recommendation.json` | Regenerated by `node workflow/build.mjs` to pick up the `build-manual.js` change |

## Verification run

```
node workflow/build.mjs        # regenerate JSON from Code sources
node workflow/simulate.mjs     # 24/24 pass
```

No live calls were made against the mock API during this pass. The evaluated tickets (001 to 011) were not touched and remain in the terminal state Phase 4 left them in.
