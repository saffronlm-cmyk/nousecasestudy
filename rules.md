# Rules

Every ticket shape mapped to an outcome. Config values live in one block and are referenced by name. Evidence for each shape is in `catalogue.md`. Decisions and open questions are in `decisions.md`.

## Config

```
SAVING_FLOOR_PENCE:      300              // £3.00. Compare in pence: Math.round(x * 100)
ID_PENALTY_PENCE:        200              // £2.00 added to iD Mobile price for ranking only, never for the saving
APPROVED_PROVIDER_IDS:   [9, 13, 18]      // Talkmobile, Giffgaff, iD Mobile
ID_MOBILE_PROVIDER_ID:   18
DATA_FLOOR:              "hard"           // deal.monthlyData >= service.monthlyData, no tolerance
COVERAGE_ACCEPTED:       ["LIKELY"]       // allow-list; unknown values are excluded
MAX_WAITING_ATTEMPTS:    3                // after this, Manual + Slack
WAITING_POLL_MINUTES:    60               // proposed, see decisions.md. Schedule trigger interval = spacing between attempts
WAITING_POLL_TICKET_IDS: ["TICKET-001", ..., "TICKET-011"]   // mock only: no search endpoint. Production uses HubSpot search by stage

PIPELINE_ID:             "228462820"
OPEN_STAGE_ID:           "390658766"
SUCCESS_STAGE_ID:        "446512118"
FAILURE_STAGE_ID:        "409734350"
MANUAL_STAGE_ID:         "440806104"
WAITING_STAGE_ID:        "5060559097"

SUBJECT_REGEX:           /^MOB \| .+ \| Make recommendation \| Mobile #(\d+)/
NO_SERVICE_MARKER:       "#No service found"
ATTEMPTS_PROPERTY:       "automation_attempts"   // custom ticket property, mock persists it (verified)
STORED_INPUT_PROPERTIES: automation_household_id, automation_user_id, automation_test_mode   // written on first pass so the scheduled path can rebuild the input
INTERRUPTED_STATUSES:    ["recommendation_pending", "recommendation_sent", "message_pending", "message_sent"]

HTTP_RETRY_COUNT:        3                // confirmed 17 Sep
HTTP_RETRY_BACKOFF_MS:   2000             // confirmed 17 Sep
HTTP_RETRY_ON:           [429, 500, 502, 503, 504]

EMAIL_REASONS:     ["Mob - can't beat deal", "Customer ineligible/can't process switch",
                    "Customer unresponsive", "Customer rejects switch", "N/A"]
REPORTING_REASONS: ["INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL", "INELIGIBLE_IN_CONTRACT",
                    "MOB_MANAGEMENT_SWITCHED_OFF", "UNABLE_REQUEST_OUT_OF_SERVICE_PARAMS", "OTHER"]
```

## Identification and lookup

| Rule | Value |
|---|---|
| Ticket type | Subject matches `SUBJECT_REGEX` **and** `hs_pipeline_id === PIPELINE_ID`. There is no type property on the ticket. |
| Service index | `N` = capture group 1 as an integer. Trailing text after `#N` (e.g. `- urgent re-raise`) is ignored. |
| Service lookup | `context.mobileServices[N - 1]`. Array order is creation order. |
| Provider match | `deal.providerId === service.currentProviderId`. Integers, never names. |
| Payment | `GET /current-payment/{service.id}` (`MOB-xxx`). Not `currentPaymentRef`. |
| Customer first name | First alphabetic token of the customer segment of the subject (`MOB | Jane Smith | ...` → `Jane`). If none, the greeting is "Hi, it's Nous." Used only in the WhatsApp message. |
| Source of truth | The ticket re-read at the start of the run, never the trigger payload. The trigger supplies only `ticketId`, `householdId`, `userId`, `testMode` (see Triggers), and `householdId`/`userId` are verified against context at D0. |

## Triggers

Two triggers, one core. Both feed a "normalise input" node that emits the same item; nothing downstream knows which trigger fired except through `source` in the note.

| Trigger | Fires | Input | Produces |
|---|---|---|---|
| Webhook | HubSpot dispatches a new ticket | webhook body | `{ ticketId, householdId, userId, testMode, source: "webhook" }` |
| Schedule | every `WAITING_POLL_MINUTES` | none | For each ticket in `WAITING_POLL_TICKET_IDS`: GET the ticket, keep it if `hs_pipeline_stage === WAITING_STAGE_ID`, emit `{ ticketId, householdId: automation_household_id, userId: automation_user_id, testMode: automation_test_mode, source: "schedule" }` from the stored properties |

The ticket carries no household or user ID, so the first pass stores them (`STORED_INPUT_PROPERTIES`) in the same PATCH that sets `waiting`. The scheduled path reads them back. A Waiting ticket missing any stored property goes to Manual: guard I0, below.

The mock has no "list tickets by stage" endpoint, so the schedule path iterates a configured ID list. Production swaps that node for a HubSpot search on stage. Poll interval is the spacing between attempts: three attempts span roughly `2 × WAITING_POLL_MINUTES`. An n8n restart resets the clock; storing a last-attempt timestamp and skipping recently touched tickets is v2.

## automation_status state machine

Written to the ticket before and after every side effect so a re-run can see exactly where the last run got to.

```
null
 ├─ waiting                  (empty feed, attempt < MAX)
 ├─ manual                   (any Manual route)
 ├─ message_pending → message_sent → completed          (Switch Failure)
 └─ recommendation_pending → recommendation_sent → completed   (Success)
```

Only `null` and `waiting` are re-runnable. `completed` and `manual` exit. Any of the four intermediate statuses found at intake means a previous run died mid-sequence; that routes to Manual with a Slack warning (I1a) because the workflow cannot tell whether the side effect went out.

## Guards, in order

### Intake (after the ticket re-read, before any other call)

| # | Shape | Check | Outcome | Writes | Slack |
|---|---|---|---|---|---|
| I0 | Missing input | `householdId` or `userId` missing from the trigger input (webhook body, or a Waiting ticket's stored properties) | Manual | note: "Routed to manual: [webhook/schedule] input is missing householdId or userId." | none |
| I1a | Interrupted run | `automation_status` in `INTERRUPTED_STATUSES` | Manual | note: "Routed to manual: interrupted run, last status [status]. Check whether the [recommendation/message] went out before re-running." | warning: "interrupted run" |
| I1b | Already handled | `automation_status` not null, not `waiting`, not in `INTERRUPTED_STATUSES` (i.e. `completed` or `manual`) | Exit | none | Info only if value is `completed` **and** stage is `OPEN_STAGE_ID` ("completed marker on open stage"). Otherwise silent. |
| I2 | Terminal stage | `hs_pipeline_stage` not in `[OPEN_STAGE_ID, WAITING_STAGE_ID]` | Exit | none | none (added, see decisions.md) |
| I3 | Wrong pipeline | `hs_pipeline_id !== PIPELINE_ID` | Manual | note: "Routed to manual: unexpected pipeline [id]." | none |
| I4 | No service | subject contains `NO_SERVICE_MARKER` | Exit | none | none |
| I5 | Subject off-pattern | `SUBJECT_REGEX` does not match | Manual | note: "Routed to manual: subject pattern not recognised, confirm ticket type." | none |

I4 must run before I5: `#No service found` does not match the regex.

### Data (after context and payment, before deals)

| # | Shape | Check | Outcome | Writes |
|---|---|---|---|---|
| D0 | Household/user mismatch | `context.userId !== input.userId` (also catches a missing `userId`) | Manual | note: "Routed to manual: household [householdId] belongs to [context.userId], ticket input says [input.userId]." |
| D1 | Index out of range | `N > mobileServices.length` or `N < 1` | Manual | note: "Routed to manual: Mobile #[N] out of range, [len] services found." |
| D2 | Data missing | `service.monthlyData` null or not a number | Manual | note: "Routed to manual: monthlyData missing on [service.id]." |
| D3 | Payment 404 | `GET /current-payment` returns 404 | Manual | note: "Routed to manual: payment endpoint 404 for [service.id]." |
| D4 | Payment null | 200 with `amountInGbpPounds === null` | Manual | note: "Routed to manual: payment null on [service.id]." |
| D5 | Payment zero | `amountInGbpPounds === 0` | Manual | note: "Routed to manual: payment is £0 on [service.id], possible data error." |

### Deals

**Fetch.** `GET /deals/{householdId}` with `X-Ticket-Id: ticketId`. The HTTP node retries `HTTP_RETRY_ON` statuses `HTTP_RETRY_COUNT` times with `HTTP_RETRY_BACKOFF_MS`. Only if every retry fails does the run treat it as an empty feed.

**Filter, in order.** Each step is logged with the count it removed.

0. Malformed: `providerId` not an integer, `effective_line_rental` not a finite number > 0, `monthlyData` not a finite number, or `coverageAtHouseholdLocation` not a string → drop. If the feed was non-empty and step 0 dropped every deal, that is F0 (Manual), not a Switch Failure.
1. `providerId` not in `APPROVED_PROVIDER_IDS` → drop
2. `providerId === service.currentProviderId` → drop
3. `coverageAtHouseholdLocation` not in `COVERAGE_ACCEPTED` → drop
4. `monthlyData < service.monthlyData` → drop

Numbers are coerced with `Number()` before the checks, so `"12.50"` survives and `"unlimited"` or `null` does not.

**Rank.** For each survivor: `rankPence = Math.round(effective_line_rental * 100) + (providerId === ID_MOBILE_PROVIDER_ID ? ID_PENALTY_PENCE : 0)`. Sort by `rankPence` asc, then `monthlyData` desc, then non-iD before iD, then `stickeeDealId` asc. Best = first.

**Saving.** `savingPence = Math.round(payment * 100) - Math.round(best.effective_line_rental * 100)`. The penalty is not in this number. Propose if `savingPence >= SAVING_FLOOR_PENCE`.

**Failure cause.** Computed once in the evaluation node and used to pick the WhatsApp template and to word the note. Rule: the first filter step after which the pool was empty; if the pool survived filtering, `price`.

| Pool empty after step | `failureCause` | Evaluated example |
|---|---|---|
| 1 (approved) or 2 (current provider) | `price` | none |
| 3 (coverage) | `coverage` | 004 |
| 4 (data) | `data` | 007 |
| Pool non-empty, best below floor | `price` | 003, 008 |

**Data-floor shadow.** Also compute the best deal with step 4 skipped, using the identical ranking and tie-break. If it differs from the actual best (or the actual pool is empty), append to the note: "Ignoring data floor: [providerName] [data]GB £[price] would save £[saving]." This changes no outcome; it exists so two weeks of notes show how many failures were data-floor-only.

Both failure reasons are the same for every cause. The reporting enum has no coverage or data value, so `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL` is the only honest fit. The customer message is the one place the workflow can be precise, so it is.

| # | Shape | Check | Outcome | email_switch_failure_reason | reporting_switch_failure_reason | WhatsApp | Slack | Note |
|---|---|---|---|---|---|---|---|---|
| W1 | Empty feed, attempts left | feed has 0 deals (or all retries failed) and `attempts + 1 < MAX_WAITING_ATTEMPTS` | Waiting | | | no | no | "Attempt [n] of [MAX]: no eligible deals in feed." |
| W2 | Empty feed, cap reached | as W1 but `attempts + 1 >= MAX_WAITING_ATTEMPTS` | Manual | | | no | warning: "retry cap exhausted" | "Routed to manual: no deals in feed after [MAX] attempts." |
| F0 | Feed unreadable | feed non-empty, step 0 dropped everything | Manual | | | no | warning: "deals feed unreadable" | "Routed to manual: [n] deals in feed, none parseable. Sample: [first deal JSON]." |
| F1 | Empty pool after filter | feed non-empty, 0 survivors after steps 1 to 4 | Switch Failure | `Mob - can't beat deal` | `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL` | yes, template by `failureCause` | no | "Best eligible: none (cause: [failureCause]). [feed] deals in feed, removed [n] malformed, [n] non-approved, [n] current provider, [n] coverage, [n] data." |
| F2 | Below floor | `savingPence < SAVING_FLOOR_PENCE` | Switch Failure | `Mob - can't beat deal` | `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL` | yes, `price` template | no | "Best eligible: [providerName] [data]GB £[price], saves £[saving], below £[floor] floor." |
| S1 | At or above floor | `savingPence >= SAVING_FLOOR_PENCE` | Success | | | no (the recommendation is the customer contact) | no | "Recommending [providerName] [data]GB £[price]/mo, saves £[saving]/mo. stickeeDealId: [id]." |

`attempts` is read from `ATTEMPTS_PROPERTY` on the ticket, default 0.

## Sequences

Every sequence writes `next_task_description` first, then status markers around each side effect, then the stage last.

### Waiting (W1)

1. PATCH `{ next_task_description, automation_status: "waiting", automation_attempts: attempts + 1, automation_household_id, automation_user_id, automation_test_mode, hs_pipeline_stage: WAITING_STAGE_ID }` in one call
2. End. The Schedule trigger re-dispatches (see Triggers).

### Manual (I1a, I3, I5, D0 to D5, F0, W2, and any unhandled error)

1. PATCH `{ next_task_description, automation_status: "manual", hs_pipeline_stage: MANUAL_STAGE_ID }` in one call
2. Slack only where the table says so (I1a, F0, W2 `warning`), or for any unhandled error (severity `error`).

For I1a the PATCH in step 1 overwrites the interrupted status. That is deliberate: the note records what it was, and `manual` stops any further re-dispatch from looping back into I1a.

### Switch Failure (F1, F2)

1. PATCH `{ next_task_description, email_switch_failure_reason, reporting_switch_failure_reason }` in one call
2. GET ticket. Check both reasons are present and are in `EMAIL_REASONS` / `REPORTING_REASONS`
3. If either check fails: Slack `error` ("failure reason validation failed"), then Manual sequence. Do not move to Failure.
4. PATCH `{ automation_status: "message_pending" }`
5. POST `/comms/whatsapp` `{ ticketId, userId, message, testMode }`
6. PATCH `{ automation_status: "message_sent" }`
7. PATCH `{ automation_status: "completed", hs_pipeline_stage: FAILURE_STAGE_ID }` in one call

Six calls. Steps 1 and 7 are deliberately separate: both reasons must be on the ticket and verified before the stage moves. If step 7 fails, the ticket sits at `message_sent` and I1a routes it to Manual with the right note.

### Success (S1)

1. PATCH `{ next_task_description, automation_status: "recommendation_pending" }`
2. POST `/recommendation` `{ ticketId, householdId, userId, mobileServiceId: service.id, stickeeDealId: best.stickeeDealId, testMode }`
3. PATCH `{ automation_status: "recommendation_sent" }`
4. PATCH `{ automation_status: "completed", hs_pipeline_stage: SUCCESS_STAGE_ID }` in one call

## Messages

### WhatsApp (Switch Failure only)

All three approved by Saffron 17 September. Template chosen by `failureCause`. Conventions: warm, plain, 4 to 6 lines, one clear ask, no admission of fault, no promised timescales. The closing line is identical across templates and is the only ask; it makes no promise about future checks because this workflow cannot keep one (see decisions.md).

`{firstName}` is the first token of the customer segment of the subject. `{monthlyData}` is the target service's allowance.

**price** (F2, and F1 when the pool emptied at step 1 or 2)

```
Hi {firstName}, it's Nous.
We've just compared the SIM-only deals available at your address with what you're paying now.
Nothing out there would save you enough to make a switch worth your while, so we're leaving your mobile as it is.
If you'd like us to look again, or you've spotted a deal you'd like us to check, just reply here.
```

**coverage** (F1, pool emptied at step 3)

```
Hi {firstName}, it's Nous.
We've just looked at the SIM-only deals available at your address.
The deals we found aren't expected to have good coverage at your postcode, so we're not going to move you onto something that might not work where you live.
If you'd like us to look again, or you've spotted a deal you'd like us to check, just reply here.
```

**data** (F1, pool emptied at step 4)

```
Hi {firstName}, it's Nous.
We've just compared the SIM-only deals available at your address with your current plan.
Nothing we found gives you at least your current {monthlyData}GB for less, and we didn't want to save you money by cutting your data.
If you'd like us to look again, or you've spotted a deal you'd like us to check, just reply here.
```

### Slack

Sent only for: interrupted run found at intake (`warning`), deals feed unreadable (`warning`), retry cap exhausted (`warning`), `completed` marker on an open stage (`info`), failure reason validation failed (`error`), unhandled exception in any branch (`error`). Routine Manual routing does not fire Slack; the stage and note are the signal.

```json
{ "ticketId": "", "householdId": "", "severity": "info|warning|error", "title": "", "message": "",
  "context": { "shape": "W2|I1|...", "stepFailed": "", "ticketStage": "" }, "testMode": true }
```

## Expected outcomes

Verified by dry-running these rules against the Phase 1 dumps (`probe/dryrun.mjs`). This table is the Phase 4 oracle.

### Evaluated

| Ticket | Shape | Outcome | Best deal | Saving | Final stage | automation_status |
|---|---|---|---|---|---|---|
| 001 | S1 | Success | Giffgaff 30GB £15 | £10.00 | Success | completed |
| 002 | S1 | Success | Talkmobile 15GB £12.50 (iD £12 ranks £14 with penalty) | £7.50 | Success | completed |
| 003 | F2 | Switch Failure, `price` message | Giffgaff £14.50 | £0.50, below floor | Failure | completed |
| 004 | F1 | Switch Failure, `coverage` message | none (3 removed for coverage) | | Failure | completed |
| 005 | D2 | Manual | | monthlyData null | Manual | manual |
| 006 | S1 | Success | Giffgaff 30GB £15, after in-node retry of the 500 | £10.00 | Success | completed |
| 007 | F1 | Switch Failure, `data` message | none (3 removed for data < 50GB) | | Failure | completed |
| 008 | F2 | Switch Failure, `price` message | Giffgaff £8 | negative £2.00 | Failure | completed |
| 009 | W1, then S1 | Waiting, then Success on the scheduled pass | Giffgaff 30GB £15 (feed appears on attempt 2 under the real ticket ID) | £10.00 | Success | completed |
| 010 | I1 | Exit, no writes, Slack info | | | unchanged | completed (pre-existing) |
| 011 | D4 | Manual | | payment null | Manual | manual |

### Sandbox

| Ticket | Shape | Outcome | Best deal | Saving | Notes |
|---|---|---|---|---|---|
| 012 | F2 | Switch Failure, `price` message | Talkmobile 25GB £18 | £2.00 | Giffgaff £14 excluded as current provider |
| 013 | S1 | Success | Giffgaff 15GB £12 | £3.00 | Exactly on the floor, passes on `>=` |
| 014 | S1 | Success | iD Mobile 30GB £14 | £11.00 | iD ranks £16 with penalty, still beats Talkmobile £17 |
| 015 | S1 | Success | Talkmobile 25GB £15 | £7.00 | Two cheaper deals removed for coverage |
| 016 | F2 | Switch Failure, `price` message | Giffgaff £14 | £1.00 | |
| 017 | F2 | Switch Failure, `price` message | Giffgaff £14.01 | £0.99 | Pence arithmetic gives 99, not 99.00000000000002 |
| 018 | S1 | Success | Giffgaff 20GB £14 | £6.00 | Exact tie with Talkmobile, broken on stickeeDealId |
| 019 | S1 | Success | Giffgaff 25GB £14 | £16.00 | 18 in feed, 12 removed. iD £12 ranks £14, tie broken by non-iD-first |
| 020 | I1 | Exit, silent | | | Mutated in Phase 1: status `probe_in_progress`, stage `999999999` |
| 021 | S1 | Success | Giffgaff 20GB £15 | £5.00 | Subject suffix tolerated |
| 022 | S1 | Success | iD Mobile 20GB £15 | £5.00 | Only deal keeping 15GB |
| 023 | D5 | Manual | | payment £0 | |
| 024 | S1 | Success | Giffgaff 20GB £15 | £5.00 | |
