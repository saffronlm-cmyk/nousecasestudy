# Mock API catalogue

Produced by `probe/probe.mjs` and `probe/mutate.mjs` on 17 September 2026. Raw dumps in `probe/{ticketId}/`, every call in `probe/calls.log`.

## 1. Endpoint shapes

### GET /hubspot/tickets/{ticketId}

```json
{ "id": "TICKET-001", "properties": {
    "id": "TICKET-001",
    "subject": "MOB | Jane Smith | Make recommendation | Mobile #1",
    "hs_pipeline_id": "228462820",
    "hs_pipeline_stage": "390658766",
    "automation_status": null,
    "next_task_description": null,
    "email_switch_failure_reason": null,
    "reporting_switch_failure_reason": null } }
```

- All 24 tickets start in stage `390658766` on pipeline `228462820`. Neither is in the brief's stage list, so `390658766` is the "open, needs recommendation" stage.
- **There is no ticket type property.** The process doc's `MOBILE_SWITCH_OFFER_RECOMMENDATION` does not appear anywhere. Type can only be inferred from the subject prefix `MOB | ... | Make recommendation |` and the pipeline ID.
- `automation_status` and `next_task_description` are present and null on 23 tickets. TICKET-010 has `automation_status: "completed"`. These look like the intended markers for idempotency.
- Unknown ticket: `404 {"error":"Ticket not found"}`.

### GET /context/{householdId}

```json
{ "id": "HH-001", "postcode": "EC1A 1BB", "userId": "USR-001",
  "mobileServices": [
    { "id": "MOB-001", "createdAt": "2024-01-15T09:00:00Z", "monthlyData": 20,
      "currentProviderId": 1, "currentProviderName": "Vodafone", "currentPaymentRef": "PAY-001" } ] }
```

- Provider is represented **both** as ID (`currentProviderId`, integer) and name. Deals use `providerId` (integer) and `providerName`. Match on the integer ID, not the name.
- `currentPaymentRef` (`PAY-xxx`) is a red herring: `/current-payment/PAY-001` returns 404. The endpoint wants the service `id` (`MOB-xxx`).
- Multi-service households (002, 013) list services in ascending `createdAt` order, so `Mobile #N` = `mobileServices[N-1]` is consistent with "Nth service by creation date". No ticket distinguishes the two interpretations.
- `monthlyData` is null on HH-005.
- Unknown household: `404 {"error":"Household not found"}`.

### GET /current-payment/{mobileServiceId}

- `200 {"amountInGbpPounds": 25}` for a known service. Number, not string.
- `200 {"amountInGbpPounds": null}` for MOB-011. Note it is a 200 with a null field, not a 404.
- `200 {"amountInGbpPounds": 0}` for MOB-023.
- Unknown service: `404 {"error":"Payment not found"}`.

### GET /deals/{householdId}  (header `X-Ticket-Id` required)

```json
{ "deals": [
  { "stickeeDealId": "SDL-GIFF-001", "providerName": "Giffgaff", "providerId": 13,
    "monthlyData": 30, "effective_line_rental": 15, "coverageAtHouseholdLocation": "LIKELY" } ] }
```

- Price field is `effective_line_rental` (snake_case, the only one in the API). Always numeric in the dumps; values like `12.5`, `14.75`, `14.01` appear.
- Network field is `providerId`, not `networkId`. Approved IDs 9, 13, 18 match `Talkmobile`, `Giffgaff`, `iD Mobile`.
- `coverageAtHouseholdLocation` values seen: `LIKELY`, `UNLIKELY`. No other values in 24 households, but treat anything other than `LIKELY` as not covered.
- Missing header: `400 {"error":"Missing X-Ticket-Id header"}`.
- Unknown household: `404 {"error":"Household not found"}`.
- **Attempt state is keyed on `X-Ticket-Id`** and any string works as a key. Proven by HH-006: every fresh probe ID gets `500 {"error":"Simulated upstream failure"}` on its first call and deals from the second call on. Sandbox TICKET-020 behaved identically under its real ID and under probe IDs.
- Zero-deal households (005, 009, 010, 011, 020) stayed at zero for 8 consecutive attempts **under probe IDs**. Phase 4 showed that under the real `TICKET-009`, attempt 2 returns deals. The retry scenario is keyed on the real evaluated ticket ID and invisible to probing.

### Rate limit

Every response carries `x-ratelimit-limit: 200`, `x-ratelimit-remaining`, `x-ratelimit-reset` (rolling window, looked like 60 seconds). A 429 was never hit during probing but the workflow's HTTP nodes should treat 429 as retryable alongside 5xx.

### Auth

No header or wrong token: `401`. Body `{"error":"Missing or invalid Authorization header"}` / `{"error":"Invalid token"}`.

## 2. Write-side behaviour (discovered on sandbox tickets only)

| Call | Finding |
|---|---|
| `POST /recommendation` | Returns `200 {"recommendationId":"REC-...","success":true}` to **any** body, including `{}` and no body at all. No dedupe: a second identical POST for the same ticket returns a new ID. Leaves no trace on the ticket. |
| `POST /comms/whatsapp` | Returns `200 {"messageId":"MSG-...","status":"sent"}` to any body, including `{}`. |
| `POST /slack/notify` | Returns `200 {"ok":true}` to any body. |
| `PATCH /hubspot/tickets/{id}` | Accepts `{properties:{...}}` or a bare object. Shallow-merges into existing properties, returns the full updated ticket. Accepts and persists arbitrary custom properties (`probe_custom_marker`), invalid enum values (`email_switch_failure_reason: "NOT A REAL VALUE"`), and a nonsense stage (`999999999`). `{}` is a no-op. Read-back confirms everything persisted. |

Consequence: the mock validates nothing on writes. A 200 from any POST or PATCH tells you only that the call arrived. Every guard the brief cares about (both failure reasons set and valid, stage ID from the allowed list, not sending twice) has to be enforced inside the workflow, and idempotency has to be built on ticket properties because that is the only thing the mock persists.

Suggested body shapes (the mock doesn't care, but a real integration would; these are the fields we actually have):

- `/recommendation`: `{ ticketId, householdId, userId, mobileServiceId, stickeeDealId, testMode }`
- `/comms/whatsapp`: `{ ticketId, userId, message, testMode }`
- `/slack/notify`: `{ ticketId, householdId, severity, title, message, context: {...}, testMode }`

## 3. Per-ticket catalogue

Saving = current payment minus `effective_line_rental`. "Best approved" already excludes the current provider and non-approved networks but does **not** apply coverage, data or iD rules; those are decisions for `rules.md`.

### Evaluated (TICKET-001 to 011)

| Ticket | Subject `#N` | Services | Target service | Payment | Deals (attempt 1 / later) | Networks in feed | Best approved candidate | Notes |
|---|---|---|---|---|---|---|---|---|
| 001 | #1 | 1 | MOB-001 Vodafone(1) 20GB | £25 | 4 / 4 | Giff, Talk, iD, VOXI | Giffgaff 30GB £15, saves £10 | Clean happy path. VOXI £12 is cheapest but not approved. |
| 002 | #2 | 2 | MOB-002B O2(3) 10GB | £20 | 3 / 3 | iD, Talk, Giff | iD 15GB £12 saves £8; Talkmobile £12.50 saves £7.50 | Multi-service. Wrong index picks MOB-002A (EE 25GB £30) and inflates the saving. iD is cheapest by 50p: iD bar test. |
| 003 | #1 | 1 | MOB-003 Vodafone(1) 10GB | £15 | 2 / 2 | Giff, Talk | Giffgaff 15GB £14.50, saves £0.50 | Marginal saving. Threshold test. |
| 004 | #1 | 1 | MOB-004 EE(2) 10GB | £30 | 3 / 3 | Giff, Talk, iD | Giffgaff 20GB £10 saves £20, **coverage UNLIKELY** | All three deals UNLIKELY. Big saving, no coverage. |
| 005 | #1 | 1 | MOB-005 Vodafone(1) **data null** | £20 | 0 / 0 (x8) | none | none | Malformed context and empty feed. |
| 006 | #1 | 1 | MOB-006 Vodafone(1) 20GB | £25 | **500** / 4 | same deal IDs as 001 | Giffgaff 30GB £15, saves £10 | Transient upstream failure on first deals call, then identical to 001. Retry-on-5xx test. |
| 007 | #1 | 1 | MOB-007 EE(2) 50GB | £30 | 3 / 3 | Giff, Talk, iD | Giffgaff 10GB £10 saves £20 | Every deal has less data than current (10, 20, 25 vs 50GB). Like-for-like test. |
| 008 | #1 | 1 | MOB-008 Tesco(4) 5GB | £6 | 3 / 3 | Giff, Talk, iD | none cheaper (£8, £9, £10) | Cannot beat. Clean Switch Failure. |
| 009 | #1 | 1 | MOB-009 Vodafone(1) 20GB | £25 | 0 / 0 (x8) | none | none | Same service as 001 but empty feed. Wait-and-retry candidate, never fills in the mock. |
| 010 | #1 | 1 | MOB-010 Vodafone(1) 15GB | £20 | 0 / 0 (x8) | none | none | **`automation_status: "completed"`** already. Re-run trap: should exit before doing anything. |
| 011 | #1 | 1 | MOB-011 EE(2) 5GB | **null** | 0 / 0 (x8) | none | none | Null payment and empty feed. |

### Sandbox (TICKET-012 to 024)

| Ticket | Subject `#N` | Services | Target service | Payment | Deals | Networks in feed | Best approved candidate | Notes |
|---|---|---|---|---|---|---|---|---|
| 012 | #1 | 1 | MOB-012 **Giffgaff(13)** 20GB | £20 | 3 | Giff, Talk, iD | Talkmobile 25GB £18, saves £2 | Current provider is an approved network. Giffgaff £14 (saves £6) must be excluded. After exclusion, marginal. |
| 013 | #2 | 3 | MOB-013B EE(2) 10GB | £15 | 3 | Giff, Talk, iD | Giffgaff 15GB £12, saves £3 | Three services, middle one targeted. Small savings. |
| 014 | #1 | 1 | MOB-014 EE(2) 20GB | £25 | 3 | iD, Talk, Giff | iD 30GB £14 saves £11; Talkmobile 30GB £17 saves £8 | iD best by £3. iD bar test with a real alternative. |
| 015 | #1 | 1 | MOB-015 Vodafone(1) 20GB | £22 | 3 | Talk, Giff, iD | Talkmobile 25GB £15 saves £7 (LIKELY); Giff £12 and iD £14 UNLIKELY | Coverage filter must drop the two cheaper deals. |
| 016 | #1 | 1 | MOB-016 Vodafone(1) 10GB | £15 | 1 | Giff | Giffgaff 15GB £14, saves £1.00 | Threshold edge, exactly £1. |
| 017 | #1 | 1 | MOB-017 Vodafone(1) 10GB | £15 | 1 | Giff | Giffgaff 15GB £14.01, saves £0.99 | Threshold edge, floating point (15 - 14.01 = 0.9900000000000002 in JS). |
| 018 | #1 | 1 | MOB-018 EE(2) 15GB | £20 | 2 | Talk, Giff | Talkmobile 20GB £14 and Giffgaff 20GB £14 | Exact tie on price and data. Tie-break rule needed. |
| 019 | #1 | 1 | MOB-019 EE(2) 20GB | £30 | 18 | full feed: VOXI, SMARTY, Lebara, Three, BT, Vodafone, **EE (current)**, Sky, O2, Tesco, Plusnet, Asda, 2x Talk, 2x Giff, 2x iD | iD 25GB £12 saves £18; Giffgaff 25GB £14 saves £16 | Unfiltered Stickee feed. Filtering test. iD cheapest by £2. |
| 020 | #1 | 1 | MOB-020 Vodafone(1) 20GB | £25 | 0 (x13, real and probe IDs) | none | none | **Mutated** (see section 5). Same service as 001 and 009. |
| 021 | #1 **+ suffix** | 1 | MOB-021 EE(2) 15GB | £20 | 1 | Giff | Giffgaff 20GB £15, saves £5 | Subject is `... Mobile #1 - urgent re-raise`. Regex must tolerate trailing text. |
| 022 | #1 | 1 | MOB-022 Vodafone(1) 15GB | £20 | 4 | Giff, Talk, iD, VOXI | iD 20GB £15 saves £5; Talk 12GB £17 and Giff 10GB £18 have less data | Only iD keeps the data allowance. VOXI £12 not approved. |
| 023 | #1 | 1 | MOB-023 EE(2) 10GB | **£0** | 2 | Giff, Talk | none cheaper than £0 | Zero payment. Negative savings, and a percentage threshold divides by zero. |
| 024 | #1 | 1 | MOB-024 EE(2) 20GB | £20 | 1 | Giff | Giffgaff 20GB £15, saves £5 | Plain single-deal happy path. **Mutated** (POSTs only, ticket properties untouched). |

## 4. Distinct shapes the workflow has to handle

Grouped by which branch they exercise. Evaluated tickets in bold.

**A. Intake guards**
- Already processed (`automation_status` set): **010**.
- Subject with trailing text after `#N`: 021.
- `#No service found`: not present in either set. Still guard for it, the process doc names it.
- `#N` beyond the service count: not present. Guard anyway.

**B. Data integrity**
- Payment null: **011**. Payment zero: 023.
- `monthlyData` null on the service: **005**.
- Deals 500 on first attempt: **006**.

**C. Empty feed (wait/retry path)**
- Zero deals on every attempt: **005**, **009**, **010**, **011**, 020. All five are also caught by an earlier guard except **009**, which is the only pure "feed is empty, nothing else wrong" scenario.

**D. Filtering**
- Non-approved network cheapest: **001**, 019, 022.
- Current provider is an approved network and appears in the feed: 012, 019.
- Coverage UNLIKELY on the best deals: **004** (all), 015 (two of three).
- Full unfiltered feed of 18: 019.

**E. Saving judgement**
- Clearly worth it: **001**, **006**, 014, 019, 024, 021.
- Marginal: **003** (£0.50), 012 (£2 after exclusion), 013 (£3), 016 (£1.00), 017 (£0.99).
- Nothing cheaper: **008**, 023.
- Less data than current on the cheapest deal: **007** (all deals), 022 (all but iD).
- iD Mobile is the cheapest approved option: **002** (by £0.50), 014 (by £3), 019 (by £2), 022 (only one keeping data).
- Exact tie: 018.

**F. Multi-service households**
- `#2` of 2: **002**. `#2` of 3: 013.

## 5. What I mutated

| Ticket | What | Current state |
|---|---|---|
| TICKET-020 | 5 deals calls under its real `X-Ticket-Id` (attempt counter now at 5). 7 PATCHes. | `hs_pipeline_stage: "999999999"`, `automation_status: "probe_in_progress"`, `next_task_description: "probe: wrapped body"`, both failure reasons set to valid values, `probe_custom_marker: "set-by-probe"`. **Do not use for Phase 4 without a reset or a PATCH back to the starting state.** |
| TICKET-024 | 2x `POST /recommendation`, 1x `/comms/whatsapp`, 1x `/slack/notify` with its ID in the body. 1 deals call under its real ID. | Ticket properties unchanged (verified by read-back). Usable for Phase 4; the mock keeps no record of the POSTs. |

Nothing else received a POST or PATCH. TICKET-001 to 011 received only GETs on ticket, context and current-payment. All deals calls for HH-001 to 011 used `PROBE-*` ticket IDs.

Empty-body POSTs to `/recommendation`, `/comms/whatsapp` and `/slack/notify` referenced no ticket.

## 6. Residual uncertainties

1. **TICKET-009 under its real ID.** RESOLVED in Phase 4 (17 Sep): under `X-Ticket-Id: TICKET-009` the feed is empty on attempt 1 and returns the HH-001 deal set on attempt 2. Probe IDs never see this. The mock keys the retry-then-success scenario on the real evaluated ticket ID, so the probing approach could not have found it. 009 is the retry-then-success case.
2. **Whether a Waiting-stage PATCH changes the deals feed.** Testable on TICKET-020 (already burned) if you want it answered before build. My guess is no, because the mock keys everything on the header, but it is cheap to check.
3. **What `Mobile #N` indexes when creation order and array order differ.** No ticket distinguishes them. Array index is the simpler assumption and the one the mock is consistent with.
4. **Whether `testMode` does anything on the mock.** Every POST accepted it silently. It should still be passed through; the real integrations presumably honour it.

## 7. Things the brief or process doc got wrong or left out

- Says the ticket type is `MOBILE_SWITCH_OFFER_RECOMMENDATION`. No such property exists on the ticket.
- Says `/current-payment/{mobileServiceId}`; the context also exposes `currentPaymentRef`, which does not work. Minor, but a trap for anyone who reads the context first.
- Says networks are identified by "network IDs 9, 13, 18". The field is `providerId` on both context and deals.
- Says "wait and retry" is often worth it. In the mock it never is. Worth asking Nous whether the evaluated set contains a retry-then-success case, because if it does, it is hidden behind the real ticket ID.
- `#No service found` is described but never sent.
