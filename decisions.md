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

1. **5xx on the deals fetch is retried in the HTTP node before it counts as an empty feed.** The kickoff grouped "500 or 0 deals" into the Waiting row, but the expected outcome for 006 is Success on the first dispatch, which is only possible if the node retries. Confirmed by Saffron 17 September: 3 retries, 2 second backoff, on 429 and 5xx. The 429 is included because the mock advertises a 200/minute limit. Applies to every GET and to the PATCHes; POSTs to `/recommendation` and `/comms/whatsapp` are never retried automatically because a duplicate is a customer-facing error.
2. **Terminal-stage guard (I2).** Not in the kickoff, but it is item 1 of the engineering bar in CLAUDE.md. A ticket in Success, Failure or Manual with a null `automation_status` (for example one an MSO closed by hand) exits silently rather than being reprocessed.
3. **Manual routing sets `automation_status: "manual"`.** The kickoff did not specify a status for Manual. Without one, a re-dispatch of a Manual ticket would pass guard I1 and only be stopped by I2. Setting it keeps the state machine complete and the trail readable.
4. **Guard order: `#No service found` (I4) before the regex (I5).** The marker does not match the regex, so the other order would send those tickets to Manual instead of exiting silently.
5. **Note templates use colons instead of dashes**, per the writing conventions in CLAUDE.md.
6. **Attempt counter lives on the ticket** as a custom property `automation_attempts`. Verified in Phase 1 that the mock persists custom properties. In real HubSpot this property would need creating first.

7. **Interrupted runs route to Manual with a Slack warning (I1a).** Raised as a flag in the first draft of this entry, decided by Saffron on 17 September. Reasoning:
   - The four intermediate statuses (`recommendation_pending`, `recommendation_sent`, `message_pending`, `message_sent`) only ever exist between two writes in a sequence. Finding one at intake means the previous run died between those writes: n8n timed out, the mock 5xx'd on a PATCH, the execution was cancelled.
   - The workflow cannot resolve the ambiguity itself. At `recommendation_pending` the POST may or may not have gone out; the mock (and, plausibly, the real endpoint) returns nothing that says so and does not dedupe. Re-running would risk a second recommendation or a second WhatsApp to the same customer. Exiting silently would leave the ticket stuck in Open forever with no one told.
   - Manual is the only outcome that is safe in both cases: no duplicate customer contact, and a human with the note in front of them can check the comms log and either finish the sequence by hand or reset the ticket.
   - Slack is `warning` not `error` because the interruption already happened; this is a "look at this today" signal, not a pager.
   - Cost: a small number of tickets per month that could in principle have been auto-recovered (for example `message_sent`, where the only remaining steps are two PATCHes) will instead take an MSO a minute. Worth it until there is evidence of how often it happens. A v2 could auto-complete from `*_sent` states, since the customer contact is already done and only ticket writes remain.
   - Overwriting the interrupted status with `manual` is deliberate so a further re-dispatch exits cleanly at I1b rather than raising a second alert.

8. **Switch Failure message is chosen by `failureCause` (`price`, `coverage`, `data`).** Decided by Saffron 17 September. Reasoning:
   - The evaluation node already counts what each filter step removed, so the cause is a free by-product: the first filter step after which the pool was empty, else `price`. One field, one template lookup, no new branches or API calls.
   - Three templates rather than two because 007 (every deal below the customer's 50GB) is in the evaluated set and "nothing was cheaper" would be untrue for it. Two templates would have fixed 004 and left 007 wrong.
   - The reporting enum cannot follow (no coverage or data value), so 004 and 007 still report `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL`. The customer message is the only place the workflow can be precise, so it is, and the reporting gap stays as onsite question 1. The mismatch is deliberate and visible rather than hidden.
   - Cost: two more customer-facing messages to maintain, and one more column in the Phase 4 oracle (which template was sent).

9. **The WhatsApp closing line makes no promise about future checks.** Decided by Saffron 17 September. The first draft said "We'll keep checking and let you know if that changes." It was replaced with "If you'd like us to look again, or you've spotted a deal you'd like us to check, just reply here." Reasoning:
   - This workflow runs once per dispatched ticket. When a ticket closes as Switch Failure, nothing in the workflow ever looks at that household again. The Waiting path is not "keep checking": it only applies to an empty feed, caps at three attempts, and even then the workflow ends and something outside it has to re-dispatch.
   - Whether a customer is checked again depends on whatever generates `MOBILE_SWITCH_OFFER_RECOMMENDATION` tickets upstream ("generated when a member is due a mobile recommendation"). The brief does not describe that cadence and the workflow does not own it. A promise in the message would be made on behalf of a system we cannot see.
   - The replacement is true regardless of upstream behaviour: a reply lands in the channel the reply classifier (Part B) handles, so "check again" requests are routed rather than pre-empted. It also keeps the message to one ask.
   - This line is what Part B reply 3 ("Can you check again in a month?") lands on. The message deliberately does not answer that question, because the honest answer depends on the upstream cadence, which is now onsite question 6.

10. **D0: household/user cross-check.** Applied 17 September on Saffron's instruction after the rules review. The ticket carries no `householdId` or `userId`; they arrive only on the trigger. A wrong household on a webhook would send a recommendation to the wrong customer and nothing else in the rules would notice. `context.userId` exists, so one comparison closes the gap. It also protects the scheduled path, which rebuilds its input from properties the workflow itself stored.

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

- **Payment £0 goes to Manual, not Failure.** Kept as agreed. Noting that a £0 payment could be a legitimate free SIM, in which case nothing will ever beat it and Failure would be the honest outcome. Manual is the safer default until someone at Nous says which it is.

### Open questions for onsite

1. **No coverage-specific failure reason.** A ticket that fails because every deal is UNLIKELY at the postcode (004) is reported as `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL`, the same as a price failure. Reporting cannot tell the two apart, and the customer gets a "nothing cheaper" message when the truth is "nothing with coverage". Is there an appetite for a new reporting value, or should coverage failures go to Manual so a human writes the message?
2. **"Wait and retry is often worth it" is not evidenced in the mock.** Every zero-deal household stayed empty for 8 attempts under probe IDs. Is there a retry-then-success case in the evaluated set that only appears under the real ticket ID? If not, the Waiting path exists on the process doc's word alone.
3. **Ticket type detection is subject-based because there is no type property.** The process doc names `MOBILE_SWITCH_OFFER_RECOMMENDATION` but the ticket carries no such field. Subject plus pipeline is the only guard available. Is there a property in real HubSpot we should be reading instead?
4. **Who re-dispatches a Waiting ticket?** The workflow moves the ticket to Waiting and ends. Something outside it (a HubSpot workflow on the Waiting stage with a delay, a scheduled n8n trigger) has to fire the webhook again. For Phase 4 the test harness will do it by hand. The alternative, an n8n Wait node inside one execution, keeps the retry self-contained but holds an execution open for hours and loses it if n8n restarts.
5. **`testMode` is accepted silently by every mock endpoint.** Passed through on every POST. What does it do in the real integrations?
6. **What re-raises a recommendation ticket after a Switch Failure?** The process doc says tickets are "generated when a member is due a mobile recommendation". Is there a fixed cadence (monthly, quarterly), is it triggered by something (contract end, price rise), or is it manual? The answer decides whether "we'll check again" is ever a safe thing to tell a customer, and how Part B reply 3 ("Can you check again in a month?") should be handled.
7. **What does "effective" mean in `effective_line_rental`?** Intro pricing, upfront cost and contract length are not in the feed. The field name suggests Stickee has already blended intro pricing into an effective monthly figure, and the workflow assumes that. Is it true, and over what term? If it is not, the saving figure the customer sees could be wrong for the first months.

### Phase 1 residue carried forward

- TICKET-020 is mutated (stage `999999999`, status `probe_in_progress`). Live, it exits silently at I1. Use it for anything destructive.
- TICKET-024 received POSTs but its properties are untouched. Usable.
- All evaluated tickets are clean and one-shot.

## Phase 3 — 17 September 2026

### What was built

`workflow/nous-mso-mobile-recommendation.json`: 43 nodes, two triggers, one core. Generated by `workflow/build.mjs` from Code node sources in `workflow/code/`. Five cumulative section files for staged import. `workflow/simulate.mjs` executes the generated JSON offline against the Phase 1 dumps and checks all 24 tickets against the `rules.md` oracle (24/24 pass).

Live verification in n8n Cloud, in section order, all on sandbox tickets:

| Section | Tickets | Verified |
|---|---|---|
| 1 Intake | 021 | Subject suffix tolerated, `firstName: Maya`, route continue |
| 2 Data | 013, 023, 018 (wrong userId) | `#2` of 3 picked; D5 £0 payment to Manual; D0 mismatch to Manual |
| 3 Evaluation | 019, 022, 015, 012 | 12 non-approved removed, iD penalty tie lost to Giffgaff; data floor keeps only iD; coverage drops the two cheapest; current provider excluded then below floor with price message |
| 4 Outcomes | 024, 016, 023 | Success chain (4 writes); Failure chain with read-back and WhatsApp (6 writes); Manual without Slack |
| 5 Errors | 024, 016 re-run; 014 with HH-999 | Both re-runs exit at I1b with zero writes; forced 404 reaches `Unhandled error`, ticket to Manual with the failing node named, Slack error sent |

### Design decisions

17. **Workflow JSON is generated, not hand-written.** n8n JSON embeds every expression and Code source as escaped strings, and the five section files are cumulative. One definition (`build.mjs`) plus readable Code sources is the only way to keep them consistent and reviewable. The JSON is a build product; the `.js` files are what a reviewer reads.

18. **One item per ticket, every Code node runs once per item.** Later nodes fetch earlier data with `$('Node').item.json`, which n8n resolves through the paired-item chain. This avoids copying context through every node with Set nodes, keeps HTTP nodes to one-line expressions, and means the Schedule path can emit several Waiting tickets in one run without special handling. Verified live from the deepest point (`Unhandled error` reading `Config` from the error output of `GET context`).

19. **`Config` is the anchor and sits after the triggers converge.** A node's output goes to every connected node, so a Config before the merge would push webhook items into the poll. The poll node carries three duplicated constants (base URL, Waiting stage, ID list) and is the only mock-specific node in the workflow.

20. **Each guard is a Code node followed by a Switch or IF on `decision.route`.** The Code node decides and writes the note; the router only routes. The execution view then shows the decision where it was made, and `Build manual` can accept items from eight different guards because every one of them carries `decision.note` in the same place.

21. **`Evaluate deals` is one Code node, not a chain of Filter and Sort nodes.** The rules are a single ordered computation with per-step counts and a four-level tie-break, none of which a Sort node can express. Its output (`evaluation`) is the full working, and it precomputes every outcome body (`waitingPatch`, `failurePatch`, `whatsappMessage`, `recommendationBody`) so what will be written is visible before any write happens.

22. **Retries and error outputs are node settings, not nodes.** HTTP nodes retry 4 times at 2 seconds; the two customer-facing POSTs do not retry. `On Error → Continue (using error output)` is off in sections 1 to 4 so failures stop red in the editor while testing, and on for all 18 fallible nodes in section 5, all wired to one handler. The handler names the failing node via `$prevNode.name`.

23. **Section 5 has three deliberate exceptions to "wire everything".** `GET ticket (poll)` drops a failed item so one bad ticket does not stop the poll. `Slack: info` has no error output because nothing can be done if an info alert fails. `Unhandled error` and `Build manual` are not wired to the handler because that would loop.

### Observed on n8n Cloud

- Newer n8n labels the test button "Execute workflow" and the test webhook listens for exactly one request per click. A second curl without re-clicking gets a 404 from n8n, not the mock, and nothing is spent.
- HTTP node errors arrive at the error output as `404 - "{...body...}"`, which is more useful in the Manual note than the bare message.
- Credentials imported by name resolved without manual mapping once the `Nous mock API` Header Auth credential existed.

### Spent in Phase 3

024 (Success), 016 (Failure), 023 (Manual), 014 (Manual via forced 404). Sandbox 012, 013, 015, 018, 019, 021, 022 had GET-only runs and remain usable; 017 is untouched. All evaluated tickets remain clean.

### Carried forward to Phase 4

- `WAITING_POLL_MINUTES: 60` is still the only unconfirmed config value.
- The Schedule path has not been run live (no ticket has been in Waiting). 009 in Phase 4 will be its first live exercise; the simulator has run it.
- For Phase 4 the workflow should be activated so the production webhook URL listens continuously. That also arms the hourly poll, which is wanted for 009.

## Phase 4 — 17 September 2026

### Test-time setting

`WAITING_POLL_MINUTES` is 60 in the build and in `rules.md`. For the Phase 4 run the Schedule node was set to **2 minutes** so 009 could complete in one sitting rather than over two to three hours. The submitted workflow is republished with 60. Decided by Saffron on 17 September because of the deadline; nothing else in the workflow differs between the test and submitted versions.

### 009 resolved the retry question

Fired first. Went to Waiting with `automation_attempts: 1` and the stored input, as expected. The scheduled poll then re-fetched deals under the real `X-Ticket-Id: TICKET-009` and got **four deals** (the HH-001 feed), ranked Giffgaff 30GB £15 as best, and ran the Success chain. Note ends `[schedule]`.

What this means:
- The oracle in `rules.md` said "Waiting twice, then Manual". That was derived from probe IDs, which never see the attempt-2 feed. The mock keys the retry-then-success scenario on the real evaluated ticket ID. Phase 1's residual uncertainty 1 was exactly this and is now resolved. `rules.md` and `catalogue.md` corrected.
- The workflow needed no change. The Waiting path, the stored-input properties, the scheduled rebuild of the input, guard I1b letting `waiting` through, and the full Success chain from the scheduled path all worked live on the first run.
- Onsite question 2 ("is wait and retry ever worth it?") is answered: yes, on exactly one of the eleven evaluated tickets, which is the one designed to test it. Keep the question in the doc as "it was hidden from probing; how often does it happen in production?"

### Results

11 of 11 evaluated tickets match the corrected oracle. `test/results.md` has the table; `test/results/` has before/after per ticket. Order run: 009, 010, 005, 011, 008, 003, 004, 007, 001, 002, 006.

- Four failure tickets first read back as `message_pending`. That was the harness reading the ticket mid-chain (it returned on the first change, which is the reasons-and-note PATCH), not the workflow. A re-read 30 seconds later showed all four at Failure / `completed` with both reasons set. The harness now waits for a resting status (`completed`, `manual`, `waiting`). Recorded because it is exactly the kind of false alarm a status-marker design produces, and the markers did their job: the intermediate state was legible.
- 006's retried 500 is not visible on the ticket, only in the n8n execution log (`GET deals` shows two tries). Screenshot that.
- 009's Success came from the scheduled execution, not the webhook one. The n8n execution list shows two runs for it.

### Paths not exercised by the evaluated set

- **W2** (retry cap reached → Manual + Slack warning): 009 turned out to succeed on attempt 2, so no evaluated ticket reaches the cap. Covered by `workflow/simulate.mjs` (TICKET-020 in the dumps, pre-mutation) and by the section 4 dry run.
- **F0** (all deals malformed → Manual + Slack), **I1a** (interrupted run), **FV** (failure reason read-back mismatch): no ticket in either set produces these. Covered by the simulator's code paths and by reasoning; the mock never returns a malformed deal and never rejects a PATCH.
- **D0** (household/user mismatch) and the **Unhandled error** path were exercised live in Phase 3 on sandbox tickets (018 with a wrong userId; 014 with HH-999), not in Phase 4.

### State of the mock after Phase 4

All eleven evaluated tickets are now in terminal stages under their real IDs. Re-running any of them exits at I1b with no writes (verified on 010, and on 024 and 016 in Phase 3). A reset from Nous is needed for any further end-to-end run on the evaluated set; sandbox 012, 013, 015, 017, 018, 019, 021, 022 remain usable.
