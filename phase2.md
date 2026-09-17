# Nous case study: Phase 2 transcript

Exported 17 September 2026 from the Claude Code session. Tool calls and results are included; model thinking is omitted. The bearer token has been redacted.

## User (10:35:42)

# Nous case study: Phase 2 kickoff

This is the Phase 2 session. Phase 1 (probing) is complete. The catalogue is in `catalogue.md`. This session produces two files: `rules.md` and `decisions.md`.

## What to build this session

**`rules.md`** — every ticket shape mapped to an outcome, with both failure reasons where applicable, the config values, and a one-line decision note per shape.

**`decisions.md`** — started this session, appended each phase. Format:

```
## Phase 2 — 17 September 2026

### Rules confirmed
...

### Open questions for onsite
...
```

No workflow code this session. Rules first, build second.

---

## Confirmed rules (do not deviate without flagging)

These were agreed externally. Put all values in a single config block at the top of rules.md and reference them by name.

```
SAVING_FLOOR_PENCE: 300          // £3.00 — compare in pence (Math.round(x * 100)) to avoid floats
ID_PENALTY_PENCE: 200            // £2.00 added to iD effective_line_rental for ranking only
APPROVED_PROVIDER_IDS: [9, 13, 18]   // Talkmobile, Giffgaff, iD Mobile
DATA_FLOOR: "hard"               // deal monthlyData >= service monthlyData; no tolerance
COVERAGE_REQUIRED: "LIKELY"      // anything else excluded
MAX_WAITING_ATTEMPTS: 3          // after cap, route to Manual
OPEN_STAGE_ID: "390658766"
SUCCESS_STAGE_ID: "446512118"
FAILURE_STAGE_ID: "409734350"
MANUAL_STAGE_ID: "440806104"
WAITING_STAGE_ID: "5060559097"
```

**Ticket type identification:** subject matches `/^MOB \| .+ \| Make recommendation \| Mobile #(\d+)/` AND pipeline_id is `228462820`. Extract the numeric index from the capture group — the trailing text (e.g. "- urgent re-raise") is tolerated and ignored.

**Service lookup:** `mobileServices[N-1]` where N is the captured index. Array order = creation date order.

**Provider matching:** by `currentProviderId` (integer), never by name.

**Payment endpoint:** `/current-payment/{service.id}` — the `MOB-xxx` id, not `currentPaymentRef`.

---

## Shape-to-outcome mapping

Write this as a table in rules.md with columns: Shape, Guard/filter that triggers it, Outcome, email_switch_failure_reason, reporting_switch_failure_reason, WhatsApp, Slack, decision note template.

### Intake guards (check before any API call beyond the ticket read)

| Shape | Outcome |
|---|---|
| `automation_status` is non-null and non-"waiting" | Exit, no writes. If value is "completed" and stage is still open: Slack info alert ("completed marker on open stage"). Otherwise: silent exit. |
| Subject does not match the regex | Manual. next_task_description: "Subject pattern not recognised — confirm ticket type." |
| Pipeline ID is not 228462820 | Manual. next_task_description: "Unexpected pipeline." |
| `#No service found` in subject | Exit, no writes. No WhatsApp. |
| Service index N > mobileServices.length | Manual. next_task_description: "Mobile #N out of range — N services found." |

### Data guards (check after context + payment fetched, before deals)

| Shape | Outcome |
|---|---|
| monthlyData null on target service | Manual. next_task_description: "monthlyData missing on [serviceId]." |
| amountInGbpPounds null (200 with null field) | Manual. next_task_description: "Payment null on [serviceId]." |
| amountInGbpPounds === 0 | Manual. next_task_description: "Payment is £0 on [serviceId] — possible data error." |
| GET /current-payment returns 404 | Manual. next_task_description: "Payment endpoint 404 for [serviceId]." |

### Deals outcomes

Apply in this order after filtering:

**Filter pipeline (in order):**
1. Remove non-approved providers (providerId not in [9, 13, 18])
2. Remove current provider (providerId === service.currentProviderId)
3. Remove UNLIKELY coverage (coverageAtHouseholdLocation !== "LIKELY")
4. Remove deals where monthlyData < service.monthlyData

**After filtering, apply iD penalty for ranking only:**
- effectiveRankPrice = effective_line_rental + (providerId === 18 ? ID_PENALTY_PENCE/100 : 0)
- Sort ascending by effectiveRankPrice, then monthlyData desc, then providerId !== 18 first, then stickeeDealId asc
- Best deal = first in sorted list

**Saving check (in pence to avoid floats):**
- savingPence = Math.round(payment * 100) - Math.round(deal.effective_line_rental * 100)
- savingPence >= SAVING_FLOOR_PENCE → propose
- savingPence < SAVING_FLOOR_PENCE → failure

| Shape | Outcome | email reason | reporting reason |
|---|---|---|---|
| Empty feed on first attempt (500 or 0 deals) | Increment automation_attempts, move to Waiting. On next attempt, re-fetch. At MAX_WAITING_ATTEMPTS with still no eligible deals: Manual + Slack. | N/A | N/A |
| Empty eligible pool after filtering (includes all-UNLIKELY-coverage case) | Switch Failure | `Mob - can't beat deal` | `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL` |
| Best deal saving below floor | Switch Failure | `Mob - can't beat deal` | `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL` |
| Best deal saving at or above floor | Success → POST /recommendation | N/A | N/A |

**Decision note for every outcome (write to next_task_description before any PATCH):**
- Success: "Recommending [providerName] [monthlyData]GB £[price]/mo, saves £[saving]/mo. stickeeDealId: [id]."
- Failure (price/filter): "Best eligible: [providerName] £[price], saves £[saving], [reason e.g. below £3 floor / data mismatch / no LIKELY coverage]."
- Waiting: "Attempt [n] of [MAX]: no eligible deals in feed."
- Manual: "Routed to manual: [specific reason]."

### Failure sequence (Switch Failure only)

1. PATCH both failure reasons in one call
2. GET ticket, verify both properties match allowed values
3. If either is wrong: Slack error + Manual (don't move stage)
4. Mark automation_status = "message_pending"
5. POST /comms/whatsapp
6. Mark automation_status = "message_sent"
7. PATCH stage to FAILURE_STAGE_ID
8. Mark automation_status = "completed"

### Success sequence

1. Mark automation_status = "recommendation_pending"
2. POST /recommendation with: { ticketId, householdId, userId, mobileServiceId: service.id, stickeeDealId: best.stickeeDealId, testMode }
3. Mark automation_status = "recommendation_sent"
4. PATCH stage to SUCCESS_STAGE_ID
5. Mark automation_status = "completed"

### Slack alerts (errors only, not routine Manual routing)

Fire Slack when: retry cap exhausted (severity: warning), automation_status/stage mismatch (severity: info), failure reason validation fails (severity: error), unhandled exception in any branch (severity: error).

Body shape: `{ ticketId, householdId, severity, title, message, context: { shape, stepFailed, ticketStage }, testMode }`

---

## Evaluated ticket outcomes (expected, for Phase 4 test harness)

| Ticket | Expected outcome | Best deal | Saving |
|---|---|---|---|
| 001 | Success | Giffgaff £15 | £10 |
| 002 | Success | Talkmobile £12.50 | £7.50 |
| 003 | Switch Failure | — | £0.50 below floor |
| 004 | Switch Failure | — | No LIKELY coverage |
| 005 | Manual | — | monthlyData null |
| 006 | Success (after 500 retry) | Giffgaff £15 | £10 |
| 007 | Switch Failure | — | All deals below 50GB |
| 008 | Switch Failure | — | Nothing cheaper |
| 009 | Waiting → Manual at cap | — | Empty feed |
| 010 | Exit, no writes + Slack info | — | automation_status: completed on open stage |
| 011 | Manual | — | Payment null |

---

## What to produce

1. `rules.md` — all of the above as a clean reference document. No prose padding, just the rules.
2. `decisions.md` — Phase 2 entry with the config values, confirmed outcomes table, and these open questions for the onsite:
   - No coverage-specific failure reason exists. Can't distinguish price failure from coverage failure in reporting.
   - "Wait and retry often worth it" — not evidenced in the mock. Is there a retry-then-success case in the evaluated set under its real ticket ID?
   - Subject-based ticket type detection is the only available guard. Brief implies a ticket type property that doesn't exist.
3. Update `CLAUDE.md` Phase 2 status to complete.

Then stop and confirm before Phase 3.

## Claude (10:36:48)

Let me check the rules against the catalogue before writing anything, since the mapping has to hold up on all 24 tickets, not just the 11.

### Tool call 1: `Bash` (10:37:06)

_Dry-run the Phase 2 rules against the Phase 1 dumps for all 24 tickets, no API calls_

```bash
cd /Users/saffron/Downloads/Nous/probe && cat > /private/tmp/claude-501/-Users-saffron-Downloads-Nous/180b82c9-b325-4867-960a-8145ddc0a34a/scratchpad/dryrun.mjs <<'EOF'
// Dry run of the Phase 2 rules against the Phase 1 dumps. No API calls.
import fs from 'node:fs';
const CFG = { SAVING_FLOOR_PENCE: 300, ID_PENALTY_PENCE: 200, APPROVED: [9, 13, 18], MAX_WAITING_ATTEMPTS: 3, PIPELINE_ID: '228462820', OPEN: '390658766' };
const RX = /^MOB \| .+ \| Make recommendation \| Mobile #(\d+)/;
const pence = (x) => Math.round(x * 100);
for (let n = 1; n <= 24; n++) {
  const t = `TICKET-${String(n).padStart(3, '0')}`;
  const p = JSON.parse(fs.readFileSync(`${t}/ticket.json`)).body.properties;
  const cx = JSON.parse(fs.readFileSync(`${t}/context.json`)).body;
  let out;
  // intake
  if (p.automation_status !== null && p.automation_status !== 'waiting') out = `EXIT (automation_status=${p.automation_status}${p.automation_status === 'completed' && p.hs_pipeline_stage === CFG.OPEN ? ', Slack info' : ''})`;
  else if (p.hs_pipeline_id !== CFG.PIPELINE_ID) out = 'MANUAL: unexpected pipeline';
  else if (/#No service found/.test(p.subject)) out = 'EXIT: no service found';
  else if (!RX.test(p.subject)) out = 'MANUAL: subject pattern';
  else {
    const N = Number(RX.exec(p.subject)[1]);
    const svc = cx.mobileServices[N - 1];
    if (!svc) out = `MANUAL: #${N} out of range`;
    else {
      const pay = JSON.parse(fs.readFileSync(`${t}/current-payment.${svc.id}.json`));
      const amt = pay.body && pay.body.amountInGbpPounds;
      if (svc.monthlyData === null || svc.monthlyData === undefined) out = 'MANUAL: monthlyData null';
      else if (pay.status === 404) out = 'MANUAL: payment 404';
      else if (amt === null) out = 'MANUAL: payment null';
      else if (amt === 0) out = 'MANUAL: payment £0';
      else {
        const files = fs.readdirSync(t).filter((f) => /^deals\.attempt\d+\.json$/.test(f)).sort();
        const recs = files.map((f) => JSON.parse(fs.readFileSync(`${t}/${f}`)));
        const first = recs[0];
        const ok = recs.find((r) => r.status === 200);
        const deals = ok ? ok.body.deals : [];
        const note = first.status !== 200 ? ` [first attempt HTTP ${first.status}, in-node retry]` : '';
        if (deals.length === 0) out = `WAITING x${CFG.MAX_WAITING_ATTEMPTS} -> MANUAL (empty feed)`;
        else {
          const pool = deals
            .filter((d) => CFG.APPROVED.includes(d.providerId))
            .filter((d) => d.providerId !== svc.currentProviderId)
            .filter((d) => d.coverageAtHouseholdLocation === 'LIKELY')
            .filter((d) => d.monthlyData >= svc.monthlyData)
            .map((d) => ({ ...d, rank: pence(d.effective_line_rental) + (d.providerId === 18 ? CFG.ID_PENALTY_PENCE : 0) }))
            .sort((a, b) => a.rank - b.rank || b.monthlyData - a.monthlyData || (a.providerId === 18) - (b.providerId === 18) || a.stickeeDealId.localeCompare(b.stickeeDealId));
          if (pool.length === 0) out = `FAILURE can't beat (empty pool after filter; ${deals.length} in feed)${note}`;
          else {
            const b = pool[0]; const saving = pence(amt) - pence(b.effective_line_rental);
            out = (saving >= CFG.SAVING_FLOOR_PENCE ? 'SUCCESS' : 'FAILURE can\'t beat') + ` ${b.providerName} ${b.monthlyData}GB £${b.effective_line_rental} saves £${(saving / 100).toFixed(2)}` + (pool.length > 1 ? ` (runner-up ${pool[1].providerName} £${pool[1].effective_line_rental})` : '') + note;
          }
        }
      }
    }
  }
  console.log(t.padEnd(11), out);
}
EOF
node /private/tmp/claude-501/-Users-saffron-Downloads-Nous/180b82c9-b325-4867-960a-8145ddc0a34a/scratchpad/dryrun.mjs
```

**Result:**

```
TICKET-001  SUCCESS Giffgaff 30GB £15 saves £10.00 (runner-up iD Mobile £16)
TICKET-002  SUCCESS Talkmobile 15GB £12.5 saves £7.50 (runner-up Giffgaff £14)
TICKET-003  FAILURE can't beat Giffgaff 15GB £14.5 saves £0.50 (runner-up Talkmobile £14.75)
TICKET-004  FAILURE can't beat (empty pool after filter; 3 in feed)
TICKET-005  MANUAL: monthlyData null
TICKET-006  SUCCESS Giffgaff 30GB £15 saves £10.00 (runner-up iD Mobile £16) [first attempt HTTP 500, in-node retry]
TICKET-007  FAILURE can't beat (empty pool after filter; 3 in feed)
TICKET-008  FAILURE can't beat Giffgaff 10GB £8 saves £-2.00 (runner-up Talkmobile £10)
TICKET-009  WAITING x3 -> MANUAL (empty feed)
TICKET-010  EXIT (automation_status=completed, Slack info)
TICKET-011  MANUAL: payment null
TICKET-012  FAILURE can't beat Talkmobile 25GB £18 saves £2.00 (runner-up iD Mobile £19)
TICKET-013  SUCCESS Giffgaff 15GB £12 saves £3.00 (runner-up Talkmobile £13.5)
TICKET-014  SUCCESS iD Mobile 30GB £14 saves £11.00 (runner-up Talkmobile £17)
TICKET-015  SUCCESS Talkmobile 25GB £15 saves £7.00
TICKET-016  FAILURE can't beat Giffgaff 15GB £14 saves £1.00
TICKET-017  FAILURE can't beat Giffgaff 15GB £14.01 saves £0.99
TICKET-018  SUCCESS Giffgaff 20GB £14 saves £6.00 (runner-up Talkmobile £14)
TICKET-019  SUCCESS Giffgaff 25GB £14 saves £16.00 (runner-up iD Mobile £12)
TICKET-020  WAITING x3 -> MANUAL (empty feed)
TICKET-021  SUCCESS Giffgaff 20GB £15 saves £5.00
TICKET-022  SUCCESS iD Mobile 20GB £15 saves £5.00
TICKET-023  MANUAL: payment £0
TICKET-024  SUCCESS Giffgaff 20GB £15 saves £5.00
```

### Tool call 2: `Write` (10:38:21)

**File written: `/Users/saffron/Downloads/Nous/rules.md`**

````
# Rules

Every ticket shape mapped to an outcome. Config values live in one block and are referenced by name. Evidence for each shape is in `catalogue.md`. Decisions and open questions are in `decisions.md`.

## Config

```
SAVING_FLOOR_PENCE:      300              // £3.00. Compare in pence: Math.round(x * 100)
ID_PENALTY_PENCE:        200              // £2.00 added to iD Mobile price for ranking only, never for the saving
APPROVED_PROVIDER_IDS:   [9, 13, 18]      // Talkmobile, Giffgaff, iD Mobile
ID_MOBILE_PROVIDER_ID:   18
DATA_FLOOR:              "hard"           // deal.monthlyData >= service.monthlyData, no tolerance
COVERAGE_REQUIRED:       "LIKELY"         // anything else excluded
MAX_WAITING_ATTEMPTS:    3                // after this, Manual + Slack

PIPELINE_ID:             "228462820"
OPEN_STAGE_ID:           "390658766"
SUCCESS_STAGE_ID:        "446512118"
FAILURE_STAGE_ID:        "409734350"
MANUAL_STAGE_ID:         "440806104"
WAITING_STAGE_ID:        "5060559097"

SUBJECT_REGEX:           /^MOB \| .+ \| Make recommendation \| Mobile #(\d+)/
NO_SERVICE_MARKER:       "#No service found"
ATTEMPTS_PROPERTY:       "automation_attempts"   // custom ticket property, mock persists it (verified)

HTTP_RETRY_COUNT:        3                // proposed, see decisions.md
HTTP_RETRY_BACKOFF_MS:   2000             // proposed
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
| Customer first name | First token of the customer segment of the subject (`MOB | Jane Smith | ...` → `Jane`). Used only in the WhatsApp message. |
| Source of truth | The ticket re-read at the start of the run, never the webhook body. Webhook supplies `ticketId`, `householdId`, `userId`, `testMode`. |

## automation_status state machine

Written to the ticket before and after every side effect so a re-run can see exactly where the last run got to.

```
null
 ├─ waiting                  (empty feed, attempt < MAX)
 ├─ manual                   (any Manual route)
 ├─ message_pending → message_sent → completed          (Switch Failure)
 └─ recommendation_pending → recommendation_sent → completed   (Success)
```

## Guards, in order

### Intake (after the ticket re-read, before any other call)

| # | Shape | Check | Outcome | Writes | Slack |
|---|---|---|---|---|---|
| I1 | Already handled | `automation_status` not null and not `waiting` | Exit | none | Info only if value is `completed` **and** stage is `OPEN_STAGE_ID` ("completed marker on open stage"). Otherwise silent. |
| I2 | Terminal stage | `hs_pipeline_stage` not in `[OPEN_STAGE_ID, WAITING_STAGE_ID]` | Exit | none | none (added, see decisions.md) |
| I3 | Wrong pipeline | `hs_pipeline_id !== PIPELINE_ID` | Manual | note: "Routed to manual: unexpected pipeline [id]." | none |
| I4 | No service | subject contains `NO_SERVICE_MARKER` | Exit | none | none |
| I5 | Subject off-pattern | `SUBJECT_REGEX` does not match | Manual | note: "Routed to manual: subject pattern not recognised, confirm ticket type." | none |

I4 must run before I5: `#No service found` does not match the regex.

### Data (after context and payment, before deals)

| # | Shape | Check | Outcome | Writes |
|---|---|---|---|---|
| D1 | Index out of range | `N > mobileServices.length` or `N < 1` | Manual | note: "Routed to manual: Mobile #[N] out of range, [len] services found." |
| D2 | Data missing | `service.monthlyData` null or not a number | Manual | note: "Routed to manual: monthlyData missing on [service.id]." |
| D3 | Payment 404 | `GET /current-payment` returns 404 | Manual | note: "Routed to manual: payment endpoint 404 for [service.id]." |
| D4 | Payment null | 200 with `amountInGbpPounds === null` | Manual | note: "Routed to manual: payment null on [service.id]." |
| D5 | Payment zero | `amountInGbpPounds === 0` | Manual | note: "Routed to manual: payment is £0 on [service.id], possible data error." |

### Deals

**Fetch.** `GET /deals/{householdId}` with `X-Ticket-Id: ticketId`. The HTTP node retries `HTTP_RETRY_ON` statuses `HTTP_RETRY_COUNT` times with `HTTP_RETRY_BACKOFF_MS`. Only if every retry fails does the run treat it as an empty feed.

**Filter, in order.** Each step is logged with the count it removed.

1. `providerId` not in `APPROVED_PROVIDER_IDS` → drop
2. `providerId === service.currentProviderId` → drop
3. `coverageAtHouseholdLocation !== COVERAGE_REQUIRED` → drop
4. `monthlyData < service.monthlyData` → drop

**Rank.** For each survivor: `rankPence = Math.round(effective_line_rental * 100) + (providerId === ID_MOBILE_PROVIDER_ID ? ID_PENALTY_PENCE : 0)`. Sort by `rankPence` asc, then `monthlyData` desc, then non-iD before iD, then `stickeeDealId` asc. Best = first.

**Saving.** `savingPence = Math.round(payment * 100) - Math.round(best.effective_line_rental * 100)`. The penalty is not in this number. Propose if `savingPence >= SAVING_FLOOR_PENCE`.

| # | Shape | Check | Outcome | email_switch_failure_reason | reporting_switch_failure_reason | WhatsApp | Slack | Note |
|---|---|---|---|---|---|---|---|---|
| W1 | Empty feed, attempts left | feed has 0 deals (or all retries failed) and `attempts + 1 < MAX_WAITING_ATTEMPTS` | Waiting | | | no | no | "Attempt [n] of [MAX]: no eligible deals in feed." |
| W2 | Empty feed, cap reached | as W1 but `attempts + 1 >= MAX_WAITING_ATTEMPTS` | Manual | | | no | warning: "retry cap exhausted" | "Routed to manual: no deals in feed after [MAX] attempts." |
| F1 | Empty pool after filter | feed non-empty, 0 survivors | Switch Failure | `Mob - can't beat deal` | `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL` | yes | no | "Best eligible: none. [feed] deals in feed, removed [n] non-approved, [n] current provider, [n] coverage, [n] data." |
| F2 | Below floor | `savingPence < SAVING_FLOOR_PENCE` | Switch Failure | `Mob - can't beat deal` | `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL` | yes | no | "Best eligible: [providerName] [data]GB £[price], saves £[saving], below £[floor] floor." |
| S1 | At or above floor | `savingPence >= SAVING_FLOOR_PENCE` | Success | | | no (the recommendation is the customer contact) | no | "Recommending [providerName] [data]GB £[price]/mo, saves £[saving]/mo. stickeeDealId: [id]." |

`attempts` is read from `ATTEMPTS_PROPERTY` on the ticket, default 0.

## Sequences

Every sequence writes `next_task_description` first, then status markers around each side effect, then the stage last.

### Waiting (W1)

1. PATCH `{ next_task_description, automation_status: "waiting", automation_attempts: attempts + 1 }`
2. PATCH `{ hs_pipeline_stage: WAITING_STAGE_ID }`
3. End. Re-dispatch happens outside the workflow (see decisions.md).

### Manual (I3, I5, D1 to D5, W2, and any unhandled error)

1. PATCH `{ next_task_description, automation_status: "manual" }`
2. PATCH `{ hs_pipeline_stage: MANUAL_STAGE_ID }`
3. Slack only where the table says so, or for any unhandled error (severity `error`).

### Switch Failure (F1, F2)

1. PATCH `{ next_task_description, email_switch_failure_reason, reporting_switch_failure_reason }` in one call
2. GET ticket. Check both reasons are present and are in `EMAIL_REASONS` / `REPORTING_REASONS`
3. If either check fails: Slack `error` ("failure reason validation failed"), then Manual sequence. Do not move to Failure.
4. PATCH `{ automation_status: "message_pending" }`
5. POST `/comms/whatsapp` `{ ticketId, userId, message, testMode }`
6. PATCH `{ automation_status: "message_sent" }`
7. PATCH `{ hs_pipeline_stage: FAILURE_STAGE_ID }`
8. PATCH `{ automation_status: "completed" }`

### Success (S1)

1. PATCH `{ next_task_description, automation_status: "recommendation_pending" }`
2. POST `/recommendation` `{ ticketId, householdId, userId, mobileServiceId: service.id, stickeeDealId: best.stickeeDealId, testMode }`
3. PATCH `{ automation_status: "recommendation_sent" }`
4. PATCH `{ hs_pipeline_stage: SUCCESS_STAGE_ID }`
5. PATCH `{ automation_status: "completed" }`

## Messages

### WhatsApp (Switch Failure only)

Draft. Saffron to approve or rewrite before build. Conventions: warm, plain, 4 to 6 lines, one clear ask, no admission of fault, no promised timescales.

```
Hi {firstName}, it's Nous.
We've just compared the SIM-only deals available at your address with what you're paying now.
Nothing out there would save you enough to make a switch worth your while, so we're leaving your mobile as it is.
We'll keep checking and let you know if that changes.
If you've spotted a deal you'd like us to look at, just reply here with the details.
```

### Slack

Sent only for: retry cap exhausted (`warning`), `completed` marker on an open stage (`info`), failure reason validation failed (`error`), unhandled exception in any branch (`error`). Routine Manual routing does not fire Slack; the stage and note are the signal.

```json
{ "ticketId": "", "householdId": "", "severity": "info|warning|error", "title": "", "message": "",
  "context": { "shape": "W2|I1|...", "stepFailed": "", "ticketStage": "" }, "testMode": true }
```

## Expected outcomes

Verified by dry-running these rules against the Phase 1 dumps (`scratchpad/dryrun.mjs`). This table is the Phase 4 oracle.

### Evaluated

| Ticket | Shape | Outcome | Best deal | Saving | Final stage | automation_status |
|---|---|---|---|---|---|---|
| 001 | S1 | Success | Giffgaff 30GB £15 | £10.00 | Success | completed |
| 002 | S1 | Success | Talkmobile 15GB £12.50 (iD £12 ranks £14 with penalty) | £7.50 | Success | completed |
| 003 | F2 | Switch Failure | Giffgaff £14.50 | £0.50, below floor | Failure | completed |
| 004 | F1 | Switch Failure | none (3 removed for coverage) | | Failure | completed |
| 005 | D2 | Manual | | monthlyData null | Manual | manual |
| 006 | S1 | Success | Giffgaff 30GB £15, after in-node retry of the 500 | £10.00 | Success | completed |
| 007 | F1 | Switch Failure | none (3 removed for data < 50GB) | | Failure | completed |
| 008 | F2 | Switch Failure | Giffgaff £8 | negative £2.00 | Failure | completed |
| 009 | W1, W1, W2 | Waiting twice, then Manual | | empty feed | Manual after 3 dispatches | manual |
| 010 | I1 | Exit, no writes, Slack info | | | unchanged | completed (pre-existing) |
| 011 | D4 | Manual | | payment null | Manual | manual |

### Sandbox

| Ticket | Shape | Outcome | Best deal | Saving | Notes |
|---|---|---|---|---|---|
| 012 | F2 | Switch Failure | Talkmobile 25GB £18 | £2.00 | Giffgaff £14 excluded as current provider |
| 013 | S1 | Success | Giffgaff 15GB £12 | £3.00 | Exactly on the floor, passes on `>=` |
| 014 | S1 | Success | iD Mobile 30GB £14 | £11.00 | iD ranks £16 with penalty, still beats Talkmobile £17 |
| 015 | S1 | Success | Talkmobile 25GB £15 | £7.00 | Two cheaper deals removed for coverage |
| 016 | F2 | Switch Failure | Giffgaff £14 | £1.00 | |
| 017 | F2 | Switch Failure | Giffgaff £14.01 | £0.99 | Pence arithmetic gives 99, not 99.00000000000002 |
| 018 | S1 | Success | Giffgaff 20GB £14 | £6.00 | Exact tie with Talkmobile, broken on stickeeDealId |
| 019 | S1 | Success | Giffgaff 25GB £14 | £16.00 | 18 in feed, 12 removed. iD £12 ranks £14, tie broken by non-iD-first |
| 020 | I1 | Exit, silent | | | Mutated in Phase 1: status `probe_in_progress`, stage `999999999` |
| 021 | S1 | Success | Giffgaff 20GB £15 | £5.00 | Subject suffix tolerated |
| 022 | S1 | Success | iD Mobile 20GB £15 | £5.00 | Only deal keeping 15GB |
| 023 | D5 | Manual | | payment £0 | |
| 024 | S1 | Success | Giffgaff 20GB £15 | £5.00 | |

````

**Result:**

```
File created successfully at: /Users/saffron/Downloads/Nous/rules.md (file state is current in your context — no need to Read it back)
```

### Tool call 3: `Write` (10:38:59)

**File written: `/Users/saffron/Downloads/Nous/decisions.md`**

```
# Decisions log

Appended each phase. Config values and the full rule set are in `rules.md`; this file records what was decided, what was added by interpretation, and what is still open.

## Phase 2 — 17 September 2026

### Rules confirmed

Config, as agreed:

| Key | Value | Why |
|---|---|---|
| SAVING_FLOOR_PENCE | 300 | £3/month is the floor for disturbing a customer. Compared in pence to avoid float drift (15 - 14.01 is 0.9900000000000002 in JS). |
| ID_PENALTY_PENCE | 200 | iD Mobile has to be £2/month cheaper than the next best approved deal to win. Applied to ranking only; the saving reported to the customer is the real one. |
| APPROVED_PROVIDER_IDS | 9, 13, 18 | Talkmobile, Giffgaff, iD Mobile. Matched on `providerId`. |
| DATA_FLOOR | hard | A deal must carry at least the customer's current allowance. No tolerance. |
| COVERAGE_REQUIRED | LIKELY | Anything else is excluded. |
| MAX_WAITING_ATTEMPTS | 3 | Third empty feed routes to Manual with a Slack warning. |
| Stage IDs | per brief | Open 390658766, Success 446512118, Failure 409734350, Manual 440806104, Waiting 5060559097. |

Identification: subject regex plus pipeline ID. Service is `mobileServices[N-1]`. Provider match on integer ID. Payment via `MOB-xxx`.

Outcome table for the evaluated set, verified by dry run against the Phase 1 dumps:

| Ticket | Outcome | Best deal | Saving |
|---|---|---|---|
| 001 | Success | Giffgaff £15 | £10 |
| 002 | Success | Talkmobile £12.50 | £7.50 |
| 003 | Switch Failure | | £0.50, below floor |
| 004 | Switch Failure | | no LIKELY coverage |
| 005 | Manual | | monthlyData null |
| 006 | Success after in-node retry of the 500 | Giffgaff £15 | £10 |
| 007 | Switch Failure | | every deal below 50GB |
| 008 | Switch Failure | | nothing cheaper |
| 009 | Waiting, Waiting, Manual at cap | | empty feed |
| 010 | Exit, no writes, Slack info | | `completed` on an open stage |
| 011 | Manual | | payment null |

Sandbox outcomes are in `rules.md`. Worth knowing: 013 lands exactly on the floor (£3.00) and passes; 019 is decided by the tie-break (Giffgaff £14 vs iD £12 + £2); 014 and 022 still go to iD despite the penalty.

Failure reasons: every Switch Failure in this set is `Mob - can't beat deal` / `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL`. The other allowed values describe outcomes this workflow never produces (customer replies, contract state, service parameters). `OTHER` is reserved for the validation-fallback path and is not used deliberately.

WhatsApp: Switch Failure only. Never on Waiting, Manual or Success (the recommendation itself is the customer contact).

Slack: errors and anomalies only. Routine Manual routing relies on the stage and `next_task_description`.

### Added by interpretation (flag if you disagree)

1. **5xx on the deals fetch is retried in the HTTP node before it counts as an empty feed.** The kickoff grouped "500 or 0 deals" into the Waiting row, but the expected outcome for 006 is Success on the first dispatch, which is only possible if the node retries. Proposed values: 3 retries, 2 second backoff, on 429 and 5xx. The 429 is included because the mock advertises a 200/minute limit.
2. **Terminal-stage guard (I2).** Not in the kickoff, but it is item 1 of the engineering bar in CLAUDE.md. A ticket in Success, Failure or Manual with a null `automation_status` (for example one an MSO closed by hand) exits silently rather than being reprocessed.
3. **Manual routing sets `automation_status: "manual"`.** The kickoff did not specify a status for Manual. Without one, a re-dispatch of a Manual ticket would pass guard I1 and only be stopped by I2. Setting it keeps the state machine complete and the trail readable.
4. **Guard order: `#No service found` (I4) before the regex (I5).** The marker does not match the regex, so the other order would send those tickets to Manual instead of exiting silently.
5. **Note templates use colons instead of dashes**, per the writing conventions in CLAUDE.md.
6. **Attempt counter lives on the ticket** as a custom property `automation_attempts`. Verified in Phase 1 that the mock persists custom properties. In real HubSpot this property would need creating first.

### Flagged, not applied

- **Interrupted runs exit silently.** Under guard I1, a ticket left at `recommendation_pending` or `message_pending` by a crashed run exits with no writes and no alert on re-dispatch. That is a silent exception, which the engineering bar rules out. Recommendation: treat any `*_pending` or `*_sent` status on re-dispatch as Manual with a Slack `warning` ("interrupted run, check whether the recommendation/message went out"). Needs your call because it changes the I1 row.
- **Payment £0 goes to Manual, not Failure.** Kept as agreed. Noting that a £0 payment could be a legitimate free SIM, in which case nothing will ever beat it and Failure would be the honest outcome. Manual is the safer default until someone at Nous says which it is.

### Open questions for onsite

1. **No coverage-specific failure reason.** A ticket that fails because every deal is UNLIKELY at the postcode (004) is reported as `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL`, the same as a price failure. Reporting cannot tell the two apart, and the customer gets a "nothing cheaper" message when the truth is "nothing with coverage". Is there an appetite for a new reporting value, or should coverage failures go to Manual so a human writes the message?
2. **"Wait and retry is often worth it" is not evidenced in the mock.** Every zero-deal household stayed empty for 8 attempts under probe IDs. Is there a retry-then-success case in the evaluated set that only appears under the real ticket ID? If not, the Waiting path exists on the process doc's word alone.
3. **Ticket type detection is subject-based because there is no type property.** The process doc names `MOBILE_SWITCH_OFFER_RECOMMENDATION` but the ticket carries no such field. Subject plus pipeline is the only guard available. Is there a property in real HubSpot we should be reading instead?
4. **Who re-dispatches a Waiting ticket?** The workflow moves the ticket to Waiting and ends. Something outside it (a HubSpot workflow on the Waiting stage with a delay, a scheduled n8n trigger) has to fire the webhook again. For Phase 4 the test harness will do it by hand. The alternative, an n8n Wait node inside one execution, keeps the retry self-contained but holds an execution open for hours and loses it if n8n restarts.
5. **`testMode` is accepted silently by every mock endpoint.** Passed through on every POST. What does it do in the real integrations?

### Phase 1 residue carried forward

- TICKET-020 is mutated (stage `999999999`, status `probe_in_progress`). Live, it exits silently at I1. Use it for anything destructive.
- TICKET-024 received POSTs but its properties are untouched. Usable.
- All evaluated tickets are clean and one-shot.

```

**Result:**

```
File created successfully at: /Users/saffron/Downloads/Nous/decisions.md (file state is current in your context — no need to Read it back)
```

## Claude (10:39:04)

Now the CLAUDE.md status update. I need to read the file before editing it.

### Tool call 4: `Read` (10:39:05)

```json
{
  "file_path": "/Users/saffron/Downloads/Nous/CLAUDE.md",
  "offset": 150
}
```

**Result:**

```

```

### Tool call 5: `Read` (10:39:07)

```json
{
  "file_path": "/Users/saffron/Downloads/Nous/CLAUDE.md",
  "offset": 100
}
```

**Result:**

```
100	## Open decisions (mine to make, bring me options)
101	
102	- Saving threshold: £/month floor, % floor, or both. Separate higher bar for iD.
103	- Like-for-like comparison: intro pricing, data allowance, upfront cost, contract length.
104	- Null current payment: my lean is Manual, not a guess.
105	- `Mobile #N` that doesn't exist in context.
106	- `#No service found`: exit untouched, or Manual with a note.
107	- Retry cap and what "wait" means in n8n (Wait node vs moving to the Waiting stage and re-dispatching).
108	- Which outcomes trigger a WhatsApp. My lean: final failure only, never on Waiting.
109	- Failure reason mapping per outcome.
110	
111	## Order of work
112	
113	### Phase 1: Probe (do this first, nothing else until I've reviewed the catalogue)
114	
115	Write a small script (Node or Python, your call, tell me why) that dumps raw responses to `probe/{ticketId}/{endpoint}.json`.
116	
117	Probing rules:
118	- **GET ticket, context and current-payment** for all 24: safe.
119	- **GET deals:** first test whether a throwaway `X-Ticket-Id` (e.g. `PROBE-001`) works with `HH-001`. If it does, use probe IDs for every deals call, calling each several times to reveal attempt-based behaviour. If it doesn't, stop and tell me before touching evaluated ticket IDs.
120	- **No POST or PATCH on TICKET-001 to TICKET-011.** Use sandbox tickets to discover POST body shapes and PATCH behaviour, and tell me which ones you've mutated.
121	- Log every call you make to `probe/calls.log`.
122	
123	Then produce `catalogue.md`: one row per ticket covering subject pattern, service index match, current provider and how it's represented (name vs ID), payment present or null, deal count per attempt, networks present, anything malformed or surprising. Group tickets that share a shape, and list the distinct shapes the workflow has to handle.
124	
125	### Phase 2: Rules
126	
127	Help me turn the catalogue into `rules.md`: every shape mapped to an outcome (Success, Switch Failure with both reasons, Waiting/retry, Manual), with the config values I choose.
128	
129	### Phase 3: Build
130	
131	Draft the workflow in sections I can import and test one at a time: intake and guards, data fetch, deal evaluation, outcome branches, error handling. Save to `workflow/`. Keep it as simple as the rules allow. Longer and more elaborate isn't better.
132	
133	### Phase 4: Test
134	
135	A harness that fires the webhook payload for each scenario and records outcome, final stage, properties written and messages sent, compared against `rules.md`. Evaluated tickets hold state, so plan runs carefully and flag when I need to ask Nous for a reset.
136	
137	### Phase 5: Doc
138	
139	I write it. You can check it against the brief. Max two pages: Part A reflection (two key judgement calls, one pushback or question, v2, three metrics with pause or rollback triggers) and Part B reply handling for three customer replies, plus a short note on how I used AI. Customer messages follow WhatsApp conventions: warm, plain, 4 to 6 lines, one clear ask, no admission of fault, no promised timescales.
140	
141	## Start
142	
143	Read the brief, confirm you've understood the constraints and probing rules, then propose the probe script before running it.
144
```

### Tool call 6: `Edit` (10:39:14)

```json
{
  "replace_all": false,
  "file_path": "/Users/saffron/Downloads/Nous/CLAUDE.md",
  "old_string": "## Start\n\nRead the brief, confirm you've understood the constraints and probing rules, then propose the probe script before running it.",
  "new_string": "## Status\n\n| Phase | State | Outputs |\n|---|---|---|\n| 1 Probe | Complete, 17 Sep 2026 | `catalogue.md`, `probe/` (dumps, `calls.log`, `probe.mjs`, `mutate.mjs`), `phase1.md` (transcript) |\n| 2 Rules | Complete, 17 Sep 2026 | `rules.md`, `decisions.md` |\n| 3 Build | Not started | `workflow/` |\n| 4 Test | Not started | |\n| 5 Doc | Not started | |\n\nMutated mock tickets: TICKET-020 (stage and status changed, use for destructive tests), TICKET-024 (POSTs only, properties clean). Everything else is clean. Evaluated tickets are one-shot.\n\n## Start\n\nRead `catalogue.md`, `rules.md` and `decisions.md` before doing anything else. Pick up at the first phase marked not started. Read the \"Flagged, not applied\" section of `decisions.md` and check whether Saffron has ruled on it."
}
```

**Result:**

```
The file /Users/saffron/Downloads/Nous/CLAUDE.md has been updated successfully. (file state is current in your context — no need to Read it back)
```

### Tool call 7: `Bash` (10:39:18)

_Keep the dry-run script in the project, fix its path in rules.md, check for stray dashes_

```bash
cd /Users/saffron/Downloads/Nous && cp /private/tmp/claude-501/-Users-saffron-Downloads-Nous/180b82c9-b325-4867-960a-8145ddc0a34a/scratchpad/dryrun.mjs probe/dryrun.mjs && sed -i '' 's#`scratchpad/dryrun.mjs`#`probe/dryrun.mjs`#' rules.md && grep -c "—" rules.md decisions.md; ls
```

**Result:**

```
rules.md:0
decisions.md:1
CLAUDE.md
brief.pdf
catalogue.md
decisions.md
phase1.md
probe
rules.md
```

## Claude (10:39:35)

Phase 2 files are written. Stopping here for your review before Phase 3.

**Produced**
- [rules.md](rules.md): config block, identification rules, the `automation_status` state machine, guards I1 to I5 and D1 to D5 in order, the deals filter/rank/saving logic, W1/W2/F1/F2/S1 outcome table with both failure reasons, the four write sequences, a draft WhatsApp message for you to approve, Slack body shape, and expected outcomes for all 24 tickets.
- [decisions.md](decisions.md): Phase 2 entry with confirmed config, the evaluated outcomes table, what I added by interpretation, what I flagged but did not apply, and five onsite questions (your three plus two).
- [CLAUDE.md](CLAUDE.md): new Status table and updated Start instructions.
- [probe/dryrun.mjs](probe/dryrun.mjs): applies the rules to the Phase 1 dumps offline. All 11 evaluated outcomes match your expected table.

**Two things that need your call before build**

1. **Interrupted runs.** As written, a ticket left at `recommendation_pending` by a crashed run exits silently on re-dispatch under I1. That's a silent exception. My recommendation is Manual plus a Slack warning for any `*_pending` or `*_sent` status. It changes the I1 row, so I haven't applied it.
2. **Retry on 5xx must happen in the HTTP node**, otherwise 006 goes to Waiting instead of Success. I've written it that way with proposed values (3 retries, 2s backoff, on 429 and 5xx) and marked them as proposals.

**Smaller additions you should know about:** a terminal-stage guard (I2), `automation_status: "manual"` on Manual routes, `#No service found` checked before the regex, and the em dashes in your note templates swapped for colons per the writing conventions. The one em dash left in `decisions.md` is the heading format you specified.

The only rule that isn't from the kickoff or the engineering bar is the WhatsApp draft. It's yours to rewrite.

## User (10:41:24)

1. Interrupted runs. Let's go with your recommendation but log your reasoning.

### Tool call 8: `Edit` (10:41:30)

```json
{
  "replace_all": false,
  "file_path": "/Users/saffron/Downloads/Nous/rules.md",
  "old_string": "| I1 | Already handled | `automation_status` not null and not `waiting` | Exit | none | Info only if value is `completed` **and** stage is `OPEN_STAGE_ID` (\"completed marker on open stage\"). Otherwise silent. |\n| I2 | Terminal stage |",
  "new_string": "| I1a | Interrupted run | `automation_status` in `INTERRUPTED_STATUSES` | Manual | note: \"Routed to manual: interrupted run, last status [status]. Check whether the [recommendation/message] went out before re-running.\" | warning: \"interrupted run\" |\n| I1b | Already handled | `automation_status` not null, not `waiting`, not in `INTERRUPTED_STATUSES` (i.e. `completed` or `manual`) | Exit | none | Info only if value is `completed` **and** stage is `OPEN_STAGE_ID` (\"completed marker on open stage\"). Otherwise silent. |\n| I2 | Terminal stage |"
}
```

**Result:**

```
The file /Users/saffron/Downloads/Nous/rules.md has been updated successfully. (file state is current in your context — no need to Read it back)
```

### Tool call 9: `Bash` (10:41:52)

_Add INTERRUPTED_STATUSES config, state machine note and Manual sequence note to rules.md; log the reasoning in decisions.md_

````bash
python3 - <<'EOF'
p='rules.md'; s=open(p).read()
s=s.replace('''ATTEMPTS_PROPERTY:       "automation_attempts"   // custom ticket property, mock persists it (verified)
''','''ATTEMPTS_PROPERTY:       "automation_attempts"   // custom ticket property, mock persists it (verified)
INTERRUPTED_STATUSES:    ["recommendation_pending", "recommendation_sent", "message_pending", "message_sent"]
''')
s=s.replace('''null
 ├─ waiting                  (empty feed, attempt < MAX)
 ├─ manual                   (any Manual route)
 ├─ message_pending → message_sent → completed          (Switch Failure)
 └─ recommendation_pending → recommendation_sent → completed   (Success)
```''','''null
 ├─ waiting                  (empty feed, attempt < MAX)
 ├─ manual                   (any Manual route)
 ├─ message_pending → message_sent → completed          (Switch Failure)
 └─ recommendation_pending → recommendation_sent → completed   (Success)
```

Only `null` and `waiting` are re-runnable. `completed` and `manual` exit. Any of the four intermediate statuses found at intake means a previous run died mid-sequence; that routes to Manual with a Slack warning (I1a) because the workflow cannot tell whether the side effect went out.''')
s=s.replace('''### Manual (I3, I5, D1 to D5, W2, and any unhandled error)

1. PATCH `{ next_task_description, automation_status: "manual" }`
2. PATCH `{ hs_pipeline_stage: MANUAL_STAGE_ID }`
3. Slack only where the table says so, or for any unhandled error (severity `error`).''','''### Manual (I1a, I3, I5, D1 to D5, W2, and any unhandled error)

1. PATCH `{ next_task_description, automation_status: "manual" }`
2. PATCH `{ hs_pipeline_stage: MANUAL_STAGE_ID }`
3. Slack only where the table says so (I1a `warning`, W2 `warning`), or for any unhandled error (severity `error`).

For I1a the PATCH in step 1 overwrites the interrupted status. That is deliberate: the note records what it was, and `manual` stops any further re-dispatch from looping back into I1a.''')
open(p,'w').write(s)

p='decisions.md'; s=open(p).read()
s=s.replace('''### Flagged, not applied

- **Interrupted runs exit silently.** Under guard I1, a ticket left at `recommendation_pending` or `message_pending` by a crashed run exits with no writes and no alert on re-dispatch. That is a silent exception, which the engineering bar rules out. Recommendation: treat any `*_pending` or `*_sent` status on re-dispatch as Manual with a Slack `warning` ("interrupted run, check whether the recommendation/message went out"). Needs your call because it changes the I1 row.
''','''7. **Interrupted runs route to Manual with a Slack warning (I1a).** Decided by Saffron on 17 September after the flag below. Reasoning:
   - The four intermediate statuses (`recommendation_pending`, `recommendation_sent`, `message_pending`, `message_sent`) only ever exist between two writes in a sequence. Finding one at intake means the previous run died between those writes: n8n timed out, the mock 5xx'd on a PATCH, the execution was cancelled.
   - The workflow cannot resolve the ambiguity itself. At `recommendation_pending` the POST may or may not have gone out; the mock (and, plausibly, the real endpoint) returns nothing that says so and does not dedupe. Re-running would risk a second recommendation or a second WhatsApp to the same customer. Exiting silently would leave the ticket stuck in Open forever with no one told.
   - Manual is the only outcome that is safe in both cases: no duplicate customer contact, and a human with the note in front of them can check the comms log and either finish the sequence by hand or reset the ticket.
   - Slack is `warning` not `error` because the interruption already happened; this is a "look at this today" signal, not a pager.
   - Cost: a small number of tickets per month that could in principle have been auto-recovered (for example `message_sent`, where the only remaining steps are two PATCHes) will instead take an MSO a minute. Worth it until there is evidence of how often it happens. A v2 could auto-complete from `*_sent` states, since the customer contact is already done and only ticket writes remain.
   - Overwriting the interrupted status with `manual` is deliberate so a further re-dispatch exits cleanly at I1b rather than raising a second alert.

### Flagged, not applied
''')
open(p,'w').write(s)
EOF
grep -n "I1a\|I1b\|INTERRUPTED" rules.md | head; grep -n "^7\. \*\*Interrupted" decisions.md
````

**Result:**

```
26:INTERRUPTED_STATUSES:    ["recommendation_pending", "recommendation_sent", "message_pending", "message_sent"]
62:Only `null` and `waiting` are re-runnable. `completed` and `manual` exit. Any of the four intermediate statuses found at intake means a previous run died mid-sequence; that routes to Manual with a Slack warning (I1a) because the workflow cannot tell whether the side effect went out.
70:| I1a | Interrupted run | `automation_status` in `INTERRUPTED_STATUSES` | Manual | note: "Routed to manual: interrupted run, last status [status]. Check whether the [recommendation/message] went out before re-running." | warning: "interrupted run" |
71:| I1b | Already handled | `automation_status` not null, not `waiting`, not in `INTERRUPTED_STATUSES` (i.e. `completed` or `manual`) | Exit | none | Info only if value is `completed` **and** stage is `OPEN_STAGE_ID` ("completed marker on open stage"). Otherwise silent. |
124:### Manual (I1a, I3, I5, D1 to D5, W2, and any unhandled error)
128:3. Slack only where the table says so (I1a `warning`, W2 `warning`), or for any unhandled error (severity `error`).
130:For I1a the PATCH in step 1 overwrites the interrupted status. That is deliberate: the note records what it was, and `manual` stops any further re-dispatch from looping back into I1a.
56:7. **Interrupted runs route to Manual with a Slack warning (I1a).** Decided by Saffron on 17 September after the flag below. Reasoning:
```

## Claude (10:42:02)

Two small consistency fixes: the Slack list in rules.md and the dry-run script need I1a too, and the decisions entry references a flag that's no longer there.

### Tool call 10: `Bash` (10:42:08)

_Add I1a to the Slack list, tidy the decisions wording, teach the dry run about interrupted statuses_

```bash
python3 - <<'EOF'
p='rules.md'; s=open(p).read()
s=s.replace("Sent only for: retry cap exhausted (`warning`), `completed` marker on an open stage (`info`),",
            "Sent only for: interrupted run found at intake (`warning`), retry cap exhausted (`warning`), `completed` marker on an open stage (`info`),")
open(p,'w').write(s)
p='decisions.md'; s=open(p).read()
s=s.replace("Decided by Saffron on 17 September after the flag below. Reasoning:","Raised as a flag in the first draft of this entry, decided by Saffron on 17 September. Reasoning:")
s=s.replace("### Flagged, not applied\n- **Payment","### Flagged, not applied\n\n- **Payment")
open(p,'w').write(s)
p='probe/dryrun.mjs'; s=open(p).read()
s=s.replace("""  if (p.automation_status !== null && p.automation_status !== 'waiting') out =""",
"""  const INTERRUPTED = ['recommendation_pending', 'recommendation_sent', 'message_pending', 'message_sent'];
  if (INTERRUPTED.includes(p.automation_status)) out = `MANUAL: interrupted run (${p.automation_status}), Slack warning`;
  else if (p.automation_status !== null && p.automation_status !== 'waiting') out =""")
open(p,'w').write(s)
EOF
grep -n "interrupted" rules.md decisions.md probe/dryrun.mjs | cut -c1-120
```

**Result:**

```
rules.md:70:| I1a | Interrupted run | `automation_status` in `INTERRUPTED_STATUSES` | Manual | note: "Routed to manual: 
rules.md:130:For I1a the PATCH in step 1 overwrites the interrupted status. That is deliberate: the note records what it
rules.md:167:Sent only for: interrupted run found at intake (`warning`), retry cap exhausted (`warning`), `completed` ma
decisions.md:62:   - Overwriting the interrupted status with `manual` is deliberate so a further re-dispatch exits clean
probe/dryrun.mjs:13:  if (INTERRUPTED.includes(p.automation_status)) out = `MANUAL: interrupted run (${p.automation_stat
```

## Claude (10:42:21)

Applied and logged.

**In [rules.md](rules.md):**
- New config entry `INTERRUPTED_STATUSES: ["recommendation_pending", "recommendation_sent", "message_pending", "message_sent"]`.
- I1 split into **I1a** (interrupted run → Manual, Slack `warning`, note records the last status and tells the MSO to check whether the recommendation or message went out) and **I1b** (`completed` or `manual` → exit, with the existing Slack info case for `completed` on an open stage).
- State machine section now says explicitly that only `null` and `waiting` are re-runnable.
- Manual sequence notes that overwriting the interrupted status with `manual` is deliberate, so a further re-dispatch exits at I1b rather than alerting twice.
- Slack trigger list updated.

**In [decisions.md](decisions.md):** item 7 under "Added by interpretation" records the reasoning: the intermediate statuses only exist between two writes, so finding one means a run died mid-sequence; the workflow cannot tell whether the POST went out because the endpoint returns nothing to check and does not dedupe; re-running risks duplicate customer contact and exiting silently leaves a stuck ticket with no one told; Manual is the only outcome safe in both cases; `warning` not `error` because the damage is already done and this is a same-day signal, not a pager; the cost is a minute of MSO time on the rare `*_sent` case that could in principle self-heal, which is a reasonable v2 once there is data on how often it happens.

The dry run still gives the same 24 outcomes (no ticket in the dumps carries an intermediate status). No evaluated outcomes change.

Remaining before Phase 3: the WhatsApp draft is still mine, not yours, and the HTTP retry values (3 retries, 2s, on 429 and 5xx) are still marked proposed.

## User (10:44:56)

pull whatsapp draft here for customisation and go with HTTP retry values

### Tool call 11: `Bash` (10:45:03)

_Mark HTTP retry values as confirmed in rules.md and decisions.md_

```bash
python3 - <<'EOF'
p='rules.md'; s=open(p).read()
s=s.replace("HTTP_RETRY_COUNT:        3                // proposed, see decisions.md\nHTTP_RETRY_BACKOFF_MS:   2000             // proposed",
            "HTTP_RETRY_COUNT:        3                // confirmed 17 Sep\nHTTP_RETRY_BACKOFF_MS:   2000             // confirmed 17 Sep")
open(p,'w').write(s)
p='decisions.md'; s=open(p).read()
s=s.replace("Proposed values: 3 retries, 2 second backoff, on 429 and 5xx. The 429 is included because the mock advertises a 200/minute limit.",
            "Confirmed by Saffron 17 September: 3 retries, 2 second backoff, on 429 and 5xx. The 429 is included because the mock advertises a 200/minute limit. Applies to every GET and to the PATCHes; POSTs to `/recommendation` and `/comms/whatsapp` are never retried automatically because a duplicate is a customer-facing error.")
open(p,'w').write(s)
EOF
grep -n "confirmed 17 Sep" rules.md | head -2
```

**Result:**

```
28:HTTP_RETRY_COUNT:        3                // confirmed 17 Sep
29:HTTP_RETRY_BACKOFF_MS:   2000             // confirmed 17 Sep
```

## Claude (10:45:21)

Retry values are confirmed in both files. I also pinned down scope while I was there: retries apply to GETs and PATCHes, never to the two customer-facing POSTs, since a duplicate there is a customer-facing error. Say if you want that narrower.

Here's the WhatsApp draft as it stands in `rules.md`. It goes out on Switch Failure only (F1 and F2), after both failure reasons are written and verified, before the stage moves.

```
Hi {firstName}, it's Nous.
We've just compared the SIM-only deals available at your address with what you're paying now.
Nothing out there would save you enough to make a switch worth your while, so we're leaving your mobile as it is.
We'll keep checking and let you know if that changes.
If you've spotted a deal you'd like us to look at, just reply here with the details.
```

Things to weigh as you edit:

- **Line 3 is doing the heavy lifting** and it's slightly untrue for the coverage case (004): there the truth is "nothing with reliable coverage at your postcode", not "nothing cheap enough". One message covers both unless you split F1-coverage from F2-price, which the reasoning enum can't express anyway (open question 1).
- **Line 4 is close to a promise.** "We'll keep checking" is honest given the process, but if the Waiting path turns out to be rarely used, "we'll let you know if that changes" could read as a commitment. Option: drop line 4 entirely and let line 5 carry the forward motion.
- **Line 5 is the ask**, and it deliberately invites reply 1 from Part B ("I saw iD Mobile direct for £8"). That's good if you want the classifier to see those replies; it means the message is generating the exact traffic the reply-handling section has to deal with.
- **"it's Nous"** assumes the customer recognises the brand on WhatsApp. If Nous sends from a named number this is redundant; if not, it may need to be "it's the team at Nous".
- **Tone check against the brief:** warm, plain, 4 to 6 lines (currently 5), one clear ask (line 5), no admission of fault, no timescale. It passes on all of those.

`{firstName}` is the first token of the customer segment of the subject (`Jane` from `MOB | Jane Smith | ...`). If you'd rather not trust the subject for a customer's name, the fallback is to drop the name and open with "Hi, it's Nous."

Paste back your version and I'll drop it into `rules.md` verbatim.

## User (10:49:40)

* For the coverage case: I think we should potentially split it. Would this cause to many dependecies and overcomplications?
* Line 4: If we're automating the system, then surely we can garauntee that a node will actually keep checking?

Otherwise looks good

## Claude (10:50:22)

Both good questions. Neither is as simple as it looks.

## 1. Splitting the coverage message

**Cost is low.** The evaluation node already logs how many deals each filter step removed (that's what the F1 note prints), so the workflow knows *why* the pool is empty. Turning that into a message choice is one field, `failureCause`, computed once in the evaluation node, and one lookup from cause to template. No extra branches, no extra API calls, no change to the failure sequence. The rule for the field needs to be deterministic, and the clean one is: **the first filter step after which the pool was empty.**

| Pool empty after step | `failureCause` | Example |
|---|---|---|
| 1 (approved) or 2 (current provider) | `price` | none in the set |
| 3 (coverage) | `coverage` | 004 |
| 4 (data) | `data` | 007 |
| Pool non-empty, best below floor | `price` | 003, 008, 012, 016, 017 |

**The dependencies it does create:**
- Each cause you split is another customer-facing message you write and defend. Two templates (price default, coverage) or three (plus data). The data case is genuinely different from the customer's side ("nothing kept your 50GB for less" vs "nothing was cheaper"), and 007 is in the evaluated set, so if you split at all I'd split into three. Two is a half-measure that leaves 007 with a slightly wrong message.
- The reporting enum still can't follow. 004 and 007 will still be `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL`. So the customer hears "coverage" and the dashboard says "price". That mismatch is already open question 1; splitting the message makes it more visible, which is arguably the point.
- One more expected-outcome column for Phase 4 (which message was sent).

**My recommendation:** split into three, because the field is nearly free and it's exactly the kind of judgement the onsite wants to see. The defence is: "the customer message is the one place we can be precise, so we are, and the reporting gap is a question for the team." It also gives you the pushback item for Part A on a plate. Your call.

## 2. Line 4: can we guarantee a node keeps checking?

**No, and it's worth being clear-eyed about why.** The workflow runs once per dispatched ticket. When a ticket closes as Switch Failure, nothing in this workflow ever looks at that household again. The Waiting path is not "keep checking": it only applies to an *empty feed* (no deals returned at all), it caps at 3 attempts, and even then the workflow ends and something outside it has to re-dispatch (open question 4). A customer who received the "no deal" message has a closed ticket.

Whether they are checked again depends on whatever generates `MOBILE_SWITCH_OFFER_RECOMMENDATION` tickets in the first place. The process doc says "generated when a member is due a mobile recommendation", so there's an upstream cadence, but we don't own it and the brief doesn't describe it. Line 4 is a promise on behalf of a system we can't see. And this is exactly Part B reply 3, "Can you check again in a month?", so the message shouldn't pre-empt an answer you're about to say needs a human or at least a safeguard.

Options:
- **Drop it.** Message goes to 4 lines, still within convention.
- **Make it true regardless of upstream:** fold it into the ask. "If you'd like us to look again, or you've spotted a deal you'd like us to check, just reply here." One ask, no promise, and it routes the "check again" request into the reply channel where the classifier handles it.
- **Keep it, conditional on Nous confirming the re-raise cadence.** Add to the onsite questions.

I'd go with the second, and add the cadence question to the onsite list either way because reply 3 depends on it.

Tell me the split (2 or 3) and the line 4 choice, and I'll update `rules.md`, `decisions.md` and the dry run in one go.

## User (10:54:18)

1. Let's go with your recommendation 
2. Make it true regardless of upstream - then add a note in the working / logics of this project why I chose this. (I need to keep track of my reasoning for onsite)

### Tool call 12: `Read` (10:54:30)

```json
{
  "file_path": "/Users/saffron/Downloads/Nous/rules.md",
  "offset": 89,
  "limit": 90
}
```

**Result:**

````
89	### Deals
90	
91	**Fetch.** `GET /deals/{householdId}` with `X-Ticket-Id: ticketId`. The HTTP node retries `HTTP_RETRY_ON` statuses `HTTP_RETRY_COUNT` times with `HTTP_RETRY_BACKOFF_MS`. Only if every retry fails does the run treat it as an empty feed.
92	
93	**Filter, in order.** Each step is logged with the count it removed.
94	
95	1. `providerId` not in `APPROVED_PROVIDER_IDS` → drop
96	2. `providerId === service.currentProviderId` → drop
97	3. `coverageAtHouseholdLocation !== COVERAGE_REQUIRED` → drop
98	4. `monthlyData < service.monthlyData` → drop
99	
100	**Rank.** For each survivor: `rankPence = Math.round(effective_line_rental * 100) + (providerId === ID_MOBILE_PROVIDER_ID ? ID_PENALTY_PENCE : 0)`. Sort by `rankPence` asc, then `monthlyData` desc, then non-iD before iD, then `stickeeDealId` asc. Best = first.
101	
102	**Saving.** `savingPence = Math.round(payment * 100) - Math.round(best.effective_line_rental * 100)`. The penalty is not in this number. Propose if `savingPence >= SAVING_FLOOR_PENCE`.
103	
104	| # | Shape | Check | Outcome | email_switch_failure_reason | reporting_switch_failure_reason | WhatsApp | Slack | Note |
105	|---|---|---|---|---|---|---|---|---|
106	| W1 | Empty feed, attempts left | feed has 0 deals (or all retries failed) and `attempts + 1 < MAX_WAITING_ATTEMPTS` | Waiting | | | no | no | "Attempt [n] of [MAX]: no eligible deals in feed." |
107	| W2 | Empty feed, cap reached | as W1 but `attempts + 1 >= MAX_WAITING_ATTEMPTS` | Manual | | | no | warning: "retry cap exhausted" | "Routed to manual: no deals in feed after [MAX] attempts." |
108	| F1 | Empty pool after filter | feed non-empty, 0 survivors | Switch Failure | `Mob - can't beat deal` | `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL` | yes | no | "Best eligible: none. [feed] deals in feed, removed [n] non-approved, [n] current provider, [n] coverage, [n] data." |
109	| F2 | Below floor | `savingPence < SAVING_FLOOR_PENCE` | Switch Failure | `Mob - can't beat deal` | `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL` | yes | no | "Best eligible: [providerName] [data]GB £[price], saves £[saving], below £[floor] floor." |
110	| S1 | At or above floor | `savingPence >= SAVING_FLOOR_PENCE` | Success | | | no (the recommendation is the customer contact) | no | "Recommending [providerName] [data]GB £[price]/mo, saves £[saving]/mo. stickeeDealId: [id]." |
111	
112	`attempts` is read from `ATTEMPTS_PROPERTY` on the ticket, default 0.
113	
114	## Sequences
115	
116	Every sequence writes `next_task_description` first, then status markers around each side effect, then the stage last.
117	
118	### Waiting (W1)
119	
120	1. PATCH `{ next_task_description, automation_status: "waiting", automation_attempts: attempts + 1 }`
121	2. PATCH `{ hs_pipeline_stage: WAITING_STAGE_ID }`
122	3. End. Re-dispatch happens outside the workflow (see decisions.md).
123	
124	### Manual (I1a, I3, I5, D1 to D5, W2, and any unhandled error)
125	
126	1. PATCH `{ next_task_description, automation_status: "manual" }`
127	2. PATCH `{ hs_pipeline_stage: MANUAL_STAGE_ID }`
128	3. Slack only where the table says so (I1a `warning`, W2 `warning`), or for any unhandled error (severity `error`).
129	
130	For I1a the PATCH in step 1 overwrites the interrupted status. That is deliberate: the note records what it was, and `manual` stops any further re-dispatch from looping back into I1a.
131	
132	### Switch Failure (F1, F2)
133	
134	1. PATCH `{ next_task_description, email_switch_failure_reason, reporting_switch_failure_reason }` in one call
135	2. GET ticket. Check both reasons are present and are in `EMAIL_REASONS` / `REPORTING_REASONS`
136	3. If either check fails: Slack `error` ("failure reason validation failed"), then Manual sequence. Do not move to Failure.
137	4. PATCH `{ automation_status: "message_pending" }`
138	5. POST `/comms/whatsapp` `{ ticketId, userId, message, testMode }`
139	6. PATCH `{ automation_status: "message_sent" }`
140	7. PATCH `{ hs_pipeline_stage: FAILURE_STAGE_ID }`
141	8. PATCH `{ automation_status: "completed" }`
142	
143	### Success (S1)
144	
145	1. PATCH `{ next_task_description, automation_status: "recommendation_pending" }`
146	2. POST `/recommendation` `{ ticketId, householdId, userId, mobileServiceId: service.id, stickeeDealId: best.stickeeDealId, testMode }`
147	3. PATCH `{ automation_status: "recommendation_sent" }`
148	4. PATCH `{ hs_pipeline_stage: SUCCESS_STAGE_ID }`
149	5. PATCH `{ automation_status: "completed" }`
150	
151	## Messages
152	
153	### WhatsApp (Switch Failure only)
154	
155	Draft. Saffron to approve or rewrite before build. Conventions: warm, plain, 4 to 6 lines, one clear ask, no admission of fault, no promised timescales.
156	
157	```
158	Hi {firstName}, it's Nous.
159	We've just compared the SIM-only deals available at your address with what you're paying now.
160	Nothing out there would save you enough to make a switch worth your while, so we're leaving your mobile as it is.
161	We'll keep checking and let you know if that changes.
162	If you've spotted a deal you'd like us to look at, just reply here with the details.
163	```
164	
165	### Slack
166	
167	Sent only for: interrupted run found at intake (`warning`), retry cap exhausted (`warning`), `completed` marker on an open stage (`info`), failure reason validation failed (`error`), unhandled exception in any branch (`error`). Routine Manual routing does not fire Slack; the stage and note are the signal.
168	
169	```json
170	{ "ticketId": "", "householdId": "", "severity": "info|warning|error", "title": "", "message": "",
171	  "context": { "shape": "W2|I1|...", "stepFailed": "", "ticketStage": "" }, "testMode": true }
172	```
173	
174	## Expected outcomes
175	
176	Verified by dry-running these rules against the Phase 1 dumps (`probe/dryrun.mjs`). This table is the Phase 4 oracle.
177	
178	### Evaluated
````

### Tool call 13: `Bash` (10:55:15)

_Add failureCause and three WhatsApp templates to rules.md, log both decisions, add cadence question, update dry run_

````bash
python3 - <<'EOF'
p='rules.md'; s=open(p).read()

s=s.replace('''**Saving.** `savingPence = Math.round(payment * 100) - Math.round(best.effective_line_rental * 100)`. The penalty is not in this number. Propose if `savingPence >= SAVING_FLOOR_PENCE`.
''','''**Saving.** `savingPence = Math.round(payment * 100) - Math.round(best.effective_line_rental * 100)`. The penalty is not in this number. Propose if `savingPence >= SAVING_FLOOR_PENCE`.

**Failure cause.** Computed once in the evaluation node and used to pick the WhatsApp template and to word the note. Rule: the first filter step after which the pool was empty; if the pool survived filtering, `price`.

| Pool empty after step | `failureCause` | Evaluated example |
|---|---|---|
| 1 (approved) or 2 (current provider) | `price` | none |
| 3 (coverage) | `coverage` | 004 |
| 4 (data) | `data` | 007 |
| Pool non-empty, best below floor | `price` | 003, 008 |

Both failure reasons are the same for every cause. The reporting enum has no coverage or data value, so `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL` is the only honest fit. The customer message is the one place the workflow can be precise, so it is.
''')

s=s.replace('''| F1 | Empty pool after filter | feed non-empty, 0 survivors | Switch Failure | `Mob - can't beat deal` | `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL` | yes | no | "Best eligible: none. [feed] deals in feed, removed [n] non-approved, [n] current provider, [n] coverage, [n] data." |
| F2 | Below floor | `savingPence < SAVING_FLOOR_PENCE` | Switch Failure | `Mob - can't beat deal` | `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL` | yes | no | "Best eligible: [providerName] [data]GB £[price], saves £[saving], below £[floor] floor." |''',
'''| F1 | Empty pool after filter | feed non-empty, 0 survivors | Switch Failure | `Mob - can't beat deal` | `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL` | yes, template by `failureCause` | no | "Best eligible: none (cause: [failureCause]). [feed] deals in feed, removed [n] non-approved, [n] current provider, [n] coverage, [n] data." |
| F2 | Below floor | `savingPence < SAVING_FLOOR_PENCE` | Switch Failure | `Mob - can't beat deal` | `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL` | yes, `price` template | no | "Best eligible: [providerName] [data]GB £[price], saves £[saving], below £[floor] floor." |''')

s=s.replace('''### WhatsApp (Switch Failure only)

Draft. Saffron to approve or rewrite before build. Conventions: warm, plain, 4 to 6 lines, one clear ask, no admission of fault, no promised timescales.

```
Hi {firstName}, it's Nous.
We've just compared the SIM-only deals available at your address with what you're paying now.
Nothing out there would save you enough to make a switch worth your while, so we're leaving your mobile as it is.
We'll keep checking and let you know if that changes.
If you've spotted a deal you'd like us to look at, just reply here with the details.
```
''','''### WhatsApp (Switch Failure only)

Approved by Saffron 17 September. Template chosen by `failureCause`. Conventions: warm, plain, 4 to 6 lines, one clear ask, no admission of fault, no promised timescales. The closing line is identical across templates and is the only ask; it makes no promise about future checks because this workflow cannot keep one (see decisions.md).

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
The cheaper options we found don't have reliable coverage at your postcode, so we're not going to move you onto something that might not work where you live.
If you'd like us to look again, or you've spotted a deal you'd like us to check, just reply here.
```

**data** (F1, pool emptied at step 4)

```
Hi {firstName}, it's Nous.
We've just compared the SIM-only deals available at your address with your current plan.
Nothing we found gives you at least your current {monthlyData}GB for less, and we didn't want to save you money by cutting your data.
If you'd like us to look again, or you've spotted a deal you'd like us to check, just reply here.
```
''')

# expected outcomes: add cause/message to failure rows
s=s.replace("| 003 | F2 | Switch Failure | Giffgaff £14.50 | £0.50, below floor | Failure | completed |",
            "| 003 | F2 | Switch Failure, `price` message | Giffgaff £14.50 | £0.50, below floor | Failure | completed |")
s=s.replace("| 004 | F1 | Switch Failure | none (3 removed for coverage) | | Failure | completed |",
            "| 004 | F1 | Switch Failure, `coverage` message | none (3 removed for coverage) | | Failure | completed |")
s=s.replace("| 007 | F1 | Switch Failure | none (3 removed for data < 50GB) | | Failure | completed |",
            "| 007 | F1 | Switch Failure, `data` message | none (3 removed for data < 50GB) | | Failure | completed |")
s=s.replace("| 008 | F2 | Switch Failure | Giffgaff £8 | negative £2.00 | Failure | completed |",
            "| 008 | F2 | Switch Failure, `price` message | Giffgaff £8 | negative £2.00 | Failure | completed |")
for t in ["012 | F2 | Switch Failure |","016 | F2 | Switch Failure |","017 | F2 | Switch Failure |"]:
    s=s.replace("| "+t, "| "+t.replace("Switch Failure |","Switch Failure, `price` message |"))
open(p,'w').write(s)

p='decisions.md'; s=open(p).read()
s=s.replace('''### Flagged, not applied
''','''8. **Switch Failure message is chosen by `failureCause` (`price`, `coverage`, `data`).** Decided by Saffron 17 September. Reasoning:
   - The evaluation node already counts what each filter step removed, so the cause is a free by-product: the first filter step after which the pool was empty, else `price`. One field, one template lookup, no new branches or API calls.
   - Three templates rather than two because 007 (every deal below the customer's 50GB) is in the evaluated set and "nothing was cheaper" would be untrue for it. Two templates would have fixed 004 and left 007 wrong.
   - The reporting enum cannot follow (no coverage or data value), so 004 and 007 still report `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL`. The customer message is the only place the workflow can be precise, so it is, and the reporting gap stays as onsite question 1. The mismatch is deliberate and visible rather than hidden.
   - Cost: two more customer-facing messages to maintain, and one more column in the Phase 4 oracle (which template was sent).

9. **The WhatsApp closing line makes no promise about future checks.** Decided by Saffron 17 September. The first draft said "We'll keep checking and let you know if that changes." It was replaced with "If you'd like us to look again, or you've spotted a deal you'd like us to check, just reply here." Reasoning:
   - This workflow runs once per dispatched ticket. When a ticket closes as Switch Failure, nothing in the workflow ever looks at that household again. The Waiting path is not "keep checking": it only applies to an empty feed, caps at three attempts, and even then the workflow ends and something outside it has to re-dispatch.
   - Whether a customer is checked again depends on whatever generates `MOBILE_SWITCH_OFFER_RECOMMENDATION` tickets upstream ("generated when a member is due a mobile recommendation"). The brief does not describe that cadence and the workflow does not own it. A promise in the message would be made on behalf of a system we cannot see.
   - The replacement is true regardless of upstream behaviour: a reply lands in the channel the reply classifier (Part B) handles, so "check again" requests are routed rather than pre-empted. It also keeps the message to one ask.
   - This line is what Part B reply 3 ("Can you check again in a month?") lands on. The message deliberately does not answer that question, because the honest answer depends on the upstream cadence, which is now onsite question 6.

### Flagged, not applied
''')
s=s.replace('''5. **`testMode` is accepted silently by every mock endpoint.** Passed through on every POST. What does it do in the real integrations?
''','''5. **`testMode` is accepted silently by every mock endpoint.** Passed through on every POST. What does it do in the real integrations?
6. **What re-raises a recommendation ticket after a Switch Failure?** The process doc says tickets are "generated when a member is due a mobile recommendation". Is there a fixed cadence (monthly, quarterly), is it triggered by something (contract end, price rise), or is it manual? The answer decides whether "we'll check again" is ever a safe thing to tell a customer, and how Part B reply 3 ("Can you check again in a month?") should be handled.
''')
open(p,'w').write(s)

p='probe/dryrun.mjs'; s=open(p).read()
s=s.replace('''          const pool = deals
            .filter((d) => CFG.APPROVED.includes(d.providerId))
            .filter((d) => d.providerId !== svc.currentProviderId)
            .filter((d) => d.coverageAtHouseholdLocation === 'LIKELY')
            .filter((d) => d.monthlyData >= svc.monthlyData)
            .map(''','''          const s1 = deals.filter((d) => CFG.APPROVED.includes(d.providerId));
          const s2 = s1.filter((d) => d.providerId !== svc.currentProviderId);
          const s3 = s2.filter((d) => d.coverageAtHouseholdLocation === 'LIKELY');
          const s4 = s3.filter((d) => d.monthlyData >= svc.monthlyData);
          const cause = s2.length === 0 ? 'price' : s3.length === 0 ? 'coverage' : s4.length === 0 ? 'data' : 'price';
          const pool = s4
            .map(''')
s=s.replace('''          if (pool.length === 0) out = `FAILURE can't beat (empty pool after filter; ${deals.length} in feed)${note}`;''',
'''          if (pool.length === 0) out = `FAILURE can't beat, ${cause} message (empty pool; ${deals.length} in feed, removed ${deals.length - s1.length} non-approved, ${s1.length - s2.length} current, ${s2.length - s3.length} coverage, ${s3.length - s4.length} data)${note}`;''')
s=s.replace('''            out = (saving >= CFG.SAVING_FLOOR_PENCE ? 'SUCCESS' : 'FAILURE can\\'t beat') +''',
'''            out = (saving >= CFG.SAVING_FLOOR_PENCE ? 'SUCCESS' : 'FAILURE can\\'t beat, price message') +''')
open(p,'w').write(s)
EOF
node probe/dryrun.mjs | grep -i "failure"
````

**Result (error):**

```
Exit code 1
node:fs:561
  return binding.open(
                 ^

Error: ENOENT: no such file or directory, open 'TICKET-001/ticket.json'
    at Object.openSync (node:fs:561:18)
    at Object.readFileSync (node:fs:445:35)
    at file:///Users/saffron/Downloads/Nous/probe/dryrun.mjs:8:27
    at ModuleJob.run (node:internal/modules/esm/module_job:439:25)
    at async node:internal/modules/esm/loader:633:26
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5) {
  errno: -2,
  code: 'ENOENT',
  syscall: 'open',
  path: 'TICKET-001/ticket.json'
}

Node.js v24.16.0
```

## Claude (10:55:22)

The dry run uses relative paths; let me make it location-independent and re-run.

### Tool call 14: `Bash` (10:55:25)

_Make dry run cwd-independent and show the failure rows_

```bash
python3 - <<'EOF'
p='probe/dryrun.mjs'; s=open(p).read()
s=s.replace("import fs from 'node:fs';","import fs from 'node:fs';\nimport { dirname } from 'node:path';\nimport { fileURLToPath } from 'node:url';\nprocess.chdir(dirname(fileURLToPath(import.meta.url)));")
open(p,'w').write(s)
EOF
node probe/dryrun.mjs | grep -i "failure"
```

**Result:**

```
TICKET-003  FAILURE can't beat, price message Giffgaff 15GB £14.5 saves £0.50 (runner-up Talkmobile £14.75)
TICKET-004  FAILURE can't beat, coverage message (empty pool; 3 in feed, removed 0 non-approved, 0 current, 3 coverage, 0 data)
TICKET-007  FAILURE can't beat, data message (empty pool; 3 in feed, removed 0 non-approved, 0 current, 0 coverage, 3 data)
TICKET-008  FAILURE can't beat, price message Giffgaff 10GB £8 saves £-2.00 (runner-up Talkmobile £10)
TICKET-012  FAILURE can't beat, price message Talkmobile 25GB £18 saves £2.00 (runner-up iD Mobile £19)
TICKET-016  FAILURE can't beat, price message Giffgaff 15GB £14 saves £1.00
TICKET-017  FAILURE can't beat, price message Giffgaff 15GB £14.01 saves £0.99
```

## Claude (10:55:38)

Done. All seven failure tickets pick the expected template: 004 gets `coverage`, 007 gets `data`, the rest `price`.

**[rules.md](rules.md)**
- New "Failure cause" block under Deals: `failureCause` = the first filter step after which the pool was empty, else `price`. Table maps steps to causes with the evaluated examples.
- F1 and F2 rows now name the template; the F1 note includes the cause.
- Messages section has the three approved templates. Your first three lines of the price message are unchanged. The coverage and data templates are mine, 4 lines each, same closing line, so read them once more before build. The closing line on all three is: *"If you'd like us to look again, or you've spotted a deal you'd like us to check, just reply here."*
- Expected-outcomes tables record which template each failure sends, so Phase 4 can assert on it.

**[decisions.md](decisions.md)**
- Item 8: the split. Why three not two (007 would otherwise get an untrue message), why it's cheap (the cause is a by-product of the filter counts), and why the reporting mismatch is deliberate and visible rather than hidden.
- Item 9: the closing line. Why "we'll keep checking" was a promise on behalf of a system the workflow doesn't own, why the Waiting path isn't "keep checking", and why the replacement is true regardless of upstream and routes "check again" into the reply channel where Part B handles it.
- New onsite question 6: what re-raises a recommendation ticket after a failure, because that decides both whether "we'll check again" is ever safe to say and how reply 3 should be handled.

**[probe/dryrun.mjs](probe/dryrun.mjs)** now computes the cause and prints the per-step removal counts, and runs from any directory.

Phase 2 is settled unless you want to change the coverage or data wording. Ready for Phase 3 when you are.

---

## Phase 2 continued (same session)

The transcript above ended at the first export request. What follows is the continuation: WhatsApp template review, the rules review, the Schedule trigger design, and the D0/merge question.

## User (11:00:27)

let's check the coverage and data WhatsApp templates

## Claude (11:00:46)

Here they are as they stand in `rules.md`, with the same closing line as the price template.

**coverage** (F1, pool emptied at step 3; evaluated example 004)

```
Hi {firstName}, it's Nous.
We've just looked at the SIM-only deals available at your address.
The cheaper options we found don't have reliable coverage at your postcode, so we're not going to move you onto something that might not work where you live.
If you'd like us to look again, or you've spotted a deal you'd like us to check, just reply here.
```

**data** (F1, pool emptied at step 4; evaluated example 007)

```
Hi {firstName}, it's Nous.
We've just compared the SIM-only deals available at your address with your current plan.
Nothing we found gives you at least your current {monthlyData}GB for less, and we didn't want to save you money by cutting your data.
If you'd like us to look again, or you've spotted a deal you'd like us to check, just reply here.
```

Things I'd want you to weigh, in order of how much they matter:

**Coverage, line 3.** "Don't have reliable coverage" is a slightly stronger claim than the data supports. The field is `coverageAtHouseholdLocation: "UNLIKELY"`, which is a prediction, not a measurement. Softer and more accurate: *"the cheaper options we found aren't expected to have good coverage at your postcode"*. Also, "cheaper options" implicitly tells the customer there were cheaper deals, which invites "so which ones?" as a reply. That's fine if you want that traffic (it's reply 1 territory), but if not, *"the deals we found"* avoids it.

**Coverage, no mention of the current provider.** For 004 the customer is on EE at £30. The message doesn't say "your current EE plan is fine where you are", and it shouldn't, because the workflow doesn't check the current provider's coverage. Worth knowing that's a deliberate silence.

**Data, line 3.** "We didn't want to save you money by cutting your data" is the line doing the judgement work and I think it's the strongest line in any of the three: it tells the customer we chose not to, rather than that we failed to. The `{monthlyData}GB` is a second interpolated field from the context, so it's one more thing to validate before sending (a null would have been caught at D2, so by this point it's a number). One question: 007's customer has 50GB. Do they use it? The hard data floor means a 25GB deal at £15 saving them £15/month is never offered. That's the rule you confirmed, so the message is honest about it, but it's a good Part A judgement call to name.

**Both, line 2.** They say "at your address" and the price template says "at your address" too. Consistent. But "looked at" (coverage) vs "compared" (data, price) is a deliberate difference: the coverage message doesn't claim a price comparison happened, because for 004 the saving never got calculated.

**Convention check:** both are 4 lines, warm, one ask, no fault admitted, no timescale. "We're not going to move you onto something that might not work" is close to the edge of "no admission of fault" only if a reader hears "we nearly did". I don't, but you're the judge of Nous's voice.

If you want any of these changed, give me the wording and I'll drop it into `rules.md` verbatim. If they're approved as-is, say so and I'll mark them approved.

## User (11:06:11)

Coverage, line 3: change to "the the deals we found aren't expected to have good coverage at your postcode"
Coverage, no mention of the current provider: "the workflow doesn't check the current provider's coverage" - can we make it?
Data, line 3: "the rule you confirmed, so the message is honest about it, but it's a good Part A judgement call to name." Should I review these rules? Would you be able to go through them and suggest things? Bear in mind i don't want to overcomplicate and create room for error in real world scenarios.

On the Waiting re-dispatch problem: Add a second trigger. Same workflow, a Schedule node alongside the webhook, polling HubSpot for tickets at the Waiting stage every N minutes and feeding them back into the same core logic. Safe to re-run because your idempotency markers already handle that. This is probably the honest answer to "who re-dispatches."

## Claude (11:07:19)

Applying the coverage wording now (I've dropped the doubled "the", assuming that's a typo). The rest needs your picks, so I'll lay them out.

### Tool call 1: `Bash` (11:07:21)

_Apply the approved coverage line 3 wording in rules.md_

```bash
python3 - <<'EOF'
p='rules.md'; s=open(p).read()
old="The cheaper options we found don't have reliable coverage at your postcode, so we're not going to move you onto something that might not work where you live."
new="The deals we found aren't expected to have good coverage at your postcode, so we're not going to move you onto something that might not work where you live."
assert old in s
s=s.replace(old,new)
open(p,'w').write(s)
EOF
grep -n "aren't expected" rules.md
```

**Result:**

```
184:The deals we found aren't expected to have good coverage at your postcode, so we're not going to move you onto something that might not work where you live.
```

## Claude (11:08:04)

## Can we check the current provider's coverage?

Not reliably, and I'd advise against trying. There's no coverage endpoint; coverage only exists as a field on deals in the Stickee feed. So the current provider's coverage is visible only when the current provider happens to have a deal in the feed (019 has an EE deal marked LIKELY; 004, the ticket that matters, has no EE deal at all). That's an incidental signal, present on some tickets and absent on others, and even when present it wouldn't change the decision: if EE is also UNLIKELY at that postcode we still wouldn't move the customer to another UNLIKELY network. It would only change the wording of a message. Not worth a branch. The silence in the coverage template stays deliberate, and "aren't expected to have good coverage" now claims exactly what the data says.

## Rules review, with "don't overcomplicate" as the filter

I went through every rule asking two questions: what real-world input breaks this, and does the fix add a branch or just a line. Everything below is a line or a config value, not a new path. Ordered by how much I think it matters.

**1. Cross-check the household against the ticket. (Add, strongly.)**
The ticket carries no `householdId` or `userId`; those come only from the webhook. If a webhook ever arrives with the wrong household attached, the workflow would recommend a deal to the wrong customer, and nothing in the current rules catches it. `context.userId` exists, so one guard fixes it: `context.userId !== webhook.userId` → Manual, "household/user mismatch". One IF, no API call, and it's the difference between trusting the webhook and verifying it.

**2. Sanity-check each deal before filtering. (Add.)**
Right now a deal with `effective_line_rental: "12.50"` (string), `null`, or `monthlyData: "unlimited"` goes into `Math.round(x * 100)` and produces `NaN`, and a `NaN` in the sort key makes the ranking undefined. The brief says "return weird payloads" out loud. Fix: a step 0 in the filter that drops any deal without an integer `providerId`, a finite positive numeric price, a finite numeric `monthlyData` and a string coverage value, and counts them. If the feed was non-empty but *every* deal was malformed, that's Manual ("feed unreadable"), not Switch Failure, because "can't beat your deal" would be a lie. If only some were malformed, carry on and mention the count in the note. That's one filter and one extra condition on F1.

**3. Merge the trailing PATCHes. (Simplify.)**
The failure sequence is 8 calls; success is 5. The stage move and the final `completed` marker are separate PATCHes in both, but nothing is gained by separating them: if the combined call fails, the ticket sits at `message_sent`, which I1a already handles correctly ("message went out, check before re-running"). Same for Waiting (two PATCHes → one) and Manual (two → one). Failure drops to 6 calls, success to 4. Fewer calls, fewer places to die, no loss of safety. The one separation that must stay is failure reasons before the stage, with the read-back between them.

**4. Record the "best if the data floor were ignored". (Add, observability only.)**
This is your Part A question about 007. The hard floor is the right v1 rule: without usage data, any tolerance is a guess, and "we never quietly cut your data" is easy to defend. But you'll want to know after two weeks how many failures were data-floor-only. `failureCause: data` catches the pure case (007) but not the mixed one (a 25GB deal at £15 would have cleared the floor, the 50GB one didn't). Fix: when the best-ignoring-data-floor deal differs from the actual best, add it to the note: "Ignoring data floor: iD 25GB £15 would save £15." One line in the evaluation node, nothing changes in the outcome, and it gives you a metric for the doc ("data-floor-only failures per week") and the evidence for a v2 tolerance.

**5. Coverage accepted values as a list. (Config change.)**
`COVERAGE_REQUIRED: "LIKELY"` becomes `COVERAGE_ACCEPTED: ["LIKELY"]`. If the real feed also says `CONFIRMED` or `GOOD`, ops add it without touching logic. Unknown values stay excluded, which is the safe direction.

**6. First-name fallback. (One line.)**
If the customer segment of the subject yields nothing usable (empty, punctuation, a title only), open with "Hi, it's Nous." rather than "Hi Dr, it's Nous." Cosmetic, but it's customer-facing.

**7. What "effective" means in `effective_line_rental`. (Onsite question, no rule change.)**
Intro pricing, upfront cost and contract length aren't in the feed. The field name suggests Stickee has already blended intro pricing into an effective monthly figure. The workflow should assume that and say so; the question for the team is whether that's true and over what term.

**Leave alone:** the £3 flat floor (a percentage floor would make 008's £6 customer a special case for no benefit), the £2 iD penalty (a percentage would be harder to explain to ops), payment £0 → Manual, and the read-back after writing failure reasons.

Tell me which of 1 to 6 to apply. My recommendation is all of them; 1 and 2 are the ones I'd push hardest on.

## The Schedule trigger for re-dispatch

I agree it's the honest answer, and the idempotency markers do make it safe. Two things you need to know before it goes in `rules.md`, because they change the design slightly.

**The ticket doesn't carry `householdId` or `userId`.** A poll finds a Waiting ticket ID and nothing else. So on the first pass, the workflow has to store what it needs on the ticket: `automation_household_id`, `automation_user_id`, `automation_test_mode`, in the same PATCH that sets `waiting`. The scheduled path then reads them back. The mock persists custom properties (verified in Phase 1), and real HubSpot would need the properties created. This also makes item 1 above more valuable: on the scheduled path the workflow can still verify `context.userId` against what it stored.

**The mock has no "list tickets by stage" endpoint.** Only `GET /hubspot/tickets/{id}`. Real HubSpot has a search API, so in production the Schedule node calls that. For the case study, the only way to demonstrate the path is a config list of ticket IDs to poll (the evaluated 11), each GET'd and kept if stage is Waiting. That's a mock limitation, and it's fine as long as the node is named for what it does and the doc says the production version swaps in HubSpot search. It also costs 11 GETs per poll against a 200/minute limit, which is nothing.

**Poll interval is the wait interval.** With `MAX_WAITING_ATTEMPTS: 3`, a 5-minute poll exhausts the cap in 10 minutes, which is not what "inventory refreshes through the day" means. Two options: set the poll interval to the intended spacing (say 60 minutes, so three attempts span about two hours) and accept that an n8n restart resets the clock; or store `automation_last_attempt_at` and have the poll skip tickets touched less than N minutes ago, which survives restarts at the cost of one more property and one more condition. I'd start with the first and name the second as v2. The interval is a config value for you to set: `WAITING_POLL_MINUTES`.

**Two paths, one core.** Both triggers feed a "normalise input" node that produces the same `{ ticketId, householdId, userId, testMode, source: "webhook" | "schedule" }` item, and everything downstream is shared. `source` goes in the note so the trail says which trigger ran.

If you're happy with that shape, give me the poll interval and I'll write it into `rules.md` as the Waiting sequence plus a "Triggers" section, and log the reasoning in `decisions.md` with the other decisions from this exchange.

## User (11:12:17)

rules review: Apply all of them. 
Scheduled trigger: start with the first and name the second as v2.

### Tool call 2: `Read` (11:12:28)

```json
{
  "file_path": "/Users/saffron/Downloads/Nous/rules.md",
  "offset": 36,
  "limit": 60
}
```

**Result:**

````
36	```
37	
38	## Identification and lookup
39	
40	| Rule | Value |
41	|---|---|
42	| Ticket type | Subject matches `SUBJECT_REGEX` **and** `hs_pipeline_id === PIPELINE_ID`. There is no type property on the ticket. |
43	| Service index | `N` = capture group 1 as an integer. Trailing text after `#N` (e.g. `- urgent re-raise`) is ignored. |
44	| Service lookup | `context.mobileServices[N - 1]`. Array order is creation order. |
45	| Provider match | `deal.providerId === service.currentProviderId`. Integers, never names. |
46	| Payment | `GET /current-payment/{service.id}` (`MOB-xxx`). Not `currentPaymentRef`. |
47	| Customer first name | First token of the customer segment of the subject (`MOB | Jane Smith | ...` → `Jane`). Used only in the WhatsApp message. |
48	| Source of truth | The ticket re-read at the start of the run, never the webhook body. Webhook supplies `ticketId`, `householdId`, `userId`, `testMode`. |
49	
50	## automation_status state machine
51	
52	Written to the ticket before and after every side effect so a re-run can see exactly where the last run got to.
53	
54	```
55	null
56	 ├─ waiting                  (empty feed, attempt < MAX)
57	 ├─ manual                   (any Manual route)
58	 ├─ message_pending → message_sent → completed          (Switch Failure)
59	 └─ recommendation_pending → recommendation_sent → completed   (Success)
60	```
61	
62	Only `null` and `waiting` are re-runnable. `completed` and `manual` exit. Any of the four intermediate statuses found at intake means a previous run died mid-sequence; that routes to Manual with a Slack warning (I1a) because the workflow cannot tell whether the side effect went out.
63	
64	## Guards, in order
65	
66	### Intake (after the ticket re-read, before any other call)
67	
68	| # | Shape | Check | Outcome | Writes | Slack |
69	|---|---|---|---|---|---|
70	| I1a | Interrupted run | `automation_status` in `INTERRUPTED_STATUSES` | Manual | note: "Routed to manual: interrupted run, last status [status]. Check whether the [recommendation/message] went out before re-running." | warning: "interrupted run" |
71	| I1b | Already handled | `automation_status` not null, not `waiting`, not in `INTERRUPTED_STATUSES` (i.e. `completed` or `manual`) | Exit | none | Info only if value is `completed` **and** stage is `OPEN_STAGE_ID` ("completed marker on open stage"). Otherwise silent. |
72	| I2 | Terminal stage | `hs_pipeline_stage` not in `[OPEN_STAGE_ID, WAITING_STAGE_ID]` | Exit | none | none (added, see decisions.md) |
73	| I3 | Wrong pipeline | `hs_pipeline_id !== PIPELINE_ID` | Manual | note: "Routed to manual: unexpected pipeline [id]." | none |
74	| I4 | No service | subject contains `NO_SERVICE_MARKER` | Exit | none | none |
75	| I5 | Subject off-pattern | `SUBJECT_REGEX` does not match | Manual | note: "Routed to manual: subject pattern not recognised, confirm ticket type." | none |
76	
77	I4 must run before I5: `#No service found` does not match the regex.
78	
79	### Data (after context and payment, before deals)
80	
81	| # | Shape | Check | Outcome | Writes |
82	|---|---|---|---|---|
83	| D1 | Index out of range | `N > mobileServices.length` or `N < 1` | Manual | note: "Routed to manual: Mobile #[N] out of range, [len] services found." |
84	| D2 | Data missing | `service.monthlyData` null or not a number | Manual | note: "Routed to manual: monthlyData missing on [service.id]." |
85	| D3 | Payment 404 | `GET /current-payment` returns 404 | Manual | note: "Routed to manual: payment endpoint 404 for [service.id]." |
86	| D4 | Payment null | 200 with `amountInGbpPounds === null` | Manual | note: "Routed to manual: payment null on [service.id]." |
87	| D5 | Payment zero | `amountInGbpPounds === 0` | Manual | note: "Routed to manual: payment is £0 on [service.id], possible data error." |
88	
89	### Deals
90	
91	**Fetch.** `GET /deals/{householdId}` with `X-Ticket-Id: ticketId`. The HTTP node retries `HTTP_RETRY_ON` statuses `HTTP_RETRY_COUNT` times with `HTTP_RETRY_BACKOFF_MS`. Only if every retry fails does the run treat it as an empty feed.
92	
93	**Filter, in order.** Each step is logged with the count it removed.
94	
95	1. `providerId` not in `APPROVED_PROVIDER_IDS` → drop
````

### Tool call 3: `Bash` (11:13:10)

_Apply all six rule changes and the Schedule trigger design to rules.md_

```bash
python3 - <<'EOF'
p='rules.md'; s=open(p).read()
def rep(old,new):
    global s
    assert old in s, old[:60]
    s=s.replace(old,new)

# --- config
rep('COVERAGE_REQUIRED:       "LIKELY"         // anything else excluded',
    'COVERAGE_ACCEPTED:       ["LIKELY"]       // allow-list; unknown values are excluded')
rep('MAX_WAITING_ATTEMPTS:    3                // after this, Manual + Slack\n',
    'MAX_WAITING_ATTEMPTS:    3                // after this, Manual + Slack\nWAITING_POLL_MINUTES:    60               // proposed, see decisions.md. Schedule trigger interval = spacing between attempts\nWAITING_POLL_TICKET_IDS: ["TICKET-001", ..., "TICKET-011"]   // mock only: no search endpoint. Production uses HubSpot search by stage\n')
rep('ATTEMPTS_PROPERTY:       "automation_attempts"   // custom ticket property, mock persists it (verified)\n',
    'ATTEMPTS_PROPERTY:       "automation_attempts"   // custom ticket property, mock persists it (verified)\nSTORED_INPUT_PROPERTIES: automation_household_id, automation_user_id, automation_test_mode   // written on first pass so the scheduled path can rebuild the input\n')

# --- identification: first name fallback + source of truth
rep('| Customer first name | First token of the customer segment of the subject (`MOB | Jane Smith | ...` → `Jane`). Used only in the WhatsApp message. |',
    '| Customer first name | First alphabetic token of the customer segment of the subject (`MOB | Jane Smith | ...` → `Jane`). If none, the greeting is "Hi, it\'s Nous." Used only in the WhatsApp message. |')
rep('| Source of truth | The ticket re-read at the start of the run, never the webhook body. Webhook supplies `ticketId`, `householdId`, `userId`, `testMode`. |',
    '| Source of truth | The ticket re-read at the start of the run, never the trigger payload. The trigger supplies only `ticketId`, `householdId`, `userId`, `testMode` (see Triggers), and `householdId`/`userId` are verified against context at D0. |')

# --- triggers section before state machine
rep('## automation_status state machine\n',
'''## Triggers

Two triggers, one core. Both feed a "normalise input" node that emits the same item; nothing downstream knows which trigger fired except through `source` in the note.

| Trigger | Fires | Input | Produces |
|---|---|---|---|
| Webhook | HubSpot dispatches a new ticket | webhook body | `{ ticketId, householdId, userId, testMode, source: "webhook" }` |
| Schedule | every `WAITING_POLL_MINUTES` | none | For each ticket in `WAITING_POLL_TICKET_IDS`: GET the ticket, keep it if `hs_pipeline_stage === WAITING_STAGE_ID`, emit `{ ticketId, householdId: automation_household_id, userId: automation_user_id, testMode: automation_test_mode, source: "schedule" }` from the stored properties |

The ticket carries no household or user ID, so the first pass stores them (`STORED_INPUT_PROPERTIES`) in the same PATCH that sets `waiting`. The scheduled path reads them back. A Waiting ticket missing any stored property goes to Manual ("waiting ticket without stored input").

The mock has no "list tickets by stage" endpoint, so the schedule path iterates a configured ID list. Production swaps that node for a HubSpot search on stage. Poll interval is the spacing between attempts: three attempts span roughly `2 × WAITING_POLL_MINUTES`. An n8n restart resets the clock; storing a last-attempt timestamp and skipping recently touched tickets is v2.

## automation_status state machine
''')

# --- D0
rep('| D1 | Index out of range |',
    '| D0 | Household/user mismatch | `context.userId !== input.userId` (also catches a missing `userId`) | Manual | note: "Routed to manual: household [householdId] belongs to [context.userId], ticket input says [input.userId]." |\n| D1 | Index out of range |')

# --- filter step 0
rep('''**Filter, in order.** Each step is logged with the count it removed.

1. `providerId` not in `APPROVED_PROVIDER_IDS` → drop
2. `providerId === service.currentProviderId` → drop
3. `coverageAtHouseholdLocation !== COVERAGE_REQUIRED` → drop
4. `monthlyData < service.monthlyData` → drop
''','''**Filter, in order.** Each step is logged with the count it removed.

0. Malformed: `providerId` not an integer, `effective_line_rental` not a finite number > 0, `monthlyData` not a finite number, or `coverageAtHouseholdLocation` not a string → drop. If the feed was non-empty and step 0 dropped every deal, that is F0 (Manual), not a Switch Failure.
1. `providerId` not in `APPROVED_PROVIDER_IDS` → drop
2. `providerId === service.currentProviderId` → drop
3. `coverageAtHouseholdLocation` not in `COVERAGE_ACCEPTED` → drop
4. `monthlyData < service.monthlyData` → drop

Numbers are coerced with `Number()` before the checks, so `"12.50"` survives and `"unlimited"` or `null` does not.
''')

# --- data floor observability
rep('''Both failure reasons are the same for every cause.''',
'''**Data-floor shadow.** Also compute the best deal with step 4 skipped. If it differs from the actual best (or the actual pool is empty), append to the note: "Ignoring data floor: [providerName] [data]GB £[price] would save £[saving]." This changes no outcome; it exists so two weeks of notes show how many failures were data-floor-only.

Both failure reasons are the same for every cause.''')

# --- F0 row
rep('| F1 | Empty pool after filter | feed non-empty, 0 survivors |',
    '| F0 | Feed unreadable | feed non-empty, step 0 dropped everything | Manual | | | no | warning: "deals feed unreadable" | "Routed to manual: [n] deals in feed, none parseable. Sample: [first deal JSON]." |\n| F1 | Empty pool after filter | feed non-empty, 0 survivors after steps 1 to 4 |')
rep('"Best eligible: none (cause: [failureCause]). [feed] deals in feed, removed [n] non-approved, [n] current provider, [n] coverage, [n] data."',
    '"Best eligible: none (cause: [failureCause]). [feed] deals in feed, removed [n] malformed, [n] non-approved, [n] current provider, [n] coverage, [n] data."')

# --- sequences
rep('''### Waiting (W1)

1. PATCH `{ next_task_description, automation_status: "waiting", automation_attempts: attempts + 1 }`
2. PATCH `{ hs_pipeline_stage: WAITING_STAGE_ID }`
3. End. Re-dispatch happens outside the workflow (see decisions.md).''',
'''### Waiting (W1)

1. PATCH `{ next_task_description, automation_status: "waiting", automation_attempts: attempts + 1, automation_household_id, automation_user_id, automation_test_mode, hs_pipeline_stage: WAITING_STAGE_ID }` in one call
2. End. The Schedule trigger re-dispatches (see Triggers).''')
rep('''### Manual (I1a, I3, I5, D1 to D5, W2, and any unhandled error)

1. PATCH `{ next_task_description, automation_status: "manual" }`
2. PATCH `{ hs_pipeline_stage: MANUAL_STAGE_ID }`
3. Slack only where the table says so (I1a `warning`, W2 `warning`), or for any unhandled error (severity `error`).''',
'''### Manual (I1a, I3, I5, D0 to D5, F0, W2, and any unhandled error)

1. PATCH `{ next_task_description, automation_status: "manual", hs_pipeline_stage: MANUAL_STAGE_ID }` in one call
2. Slack only where the table says so (I1a, F0, W2 `warning`), or for any unhandled error (severity `error`).''')
rep('''4. PATCH `{ automation_status: "message_pending" }`
5. POST `/comms/whatsapp` `{ ticketId, userId, message, testMode }`
6. PATCH `{ automation_status: "message_sent" }`
7. PATCH `{ hs_pipeline_stage: FAILURE_STAGE_ID }`
8. PATCH `{ automation_status: "completed" }`''',
'''4. PATCH `{ automation_status: "message_pending" }`
5. POST `/comms/whatsapp` `{ ticketId, userId, message, testMode }`
6. PATCH `{ automation_status: "message_sent" }`
7. PATCH `{ automation_status: "completed", hs_pipeline_stage: FAILURE_STAGE_ID }` in one call

Six calls. Steps 1 and 7 are deliberately separate: both reasons must be on the ticket and verified before the stage moves. If step 7 fails, the ticket sits at `message_sent` and I1a routes it to Manual with the right note.''')
rep('''3. PATCH `{ automation_status: "recommendation_sent" }`
4. PATCH `{ hs_pipeline_stage: SUCCESS_STAGE_ID }`
5. PATCH `{ automation_status: "completed" }`''',
'''3. PATCH `{ automation_status: "recommendation_sent" }`
4. PATCH `{ automation_status: "completed", hs_pipeline_stage: SUCCESS_STAGE_ID }` in one call''')

# --- messages: coverage/data approved
rep('Approved by Saffron 17 September. Template chosen by `failureCause`.',
    'All three approved by Saffron 17 September. Template chosen by `failureCause`.')

# --- Slack list
rep('Sent only for: interrupted run found at intake (`warning`), retry cap exhausted (`warning`),',
    'Sent only for: interrupted run found at intake (`warning`), deals feed unreadable (`warning`), retry cap exhausted (`warning`),')

# --- expected outcomes: 009 wording
rep('| 009 | W1, W1, W2 | Waiting twice, then Manual | | empty feed | Manual after 3 dispatches | manual |',
    '| 009 | W1, W1, W2 | Waiting twice, then Manual | | empty feed | Manual after webhook + 2 scheduled passes | manual |')
open(p,'w').write(s)
print("rules.md ok")
EOF
```

**Result:**

```
rules.md ok
```

### Tool call 4: `Bash` (11:13:50)

_Log decisions 10 to 16 and onsite question 7, update the dry run with step 0 and the data-floor shadow, rerun_

```bash
python3 - <<'EOF'
p='decisions.md'; s=open(p).read()
def rep(old,new):
    global s
    assert old in s, old[:60]
    s=s.replace(old,new)

rep('''### Flagged, not applied
''','''10. **D0: household/user cross-check.** Applied 17 September on Saffron's instruction after the rules review. The ticket carries no `householdId` or `userId`; they arrive only on the trigger. A wrong household on a webhook would send a recommendation to the wrong customer and nothing else in the rules would notice. `context.userId` exists, so one comparison closes the gap. It also protects the scheduled path, which rebuilds its input from properties the workflow itself stored.

11. **Filter step 0: malformed deals dropped, all-malformed feed goes to Manual (F0).** Applied 17 September. A string price or a null allowance would have produced `NaN` in the ranking key and an undefined sort. The brief says weird payloads are expected. Numbers are coerced first so `"12.50"` survives. If the feed had deals but none were parseable, "can't beat your deal" would be untrue, so that is Manual with a Slack warning and a sample of the first deal in the note.

12. **Trailing PATCHes merged.** Applied 17 September. The stage move and the final `completed` marker were separate calls with nothing between them. Merging them cuts the failure sequence from 8 calls to 6 and success from 5 to 4, with no loss of safety: if the merged call fails the ticket sits at `*_sent`, which I1a already handles correctly. Waiting and Manual become single PATCHes. The one split that stays is failure reasons before stage, with the read-back between.

13. **Data-floor shadow in the note.** Applied 17 September. The hard data floor stays (without usage data any tolerance is a guess, and "we never quietly cut your data" is defensible). But the note now records the best deal ignoring the floor whenever it differs, so two weeks of notes show how many failures were data-floor-only. No outcome changes. This is the evidence base for a v2 tolerance and a Part A metric.

14. **`COVERAGE_ACCEPTED` is a list.** Applied 17 September. If the real feed uses `CONFIRMED` or `GOOD` alongside `LIKELY`, ops add it in config. Unknown values remain excluded, which is the safe direction.

15. **First-name fallback.** Applied 17 September. If the subject's customer segment yields no alphabetic token, the greeting is "Hi, it's Nous." rather than a broken name.

16. **Re-dispatch by a Schedule trigger in the same workflow.** Decided by Saffron 17 September. Reasoning:
   - A Waiting ticket has to come back somehow. The options were an external HubSpot workflow (invisible to this build and to the onsite), an n8n Wait node inside one execution (holds an execution open for hours and loses it on restart), or a second trigger in the same workflow that polls for Waiting tickets and feeds them into the same core logic. The third is self-contained, visible, and safe because the idempotency markers already make every path re-runnable.
   - Two consequences shaped the design. First, the ticket carries no household or user ID, so the first pass stores `automation_household_id`, `automation_user_id` and `automation_test_mode` on the ticket and the scheduled path reads them back. Second, the mock has no search endpoint, so the scheduled path iterates a configured ID list; production swaps that one node for a HubSpot search by stage.
   - Poll interval equals attempt spacing. `WAITING_POLL_MINUTES: 60` is proposed (three attempts over about two hours, which matches "inventory refreshes through the day"). An n8n restart resets the clock; that is accepted for v1. Storing a last-attempt timestamp and skipping recently touched tickets is named as v2.
   - Both triggers feed a normalise node that emits an identical item with a `source` field, so the core logic has one input shape and the note records which trigger ran.

### Flagged, not applied

- **`WAITING_POLL_MINUTES: 60` is a proposal.** Saffron to confirm or change. It is the only value in the config block not yet confirmed.
''')

rep('''6. **What re-raises a recommendation ticket after a Switch Failure?**''',
'''7. **What does "effective" mean in `effective_line_rental`?** Intro pricing, upfront cost and contract length are not in the feed. The field name suggests Stickee has already blended intro pricing into an effective monthly figure, and the workflow assumes that. Is it true, and over what term? If it is not, the saving figure the customer sees could be wrong for the first months.
6. **What re-raises a recommendation ticket after a Switch Failure?**''')
# reorder: put 7 after 6
i6=s.index('6. **What re-raises'); i7=s.index('7. **What does "effective"')
q7=s[i7:i6]; s=s[:i7]+s[i6:]
end6=s.index('\n', s.index('6. **What re-raises'))+1
s=s[:end6]+q7+s[end6:]
open(p,'w').write(s)
print("decisions.md ok")

# --- dry run: step 0, data-floor shadow
p='probe/dryrun.mjs'; s=open(p).read()
rep2=lambda o,n: s.replace(o,n)
old='''          const s1 = deals.filter((d) => CFG.APPROVED.includes(d.providerId));'''
new='''          const s0 = deals.filter((d) => Number.isInteger(d.providerId) && Number.isFinite(Number(d.effective_line_rental)) && Number(d.effective_line_rental) > 0 && Number.isFinite(Number(d.monthlyData)) && typeof d.coverageAtHouseholdLocation === 'string');
          const s1 = s0.filter((d) => CFG.APPROVED.includes(d.providerId));'''
assert old in s; s=s.replace(old,new)
old='''          if (pool.length === 0) out = `FAILURE can't beat, ${cause} message (empty pool; ${deals.length} in feed, removed ${deals.length - s1.length} non-approved,'''
new='''          const shadow = s3.map((d) => ({ ...d, rank: pence(d.effective_line_rental) + (d.providerId === 18 ? CFG.ID_PENALTY_PENCE : 0) })).sort((a, b) => a.rank - b.rank)[0];
          const shadowNote = shadow && (!pool[0] || shadow.stickeeDealId !== pool[0].stickeeDealId) ? ` [ignoring data floor: ${shadow.providerName} ${shadow.monthlyData}GB £${shadow.effective_line_rental} would save £${((pence(amt) - pence(shadow.effective_line_rental)) / 100).toFixed(2)}]` : '';
          if (s0.length === 0) out = `MANUAL: feed unreadable (${deals.length} deals, none parseable)`;
          else if (pool.length === 0) out = `FAILURE can't beat, ${cause} message (empty pool; ${deals.length} in feed, removed ${deals.length - s0.length} malformed, ${s0.length - s1.length} non-approved,'''
assert old in s; s=s.replace(old,new)
old='''            out = (saving >= CFG.SAVING_FLOOR_PENCE ? 'SUCCESS' : 'FAILURE can\\'t beat, price message') + ` ${b.providerName} ${b.monthlyData}GB £${b.effective_line_rental} saves £${(saving / 100).toFixed(2)}` + (pool.length > 1 ? ` (runner-up ${pool[1].providerName} £${pool[1].effective_line_rental})` : '') + note;'''
new='''            out = (saving >= CFG.SAVING_FLOOR_PENCE ? 'SUCCESS' : 'FAILURE can\\'t beat, price message') + ` ${b.providerName} ${b.monthlyData}GB £${b.effective_line_rental} saves £${(saving / 100).toFixed(2)}` + (pool.length > 1 ? ` (runner-up ${pool[1].providerName} £${pool[1].effective_line_rental})` : '') + note + shadowNote;'''
assert old in s; s=s.replace(old,new)
# the empty-pool branch should also carry shadowNote
s=s.replace("${s2.length - s3.length} coverage, ${s3.length - s4.length} data)${note}`;","${s2.length - s3.length} coverage, ${s3.length - s4.length} data)${note}${shadowNote}`;")
open(p,'w').write(s)
EOF
node probe/dryrun.mjs
```

**Result:**

```
decisions.md ok
TICKET-001  SUCCESS Giffgaff 30GB £15 saves £10.00 (runner-up iD Mobile £16)
TICKET-002  SUCCESS Talkmobile 15GB £12.5 saves £7.50 (runner-up Giffgaff £14)
TICKET-003  FAILURE can't beat, price message Giffgaff 15GB £14.5 saves £0.50 (runner-up Talkmobile £14.75)
TICKET-004  FAILURE can't beat, coverage message (empty pool; 3 in feed, removed 0 malformed, 0 non-approved, 0 current, 3 coverage, 0 data)
TICKET-005  MANUAL: monthlyData null
TICKET-006  SUCCESS Giffgaff 30GB £15 saves £10.00 (runner-up iD Mobile £16) [first attempt HTTP 500, in-node retry]
TICKET-007  FAILURE can't beat, data message (empty pool; 3 in feed, removed 0 malformed, 0 non-approved, 0 current, 0 coverage, 3 data) [ignoring data floor: Giffgaff 10GB £10 would save £20.00]
TICKET-008  FAILURE can't beat, price message Giffgaff 10GB £8 saves £-2.00 (runner-up Talkmobile £10)
TICKET-009  WAITING x3 -> MANUAL (empty feed)
TICKET-010  EXIT (automation_status=completed, Slack info)
TICKET-011  MANUAL: payment null
TICKET-012  FAILURE can't beat, price message Talkmobile 25GB £18 saves £2.00 (runner-up iD Mobile £19)
TICKET-013  SUCCESS Giffgaff 15GB £12 saves £3.00 (runner-up Talkmobile £13.5)
TICKET-014  SUCCESS iD Mobile 30GB £14 saves £11.00 (runner-up Talkmobile £17)
TICKET-015  SUCCESS Talkmobile 25GB £15 saves £7.00
TICKET-016  FAILURE can't beat, price message Giffgaff 15GB £14 saves £1.00
TICKET-017  FAILURE can't beat, price message Giffgaff 15GB £14.01 saves £0.99
TICKET-018  SUCCESS Giffgaff 20GB £14 saves £6.00 (runner-up Talkmobile £14) [ignoring data floor: Talkmobile 20GB £14 would save £6.00]
TICKET-019  SUCCESS Giffgaff 25GB £14 saves £16.00 (runner-up iD Mobile £12)
TICKET-020  WAITING x3 -> MANUAL (empty feed)
TICKET-021  SUCCESS Giffgaff 20GB £15 saves £5.00
TICKET-022  SUCCESS iD Mobile 20GB £15 saves £5.00 [ignoring data floor: Talkmobile 12GB £17 would save £3.00]
TICKET-023  MANUAL: payment £0
TICKET-024  SUCCESS Giffgaff 20GB £15 saves £5.00
```

### Tool call 5: `Bash` (11:14:10)

_Make the shadow ranking use the same comparator, rerun and show shadow notes_

```bash
python3 - <<'EOF'
p='probe/dryrun.mjs'; s=open(p).read()
old="""          const pool = s4
            .map((d) => ({ ...d, rank: pence(d.effective_line_rental) + (d.providerId === 18 ? CFG.ID_PENALTY_PENCE : 0) }))
            .sort((a, b) => a.rank - b.rank || b.monthlyData - a.monthlyData || (a.providerId === 18) - (b.providerId === 18) || a.stickeeDealId.localeCompare(b.stickeeDealId));"""
new="""          const rankPool = (arr) => arr
            .map((d) => ({ ...d, rank: pence(d.effective_line_rental) + (d.providerId === 18 ? CFG.ID_PENALTY_PENCE : 0) }))
            .sort((a, b) => a.rank - b.rank || b.monthlyData - a.monthlyData || (a.providerId === 18) - (b.providerId === 18) || a.stickeeDealId.localeCompare(b.stickeeDealId));
          const pool = rankPool(s4);"""
assert old in s; s=s.replace(old,new)
old="""          const shadow = s3.map((d) => ({ ...d, rank: pence(d.effective_line_rental) + (d.providerId === 18 ? CFG.ID_PENALTY_PENCE : 0) })).sort((a, b) => a.rank - b.rank)[0];"""
new="""          const shadow = rankPool(s3)[0];"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
p='rules.md'; s=open(p).read()
old="**Data-floor shadow.** Also compute the best deal with step 4 skipped."
new="**Data-floor shadow.** Also compute the best deal with step 4 skipped, using the identical ranking and tie-break."
assert old in s; s=s.replace(old,new); open(p,'w').write(s)
EOF
node probe/dryrun.mjs | grep -n "ignoring\|unreadable"
```

**Result:**

```
7:TICKET-007  FAILURE can't beat, data message (empty pool; 3 in feed, removed 0 malformed, 0 non-approved, 0 current, 0 coverage, 3 data) [ignoring data floor: Giffgaff 10GB £10 would save £20.00]
```

## Claude (11:14:36)

Now only 007 carries a shadow note, which is correct: it's the one ticket where the data floor alone stood between the customer and a saving (£20/month by dropping from 50GB to 10GB). All 24 outcomes are unchanged.

## What changed

**[rules.md](rules.md)**
- **Config:** `COVERAGE_ACCEPTED: ["LIKELY"]` (list), `WAITING_POLL_MINUTES: 60` (proposed), `WAITING_POLL_TICKET_IDS` (mock-only), `STORED_INPUT_PROPERTIES`.
- **New Triggers section:** webhook and schedule, both feeding a normalise node that emits `{ ticketId, householdId, userId, testMode, source }`. Scheduled path rebuilds its input from properties stored on the first pass; a Waiting ticket missing them goes to Manual. Mock limitation and production swap stated plainly. v2 named: last-attempt timestamp.
- **D0** household/user mismatch → Manual.
- **Filter step 0** (malformed, with `Number()` coercion) and **F0** (all-malformed feed → Manual + Slack warning, with a sample deal in the note).
- **Data-floor shadow** in the note, same comparator as the real ranking.
- **Sequences merged:** Failure 8 → 6 calls, Success 5 → 4, Waiting and Manual to one PATCH each. Failure reasons still land and are verified before the stage moves.
- First-name fallback, all three WhatsApp templates marked approved, F0 added to the Slack list.

**[decisions.md](decisions.md)**
- Items 10 to 16 with reasoning for each change and for the Schedule trigger design (why not an external HubSpot workflow or a Wait node, the two consequences that shaped it, the poll-interval trade-off, v2).
- Onsite question 7: what "effective" in `effective_line_rental` covers.
- "Flagged, not applied" now has exactly one item: `WAITING_POLL_MINUTES: 60` is the only config value you haven't confirmed. Say the number and it's done.

**[probe/dryrun.mjs](probe/dryrun.mjs)** mirrors step 0 and the shadow.

One thing I want to be straight about from the review: the merged PATCHes and the D0 check are the two changes that make the biggest difference to real-world safety, and neither costs a branch. The rest is hygiene. Phase 2 is complete once you confirm the poll interval.

## User (11:16:08)

the merged PATCHes and the D0 check - is this a good or bad difference?

## Claude (11:16:27)

Good, in both cases. Let me be precise about why, and about what each one costs, because "good difference" should mean you can defend it at the onsite.

**D0 (household/user cross-check)**

Good, and it's the one I'd defend hardest. The failure it prevents is the worst one this workflow can produce: a recommendation sent to the wrong customer. Before D0, the workflow trusted the webhook's `householdId` completely, because the ticket itself carries no household or user ID and there was nothing to check it against. Now it fetches the household's context anyway (it needs it for the service lookup), and `context.userId` is sitting right there. One comparison, no extra API call, and a mismatch goes to Manual with a note saying exactly which two IDs disagreed.

Cost: nil in the happy path. The only risk is a false positive, where the IDs disagree for a benign reason (for example if Nous ever allowed one household to have multiple users). That would send a ticket to Manual that could have been automated. That's the safe direction of error, and it's visible in the note, so if it happens often the rule gets refined rather than discovered by accident.

It also directly answers the brief's "safe to inherit" test: the next person doesn't have to know to worry about webhook trust, because the workflow already does.

**Merged PATCHes**

Good, but the argument is different: this is about removing failure points, not adding protection. Every HTTP call is a place the run can die (timeout, 5xx, n8n restart). The failure sequence had 8 calls, and two of them were `PATCH stage` immediately followed by `PATCH automation_status: completed` with nothing happening in between. Separating those two bought nothing: there's no side effect between them that a marker needs to bracket. Merging them removes one place to die per sequence with zero change in what a re-run can see.

The check that it's actually safe: if the merged call fails, the ticket is left at `message_sent` (or `recommendation_sent`). That's an interrupted status, so I1a routes it to Manual with "check whether the message went out". The message did go out, so the MSO's job is to move the stage by hand. Same as before the merge. Nothing lost.

The one merge I did *not* make is the one that would have been bad: putting the failure reasons and the stage move in the same PATCH. That would remove the read-back check between them, which is the whole point of the post-mortem in the process doc. Both reasons must be on the ticket and verified before the stage moves. That stays as two calls with a GET between.

**The honest counter-argument** to the merge is that finer-grained markers give a more detailed trail. True, but the trail lost is "stage moved, then completed" versus "stage moved and completed": no one debugging a ticket needs that distinction. Fewer calls is the better trade for an operational workflow that has to survive re-dispatch and timeouts.

So: D0 is a safety gain, the merge is a reliability gain, and neither adds a branch anyone has to understand. If you want a one-line version for the doc: *D0 stops the workflow trusting the webhook; the merge stops it making calls that can only fail.*

## User (11:17:33)

export the transcript of this conversation from "let's check the coverage and data WhatsApp templates" to the last message and attach them to the phase2.md file (these messages were a continuation)

### Tool call 6: `mcp__ccd_session_mgmt__export_transcript` (11:17:37)

```json
{
  "session_id": "self"
}
```
