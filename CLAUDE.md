# Nous case study: Claude Code handoff

## What this is

I'm Saffron, a candidate for the Operations & Automation Associate role at Nous, a UK AI-powered household bill-switching startup. This repo is my take-home case study: build a single n8n workflow that takes a HubSpot ticket from a webhook and runs the MSO team's mobile recommendation job end to end. Deadline is Friday 18 September 2026. The final round is on site, where I'll defend every design choice.

The full brief is in `brief.pdf` (or `brief.md`) in this folder. Read it before doing anything else. This file summarises it and sets out how we work.

Nous say the case study is "a thinking-and-judgement test", not a coding test. They want AI used heavily and care about how. It's fine to leave things unfinished. Judgement beats coverage.

## Your role and mine

- **You:** probe the mock API, catalogue data shapes, draft n8n workflow JSON node by node, write test harnesses, check my logic, and point out gaps.
- **Me:** set the decision rules and thresholds, assemble and run the workflow in the n8n Cloud trial editor, make every customer-facing call, and write the final doc.

I haven't used n8n before, though I'm comfortable with JavaScript, Python, SQL, Google Apps Script and REST APIs. When you draft a node, tell me in a sentence or two why it's built that way and what n8n behaviour it relies on (item handling, expressions, error outputs, and so on). I need to be able to explain it without you there.

Present options with trade-offs when there's a real choice. Don't pick thresholds or failure-handling policy for me.

## Hard constraints

- **The n8n public API isn't available on the free trial.** You can't create, deploy or run workflows in my instance. Output workflow JSON I can paste or import into the editor. No MCP or CLI deployment. Don't suggest self-hosting as the main route, since the brief says to build on the trial.
- **Mock API state persists per ticketId.** Attempt counters and PATCHed properties stick. Probing carelessly will contaminate the evaluated scenarios. See the probing rules below.
- **No real customer data.** Everything is synthetic.
- **Secrets:** keep the bearer token in `.env`, not in committed files or workflow JSON. In n8n it goes in a credential.

## Writing conventions (all prose, comments, customer messages)

- British spelling: organise, behaviour, analyse, programme.
- No em dashes or en dashes as sentence punctuation. Use commas, colons or separate sentences. Compound hyphens (time-boxed, re-run) are fine.
- Direct. Flag problems plainly rather than softening them.

## Mock API

- Base URL: `https://nous-case-study-saffron.vercel.app`
- Auth header: `Authorization: Bearer <token from .env>`
- `/deals/{householdId}` also needs `X-Ticket-Id: {ticketId}`. The mock uses it for scenario state.

| Method | Path | Purpose |
|---|---|---|
| GET | `/hubspot/tickets/{ticketId}` | Ticket properties, HubSpot-shaped `{ id, properties }` |
| GET | `/context/{householdId}` | Household and mobile services |
| GET | `/current-payment/{mobileServiceId}` | `{ amountInGbpPounds }` or null |
| GET | `/deals/{householdId}` | SIM-only deals with coverage joined, envelope `{ deals: [...] }` |
| POST | `/recommendation` | Generate deal card, send proposal |
| POST | `/comms/whatsapp` | Send WhatsApp message |
| PATCH | `/hubspot/tickets/{ticketId}` | Update ticket or move stage; accepts `{ properties }` or bare object |
| POST | `/slack/notify` | Structured alert |

Request body shapes for the POSTs aren't documented. Discover them on sandbox tickets only.

HubSpot stage IDs: Success `446512118`, Switch Failure `409734350`, Manual `440806104`, Waiting `5060559097`.

Sample webhook payload:

```json
{
  "ticketId": "TICKET-12345",
  "householdId": "HH-001",
  "userId": "USR-001",
  "subject": "MOB | Jane Smith | Make recommendation | Mobile #1",
  "ticketCategory": "Mobile",
  "pipelineId": "228462820",
  "stageId": "390658766",
  "testMode": true
}
```

Scenarios: `TICKET-001` to `TICKET-011` paired with `HH-001` to `HH-011` are evaluated. `TICKET-012` to `TICKET-024` (with `HH-012` to `HH-024`) are sandbox.

## Business rules from the process doc

- Ticket type `MOBILE_SWITCH_OFFER_RECOMMENDATION`. The subject's `Mobile #N` identifies the specific mobile service in a multi-service household.
- `Mobile #No service found`: don't automate.
- Filter deals to approved networks only: Talkmobile, Giffgaff, iD Mobile (network IDs 9, 13, 18).
- iD Mobile needs a higher bar. Ops don't want members moved onto iD unless it's "properly cheaper", because of poor support and month-two churn.
- Exclude the member's current provider.
- Core judgement: is the saving big enough to be worth disturbing the customer?
- Inventory refreshes through the day, so an empty first check should wait and retry before giving up.
- On Switch Failure, set both `email_switch_failure_reason` and `reporting_switch_failure_reason` before moving the stage. A past incident sent the wrong comms because only one was written.
  - `email_switch_failure_reason`: `Mob - can't beat deal`, `Customer ineligible/can't process switch`, `Customer unresponsive`, `Customer rejects switch`, `N/A`
  - `reporting_switch_failure_reason`: `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL`, `INELIGIBLE_IN_CONTRACT`, `MOB_MANAGEMENT_SWITCHED_OFF`, `UNABLE_REQUEST_OUT_OF_SERVICE_PARAMS`, `OTHER`
- Customer WhatsApp messages are sent in some circumstances via `POST /comms/whatsapp`.

Volume context: about 248 tickets a month at roughly 1.4 minutes each, with about 47% ending in failure.

## Engineering bar ("safe to inherit, easy to debug, safe to re-run")

Nous don't spell this out. It's part of the test. My working standard:

1. **Trust the API, not the webhook.** Re-read the ticket at the start. Exit cleanly if it's already in a terminal stage or doesn't match the expected type.
2. **Idempotent side effects.** Before sending a recommendation or WhatsApp, check whether it's already been done for this ticket. After doing it, record that it happened. Verify in probing whether the mock accepts custom marker properties on PATCH.
3. **Retries.** GETs retry with backoff. POSTs are not retried blindly.
4. **No silent exceptions.** Any unexpected shape, missing field, invalid enum or unhandled branch moves the ticket to Manual and fires a Slack alert with enough context to act on.
5. **Validate before writing.** Failure reasons are checked against the allowed lists, both written, read back, then the stage moves.
6. **Config over code.** Thresholds, approved network IDs, iD bar, retry cap and reason mappings live in one config node so ops can change them without touching logic.
7. **`testMode`** is passed through and respected, not ignored.
8. **Debuggable.** Nodes named for what they decide. Each execution leaves a readable trail of what it saw and why it branched.

## Open decisions (mine to make, bring me options)

- Saving threshold: £/month floor, % floor, or both. Separate higher bar for iD.
- Like-for-like comparison: intro pricing, data allowance, upfront cost, contract length.
- Null current payment: my lean is Manual, not a guess.
- `Mobile #N` that doesn't exist in context.
- `#No service found`: exit untouched, or Manual with a note.
- Retry cap and what "wait" means in n8n (Wait node vs moving to the Waiting stage and re-dispatching).
- Which outcomes trigger a WhatsApp. My lean: final failure only, never on Waiting.
- Failure reason mapping per outcome.

## Order of work

### Phase 1: Probe (do this first, nothing else until I've reviewed the catalogue)

Write a small script (Node or Python, your call, tell me why) that dumps raw responses to `probe/{ticketId}/{endpoint}.json`.

Probing rules:
- **GET ticket, context and current-payment** for all 24: safe.
- **GET deals:** first test whether a throwaway `X-Ticket-Id` (e.g. `PROBE-001`) works with `HH-001`. If it does, use probe IDs for every deals call, calling each several times to reveal attempt-based behaviour. If it doesn't, stop and tell me before touching evaluated ticket IDs.
- **No POST or PATCH on TICKET-001 to TICKET-011.** Use sandbox tickets to discover POST body shapes and PATCH behaviour, and tell me which ones you've mutated.
- Log every call you make to `probe/calls.log`.

Then produce `catalogue.md`: one row per ticket covering subject pattern, service index match, current provider and how it's represented (name vs ID), payment present or null, deal count per attempt, networks present, anything malformed or surprising. Group tickets that share a shape, and list the distinct shapes the workflow has to handle.

### Phase 2: Rules

Help me turn the catalogue into `rules.md`: every shape mapped to an outcome (Success, Switch Failure with both reasons, Waiting/retry, Manual), with the config values I choose.

### Phase 3: Build

Draft the workflow in sections I can import and test one at a time: intake and guards, data fetch, deal evaluation, outcome branches, error handling. Save to `workflow/`. Keep it as simple as the rules allow. Longer and more elaborate isn't better.

### Phase 4: Test

A harness that fires the webhook payload for each scenario and records outcome, final stage, properties written and messages sent, compared against `rules.md`. Evaluated tickets hold state, so plan runs carefully and flag when I need to ask Nous for a reset.

### Phase 5: Doc

I write it. You can check it against the brief. Max two pages: Part A reflection (two key judgement calls, one pushback or question, v2, three metrics with pause or rollback triggers) and Part B reply handling for three customer replies, plus a short note on how I used AI. Customer messages follow WhatsApp conventions: warm, plain, 4 to 6 lines, one clear ask, no admission of fault, no promised timescales.

## Status

| Phase | State | Outputs |
|---|---|---|
| 1 Probe | Complete, 17 Sep 2026 | `catalogue.md`, `probe/` (dumps, `calls.log`, `probe.mjs`, `mutate.mjs`), `phase1.md` (transcript) |
| 2 Rules | Complete, 17 Sep 2026 | `rules.md`, `decisions.md` |
| 3 Build | Complete, 17 Sep 2026 | `workflow/nous-mso-mobile-recommendation.json` (submission), `workflow/0N-*.json` sections, `workflow/build.mjs`, `workflow/code/`, `workflow/simulate.mjs`, `workflow/README.md` |
| 4 Test | Complete, 17 Sep 2026 | `test/harness.mjs`, `test/results.md`, `test/results/`, `test/fires.log`. 11/11 pass. |
| 5 Doc | Not started. Submission packaging done. | `submission.md` (export steps, screenshot shot list, packaging), `tools/ticket-state.mjs`, `tools/fire.mjs` |

Spent mock tickets: 020 (Phase 1 probing), 024, 016, 023, 014 (Phase 3 live tests, all in terminal stages). Sandbox 012, 013, 015, 017, 018, 019, 021, 022 usable. Evaluated 001 to 011 all run in Phase 4 and now in terminal stages; re-runs exit at I1b. Ask Nous for a reset before any further end-to-end run on them.

## Start

Read `catalogue.md`, `rules.md` and `decisions.md` before doing anything else. Pick up at the first phase marked not started. Read the "Flagged, not applied" section of `decisions.md` and check whether Saffron has ruled on it.
