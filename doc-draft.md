# Part A: Reflection

## Two judgement calls

### Where the bar sits for disturbing a customer

The process doc asks whether a saving is "big enough" and leaves the number to me. That is the whole job in one sentence, and it is the decision I spent longest on.

I set three things. A floor of £3 a month, below which we say nothing. A hard data floor, so a deal has to carry at least the allowance the member already has. And a £2 penalty on iD Mobile. The floor is a judgement about attention rather than about money: a switch costs the member a decision, a few minutes and some small risk that something goes wrong, and at £1.50 a month we are spending their goodwill on a rounding error. Two tickets in the evaluated set fail on this floor and I think both are right to. TICKET-003 would have saved 50p.

The iD penalty is the piece I would most want to talk through. The ops Slack thread says "stop pushing people onto iD unless it's properly cheaper", which is a commercial preference and not a statement about price. I had three ways to honour it: exclude iD, give it a separate and higher saving threshold, or penalise it in the ranking. I chose the ranking penalty, so iD competes on price plus £2 against the other approved networks and has to be genuinely better to win. Exclusion would have thrown away real savings, and TICKET-014 in the sandbox shows why: iD at £14 beats Talkmobile at £17 even carrying the penalty, and excluding it would have cost that member £11 a month. A separate threshold would have been the wrong shape, because the complaint is about iD relative to the alternatives, not about iD relative to standing still.

The detail I care about most is that the penalty lives in the ranking key and nowhere else. When iD wins, the saving quoted to the customer is the real one. TICKET-002 is the clearest case: iD is the cheapest line in the whole feed at £12, the penalty puts it level with Giffgaff at £14, the tie-break pushes it behind, and Talkmobile wins at £12.50 (shot 3). We never show a member a penalised number, because the penalty is our commercial opinion and not their bill.

All three thresholds, plus the approved network IDs, sit in one config node, so an ops lead can move the floor without opening a Code node. I should be straight that this isn't absolute: three constants are duplicated in the polling node, and there is one hardcoded stage ID acting as a crash fallback. Both are deliberate and both are written down, but "config over code" is a direction of travel in this build rather than a completed state.

### What the workflow does when it can't tell what it already did

The failure I was most afraid of is not a wrong recommendation. It's two recommendations.

Everything the customer can see is bracketed by a status written onto the ticket. The workflow writes `recommendation_pending`, sends the proposal, then writes `recommendation_sent`. If a run dies between those two writes, and runs do die, the next dispatch finds an intermediate status and has no way to know whether the customer was contacted. The mock doesn't tell you, and I doubt the real endpoint does either. So it routes to Manual with a Slack warning rather than guessing. That costs an MSO about a minute. Guessing wrong costs a member a duplicate message and costs us the assumption that we know what we've done.

The same instinct governs the failure path, and here the process doc told me exactly what to protect against. There is an old post-mortem about a customer getting the wrong comms because only one of the two failure reasons was written. So both reasons go on in a single PATCH, get read back from the API, and get checked against the allowed lists. Only then does the stage move. If the read-back disagrees, the ticket goes to Manual and the stage never moves at all (shot 4). The point is the ordering: the stage is the last thing to change, because the stage is what downstream systems act on.

There's a smaller version of the same idea that I'd point at if asked whether the error handling is real. Every fallible node routes its errors to one handler, which writes a Manual ticket naming the node that failed. Reviewing my own build at the end, I found that the handler's own fallback had no fallback: in one unlikely case it could have thrown inside a node with nowhere to send the error, producing no ticket write and no alert. That is the one path that would have contradicted the whole design, and it was invisible until I went looking. It's fixed. A defensive fallback that itself can fail silently isn't finished.

## What I would push back on

The reporting enum has no value for a coverage failure, and I think that quietly costs Nous information.

TICKET-004 has deals at the right price, and none of them expected to work at the member's postcode. The only available value is `INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL`, which is untrue. I could route those to Manual so a human writes something honest, but that would push real volume onto the team for a case the workflow understands perfectly well. So I did the next best thing: the customer gets an accurate message, because the workflow knows exactly which filter emptied the pool and picks one of three templates from it (shot 5). 004's member is told the deals we found aren't expected to work where they live, which is the truth.

But reporting will count 004 as a price failure for ever. If 47% of tickets fail, and the field that records why can't separate "nothing was cheap enough" from "nothing works at this address", then the failure rate can't tell ops which lever to pull. Those two numbers imply completely different responses: one says go and renegotiate rates, the other says the approved network set is too narrow for parts of the country. I'd want a coverage value added to the enum. It's a small change and it turns a blind spot into a signal.

The question I'd ask is different, and it's the one I couldn't answer from the material. What re-raises a recommendation ticket after a Switch Failure? The process doc says tickets are generated when a member is "due" one, which doesn't tell me whether that's a cadence, a trigger, or somebody's judgement. The workflow closes the ticket and never looks at that household again, so I wrote the customer messages to promise nothing about checking back. That was a deliberate restraint and I'd rather not need it: if there is a cadence, the message should say so, because "we'll look again in three months" is a much better thing to receive than silence. It also decides Part B, reply 3.

## What I would build into v2

Three things, and all of them need the two weeks first.

The data floor is currently absolute, which I chose because without usage data any tolerance is a guess and "we never quietly cut your data" is a defensible line. But I didn't want it to stay an article of faith, so every failure note already records what the best deal would have been with the floor ignored. TICKET-007's note reads "Ignoring data floor: Giffgaff 10GB £10 would save £20.00." That's a member on 50GB who could save twenty pounds a month by dropping to ten, and I genuinely don't know whether they'd want that. Two weeks of those lines tells me how often the data floor alone is deciding the outcome, and that is the evidence for a tolerance rather than my opinion about one.

Second, the interrupted-run handling is deliberately over-cautious and I'd narrow it. Two of the four intermediate states, `recommendation_sent` and `message_sent`, mean the customer contact has definitely already happened and only ticket writes remain. Those can be finished automatically without any risk of a duplicate. Only the two `pending` states are genuinely ambiguous. Splitting them turns some Manual tickets back into automated ones for free.

Third, the Waiting path currently polls a configured list of ticket IDs, because the mock has no endpoint for finding tickets by stage. Production swaps that one node for a HubSpot search. I'd also store a last-attempt timestamp on the ticket, because the retry spacing currently depends on an n8n schedule that a restart resets.

## Three metrics, and what would stop me

The first is the outcome mix against the manual baseline of roughly 53% recommend, 47% fail. The threshold is the entire judgement of this workflow and the likeliest thing for me to have got wrong, and the baseline is the only external check I have on it. I'd pause if the recommend share moved more than ten points either way over a week. Too high means we're disturbing people the team wouldn't have; too low means my floor sits above the bar MSO were actually using, and we're sitting on savings they'd have passed on.

The second is customer contacts per ticket, which should be exactly one, always. This is the only metric where I'd roll back rather than pause, and I'd do it the same day. Everything else on this list is a judgement being wrong in a way we can argue about. A duplicate recommendation or a second WhatsApp is the member seeing our machinery misfire, and the cost of that is not recoverable by fixing it next week.

The third is Manual volume and its reason mix. Manual is where the workflow admits it doesn't know, so some of it is the design working. The shape is what matters: a spread across many causes is honest routing, whereas one cause dominating is a data problem being laundered into human work. If half of all Manual tickets are "payment null", that isn't an automation limitation, it's a broken field somewhere upstream and we should fix that rather than pay people to work around it. I'd pause if Manual passed 15% of tickets in a week, or if any single cause accounted for more than half of it.

# Part B: Reply handling

**"I just saw a cheaper deal on iD Mobile direct for £8 a month, why didn't you find that?"** AI drafts this one, an MSO approves and sends it. This is traffic my message invites on purpose, since the closing line asks people to tell us if they've spotted something, so the volume will be real and a human writing each one from scratch doesn't scale. But the honest answer is a mix of three things, and every one of them is a claim I don't want a model making unsupervised: we only see the deals in Stickee's feed, we only switch members to networks we have commercial relationships with, and £8 direct may well be intro pricing or a smaller allowance than they have now. There's also a second audience here. If members keep finding cheaper iD deals than we offered them, that is direct evidence about my £2 penalty, and it should reach ops rather than being answered away. AI's value is assembling the ranked pool and the reason each deal lost into a draft. It isn't deciding what Nous concedes.

**"Wait, have you already switched me? I didn't agree to anything."** Human MSO, flagged urgent, no automation in the reply path at all. Someone believes their account was changed without their consent. The volume will be tiny and the cost of getting it wrong is a complaint, possibly a regulated one, and certainly a member who no longer trusts us. Automation still has a job here, it's just not writing: classify the reply fast, escalate it, and put the ticket's actual state in front of the MSO so they can answer in one message rather than going digging. And there's a tell worth building in. If this reply ever arrives on a ticket that closed as Success rather than Switch Failure, the situation is materially worse, because then a recommendation really did go out and the member is telling us they didn't agree to it. The classifier should say which case it is, loudly.

**"Can you check again in a month?"** A human handles this in v1, and it becomes automatic as soon as somebody tells me the cadence. The workflow doesn't own what raises recommendation tickets, so it cannot honestly commit to a date, and an acknowledgement that quietly means nothing is worse than a human saying "yes, I've put it in for October." Once I know what re-raises a ticket, this is the easiest of the three to automate end to end: acknowledge, re-raise, done. It's the same gap as my question in Part A, arriving from the customer's side.

## How I'd know two weeks in that the classifier was wrong

Accuracy is the wrong measure, because these three errors are not worth the same. Sending reply 2 down an automated path is expensive and possibly unrecoverable. Sending reply 3 to a human costs a minute. So I'd measure the two directions separately and put the alarm only on the first, and I'd rather run deliberately over-cautious for a fortnight and tighten it with evidence than start loose.

For those two weeks I'd read every reply that was handled without a human, not a sample of them. At this volume that's a genuinely affordable hour or two, and it is the only method that catches the error I'm actually afraid of, which is a confident wrong classification. Those are invisible in aggregate numbers by definition: nothing about a misrouted reply looks unusual until you read it.

Alongside that, three signals that need nobody reading anything. Threads where the member sent a second message before we'd answered, which usually means we answered a question they hadn't asked. Anything auto-handled that later escalated, and how long it sat first. And the MSO override rate, logged every single time somebody changes the route the classifier picked. That last one is both the alarm and the training data, and it's the number I'd still be watching in month six.

One thing I'd design against from the start, because I've just been caught by it. Reviewing my own tooling at the end of this build, I found a test script that had been silently reporting four false failures on every run. The danger there was never the wrong result, it was that a reader learns to expect those four and stops looking. An alarm that cries wolf gets muted, and a muted alarm is worse than no alarm, because you think you have one. If the classifier's monitoring throws warnings nobody acts on, it will train the team to ignore the real ones.

## How I used AI

Heavily, and the honest version of this is more interesting than "a lot".

Claude Code probed the mock API and catalogued the distinct data shapes across all 24 tickets before I wrote a single rule, which is the step I'd defend hardest: I knew what the data actually looked like before I decided anything. It then drafted the workflow node by node and built the test harness. I set the thresholds, made every customer-facing call and wrote the messages.

Two things I'd tell you about rather than leave out. First, a review pass at the end found real defects in the AI-written tooling: a simulator quietly reporting four false failures, and a reset script that defaulted to writing live against one-shot tickets. Both would have bitten me. Using these tools quickly is easy, and checking them is where the actual work is.

Second, my own instruction caused a blind spot. I had the probing use throwaway ticket IDs to avoid contaminating the evaluated scenarios, which was right, but the mock keys its retry-then-success case on the real ticket ID. So every empty deal feed looked permanently empty, and the evidence said the retry path was pointless. I built it anyway, because the process doc says inventory refreshes through the day and the people who wrote that line watch it happen. TICKET-009 then went to Waiting, got picked up by the scheduled poll, found four deals on the second attempt and closed as a £10 a month saving (shot 6). The tooling was right about what it could see. It just couldn't see everything, and the process doc knew something my data didn't.
