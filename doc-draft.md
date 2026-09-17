# Part A: Reflection

## Two judgement calls

**Where the bar sits for disturbing a customer.** The process doc asks whether a saving is "big enough" and leaves the number to me. I set a £3 per month floor, compared in pence so float drift can't decide a borderline ticket, and a hard data floor: a deal must carry at least the allowance the member already has. iD Mobile then carries a £2 penalty on top. The ops Slack thread about iD is a commercial preference, not a rule about price, so I made it a ranking penalty rather than an exclusion or a second threshold. iD has to be properly cheaper than the next approved deal to win, and when it wins, the saving quoted to the customer is the real one, never the penalised figure (shot 3). All four numbers sit in one config node, so ops can move the floor without opening a Code node.

**What the workflow does when it can't tell what it already did.** Every side effect is bracketed by a status written to the ticket: `recommendation_pending` before the POST, `recommendation_sent` after. If a run dies between those writes, the next dispatch finds an intermediate status and has no way to know whether the customer was contacted. It routes to Manual with a Slack warning rather than guessing, because a duplicate recommendation is worse than a minute of MSO time. The same instinct governs the failure path: both reasons go on in one PATCH, get read back from the API and checked against the allowed lists, and only then does the stage move (shot 4). That turns the old post-mortem into a sequence rather than a promise.

## What I would push back on

The reporting enum has no value for a coverage failure. TICKET-004 has deals at the right price and none expected to work at the postcode. The only fit is `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL`, which is untrue. The customer gets an accurate message (three templates, chosen by cause, shot 5), but reporting will count 004 as a price failure forever. If 47% of tickets fail and that field can't separate "nothing cheap enough" from "nothing that works here", the number can't tell ops whether to renegotiate rates or widen the approved set. I'd want a coverage value added.

The question I'd ask: what re-raises a recommendation ticket after a Switch Failure? The workflow closes it and never looks at that household again. Whether we can tell a customer we'll check back depends on a cadence I couldn't see, so the messages promise nothing. It also decides Part B, reply 3.

## v2

Every failure note already records the best deal ignoring the data floor, where one exists. TICKET-007 reads "Ignoring data floor: Giffgaff 10GB £10 would save £20.00." Two weeks of those lines say how many failures are data-floor-only, which is the evidence for a tolerance rather than an article of faith. Second, auto-resume from `recommendation_sent` and `message_sent`: the customer contact has already happened in both, only ticket writes remain, and Manual is over-cautious there. Third, the Waiting path polls a configured ticket list because the mock has no search endpoint. Production swaps that one node for a HubSpot search on stage, with a last-attempt timestamp so an n8n restart doesn't reset the retry clock.

## Metrics

| What I'd watch | Why | Pause or roll back |
|---|---|---|
| Outcome mix against the manual baseline of roughly 53% recommend, 47% fail | The threshold is the whole judgement, and the likeliest thing to be wrong | Pause if the recommend share moves more than 10 points either way over a week. Too high and we're disturbing people MSO wouldn't have; too low and the floor sits above the team's own bar |
| Customer contacts per ticket, which should be exactly one | It's the only failure the customer sees directly | Roll back the same day on any ticket with two. A duplicate recommendation is not something to watch for a week |
| Manual volume and its reason mix | Manual is where the workflow admits it doesn't know. Its shape says whether that's honest routing or a data problem being laundered into human work | Pause if Manual passes 15% of tickets in a week, or if one shape (payment null, say) is more than half of it |

# Part B: Reply handling

| Reply | Route | Why |
|---|---|---|
| "I just saw a cheaper deal on iD Mobile direct for £8 a month, why didn't you find that?" | AI drafts with the ticket's working attached, MSO approves and sends | This is traffic the message invites on purpose, so the volume is real. But any answer commits Nous to a claim about a competitor's price and about our commercial set, and the honest reply is a mix: we see Stickee's feed, we only switch to networks we have relationships with, and £8 direct may be intro pricing or a smaller allowance. No safe template covers that. AI's value here is assembling the draft, not deciding what to concede |
| "Wait, have you already switched me? I didn't agree to anything." | Human MSO, flagged urgent | Someone believes their account was changed without consent. Low volume, high stakes, plausibly a complaint. Automation's job is speed and context: classify, escalate, and surface that no switch was made. If this reply ever lands on a Success ticket rather than a failure, that's a worse problem, and the classifier should say so |
| "Can you check again in a month?" | Human MSO in v1, automatic once the cadence is known | The workflow doesn't own what raises recommendation tickets, so it can't honestly commit to a date. Until someone tells me the cadence, a human sets the reminder. Once I know it, this is the easiest of the three to automate: acknowledge, re-raise, done |

## How I'd know two weeks in that the classifier was wrong

Accuracy is the wrong measure, because the errors aren't worth the same. Routing reply 2 automatically is expensive; routing reply 3 to a human costs a minute. I'd measure the two directions separately and set the alarm only on the first.

For two weeks I'd read every reply handled without a human, not a sample. At this volume that's affordable, and a confidently wrong classification is invisible in aggregate by definition. Alongside it, three signals that need nobody reading: threads where the customer sent a second message before we answered, which usually means we answered the wrong question; anything auto-handled that later escalates, and how long it took; and the MSO override rate, logged every time someone changes the route the classifier picked. That override log is both the alarm and the training set for v2.

## How I used AI

Heavily, with a division of labour I'd defend. Claude Code probed the mock API and catalogued the distinct data shapes across all 24 tickets before I wrote a rule, then drafted the workflow JSON node by node and built the harness that ran the evaluated set. I set the thresholds, made every customer-facing call and wrote the messages. Each judgement call is logged with its reasoning in a decisions file I'll bring to the onsite.
