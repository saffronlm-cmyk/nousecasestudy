# What I actually built, in plain English

This is for me, not for Nous. It explains every claim in the submission doc in language I could use with someone who has never heard of any of this. If I can't explain a thing in here, I don't understand it well enough to defend it on the day.

## The job, first

Nous helps people switch to cheaper mobile SIM deals. Somebody signs up, and periodically Nous checks whether there's a better deal out there for them.

At the moment a person does this check. They get a ticket, open an internal tool, look at what deals exist at that customer's address, look at what the customer currently pays, and decide whether anything is worth proposing. If yes, they click a button that sends the customer a proposal. If no, they send a message saying we looked and found nothing, and close the ticket.

It takes about a minute and a half, they do it about 248 times a month, and about 47% of the time the answer is "nothing good enough". My job was to build a robot that does the whole thing.

## What the robot is

It's a workflow in a tool called n8n. Think of n8n as a flowchart that actually runs. You drag boxes onto a canvas, join them with arrows, and each box does one thing: fetch some data, make a decision, send a message. When something triggers the flowchart, a single job travels along the arrows from box to box, and the path it takes depends on the decisions along the way.

Mine has 43 boxes. That sounds like a lot and it mostly isn't logic, it's care: checking things are what I expect, and handling the cases where they aren't.

## How a job starts

Two ways.

**A webhook.** This is just a web address that sits there waiting. When HubSpot, the system Nous use to track customer tickets, creates a new "find this person a mobile deal" ticket, it sends a little parcel of information to that address. My workflow wakes up and starts running. The parcel says which ticket it is, which household, which customer.

**A timer.** Every hour, the workflow wakes itself up and goes looking for any tickets it parked earlier. More on why below.

## The first thing it does, and why it matters

The parcel that arrives contains information about the ticket. My workflow ignores almost all of it and goes and asks HubSpot directly: tell me about this ticket.

That seems wasteful. It isn't. The parcel is a snapshot of how things were at the moment it was sent, and by the time my workflow reads it, things may have moved on. Somebody might have picked the ticket up by hand. It might have been sent twice. It might be an old parcel arriving late. The ticket in HubSpot is the truth; the parcel is a rumour that something happened.

So: always re-read from the source. This is the first thing I'd say if anyone asks what "safe to re-run" means.

## The four possible endings

Every job ends in exactly one of four places.

**Success.** We found a good deal. The workflow sends the customer a proposal and closes the ticket as Success.

**Switch Failure.** We looked and there was nothing worth moving them for. The workflow sends the customer a WhatsApp explaining that, fills in two fields saying why, and closes the ticket as Switch Failure.

**Waiting.** The list of available deals came back empty. Not "nothing good", literally nothing at all. That usually means the supplier's feed hasn't refreshed yet rather than that no deals exist, so the workflow parks the ticket and tries again later.

**Manual.** Something is wrong, or ambiguous, or unexpected, and a person needs to look. The workflow writes a note explaining exactly what it saw, moves the ticket to a Manual queue, and stops.

Manual is the important one. It's the workflow admitting it doesn't know. A robot that never admits that is a robot that's guessing.

## How it decides

Once it has the customer's current price and the list of available deals, it throws deals away in a specific order.

1. **Anything malformed.** If a deal has a price that isn't a number, or a missing data allowance, it goes. Real data is messy and I'd rather drop a deal I can't read than do maths on nonsense.
2. **Networks we don't have a deal with.** Nous only switch people to Talkmobile, Giffgaff and iD Mobile. Everything else goes, however cheap. For one of the test households this threw away 12 of 18 deals.
3. **The customer's current provider.** No point recommending someone switch to who they're already with.
4. **Anywhere the signal is bad.** Each deal comes with a note about whether that network is expected to work at the customer's postcode. If it isn't, it goes.
5. **Anything with less data than they have now.** If they're on 50GB, I won't move them to 10GB.

Whatever survives gets sorted by price. The cheapest one wins. Then one final question: is it cheaper than what they're paying now by at least £3 a month? If yes, propose it. If no, that's a Switch Failure.

## The £3

This is mine. Nobody gave me the number, and the process doc explicitly leaves it to the person doing the job.

The thinking: a switch isn't free for the customer. They have to read a message, make a decision, and take a small risk that something goes wrong with their phone. If we're saving them £1.50 a month we're spending their goodwill on almost nothing, and next time we message them they're a bit less likely to read it. £3 a month is £36 a year, which felt like the point where it's worth someone's attention.

I'd defend the reasoning harder than the number. If Nous have data saying £2 converts fine, the number should be £2. It's in a settings box, so changing it takes ten seconds and doesn't involve touching any logic.

## The iD Mobile thing

There's a quote in the brief from an ops Slack thread: can we please stop pushing people onto iD unless it's properly cheaper, their support is bad and we lose them by month two.

That's a real business problem stated informally, and I had to turn it into a rule. Three options:

- **Ban iD.** Simple, and wrong: it throws away genuine savings. In one test case iD was £14 against the next best at £17.
- **Make iD clear a higher saving bar.** Wrong shape. The complaint isn't "iD needs to save more than standing still", it's "iD shouldn't win over Talkmobile or Giffgaff unless it's clearly better".
- **Add £2 to iD's price when ranking.** This is what I did.

So when the workflow sorts the deals, it pretends iD costs £2 more than it does. If iD still comes out on top after that handicap, it's properly cheaper and it wins. If the handicap drops it behind Giffgaff, Giffgaff wins.

The bit I'm proudest of is small: the £2 is used **only** for choosing. Once a deal is chosen, the saving we tell the customer is the real one. If iD wins at £14 against a current £25, the customer is told they save £11, not £9. The handicap is Nous's private opinion about iD's support quality. It isn't the customer's bill and it would be dishonest to show it to them.

## Why the robot writes notes to itself

This is the part I'd most want to be able to explain, because it's the bit that's actually engineering judgement rather than business judgement.

Sending a customer a message is irreversible. You cannot un-send it. So the dangerous failure isn't the workflow crashing, it's the workflow crashing *halfway*, being run again, and sending a second message.

Concretely: the workflow is about to send a proposal. The internet hiccups, or n8n restarts, or the job times out. Did the proposal go out or not? Nobody knows. The ticket looks untouched either way.

So before it sends anything, the workflow writes a note on the ticket saying "about to send a proposal". After it sends, it writes "proposal sent". Two sticky notes either side of the risky action.

Now, if a job starts and finds "about to send a proposal" already written on the ticket, it knows a previous run died right at the dangerous moment. It can't tell whether the message went out. So it doesn't guess. It sends the ticket to Manual with a note saying exactly that, and a person spends a minute checking the message log.

That costs Nous a minute of staff time. Guessing wrong costs a customer a duplicate message and costs Nous the ability to say it knows what it's done. Easy trade.

## The two failure reasons

The brief mentions, almost in passing, an old incident where a customer got the wrong communications because only one of two fields was filled in before the ticket was closed.

That's a specific bug being described politely, and it tells me what the ordering has to be. When my workflow closes something as Switch Failure it:

1. writes both reason fields in a single update
2. reads the ticket back from HubSpot to check both actually landed
3. checks the values are ones the system recognises
4. only then moves the ticket to the Switch Failure stage

Moving the stage is what makes other systems act. So it goes last, always, after everything it depends on has been confirmed. If the read-back disagrees, the ticket goes to Manual and the stage never moves, which means no wrong communications go out. The incident in the process doc becomes impossible rather than unlikely.

## Waiting, and why

The brief mentions the deal supplier refreshes their inventory through the day, so an empty result now doesn't mean an empty result in an hour.

When my workflow gets an empty list, it doesn't fail the ticket. It parks it: moves it to a Waiting stage, writes down everything the next attempt will need, and stops. Every hour a timer wakes the workflow up, it looks for parked tickets, and it tries them again. Up to three attempts, and after that it gives up and sends it to a person.

The reason it writes down what the next attempt needs is a wrinkle worth knowing. The ticket in HubSpot doesn't record which household it belongs to. That only arrives in the original parcel. So when the timer picks a parked ticket back up an hour later, that information is gone unless the first attempt saved it. It does.

This path paid off on one of the eleven test tickets. TICKET-009's first check found nothing, it parked, the timer picked it up, and the second check found four deals including one saving the customer £10 a month. Without the retry that customer gets told there's nothing for them, which would have been false.

## When something goes genuinely wrong

Every box in the workflow that could fail has its errors routed to one place. That handler writes a Manual ticket naming the exact box that broke and what it said, and posts an alert to Slack.

The principle is that nothing fails silently. A workflow that dies quietly is worse than one that dies loudly, because nobody finds out until a customer complains.

I did find one hole in this when I reviewed my own work: the error handler had a backup plan, and the backup plan itself could fail with nowhere to report it. Rare, but it was the one path in the whole build that could have broken silently. It's fixed now. The lesson I took: a safety net needs checking as carefully as the thing it's catching.

## The metrics, in plain terms

**Are we recommending about as often as the humans did?** The team currently says "no deal" about 47% of the time. If my robot says it 70% of the time, my £3 threshold is too high and we're sitting on savings the team would have passed on. If it says it 25% of the time, I'm pestering people the team wouldn't have. Either way, stop and look.

**Is anyone getting contacted twice?** Should never happen, by design. If it does, the design is broken in exactly the way I was most worried about, and I'd turn the thing off the same day rather than watch it for a week.

**How much is going to Manual, and why?** Some is fine, that's the system being honest. But if one single cause is most of it, that's usually not an automation problem, it's a data problem somewhere upstream that we'd be paying people to work around.

## Part B, in plain terms

Nous asked what should happen when a customer replies to the "sorry, no deal" message. Three replies, and the question behind it is really: what are you willing to let a machine say to a customer?

**"I found a cheaper deal on iD myself, why didn't you?"** A machine drafts it, a person approves it before it sends. The honest answer involves admitting we only see certain deals and only work with certain networks, and I don't want a language model improvising Nous's commercial position. There's a second reason: if customers keep finding better iD deals than we offered, that's evidence my £2 handicap is set wrong, and it should get to the ops team rather than being politely answered away.

**"Have you already switched me? I didn't agree to anything."** Person, immediately. Someone thinks we changed their phone contract without asking. That's potentially a formal complaint and definitely a frightened customer. The machine's job is to spot it fast and hand it over with the facts attached, not to reply.

**"Can you check again in a month?"** Person for now, and it could be automated the moment somebody tells me how tickets get raised in the first place. My workflow doesn't control that, so it can't promise a date. An automatic "yes of course" that quietly means nothing is worse than a person saying "done, I've diarised October."

## How I'd catch the machine getting this wrong

The trap is measuring "how often is it right", because the three mistakes cost wildly different amounts. Auto-replying to the frightened customer is potentially unrecoverable. Sending "check again in a month" to a human costs sixty seconds. An overall accuracy score treats those as equal, which is useless.

So for the first fortnight I'd read every single reply the machine handled on its own. Not a sample. At this volume that's an hour or two, and it's the only way to catch the thing I'm actually scared of, which is a confident wrong answer. Those look completely normal in a spreadsheet.

Then three things that need nobody reading anything: customers who sent a second message before we answered, which usually means we answered the wrong question; anything the machine handled that later had to be escalated; and every time a member of staff overrides the machine's decision. That last one is the real gold, because it's simultaneously the alarm and the material you'd use to make the thing better.

## Terms I might get asked about

**Webhook.** A web address that waits to be sent information. Something else sends it a parcel and that wakes up your process.

**Idempotent.** A word for "safe to do twice". Pressing a lift button is idempotent; sending a text isn't. Most of my design is about the second kind.

**PATCH / GET / POST.** Ways of talking to another system. GET asks for information, POST creates something new, PATCH changes part of something that already exists.

**Payload.** The parcel of information sent with a request.

**Retry with backoff.** If a request fails, try again, but wait a bit longer each time rather than hammering. My workflow does this for *asking* for information, and deliberately does not for *sending* messages to customers, because a retry there means a duplicate.

**Classifier.** Something that reads a piece of text and sorts it into categories. In Part B it's the thing reading a customer's reply and deciding which of the three kinds it is.

**Config over code.** Keeping the numbers someone might want to change (the £3, the £2) in a single obvious place, rather than buried in the workings where changing one means understanding all of it.
