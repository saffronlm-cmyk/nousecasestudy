# What to submit

The brief, page 6, asks for three things:

1. Your workflow export (three dots top right → Download)
2. Screenshots of the workflow executing. Pick whatever best shows what you built.
3. A short written doc (max 2 pages), Part A and Part B, plus a sentence or two on how you used AI

This file covers 1 and 2, and the packaging. Deliverable 3 is Phase 5 and yours to write.

The governing sentence is "pick whatever best shows what you built". That is an invitation to
curate, so the set below is eight screenshots that each carry one claim, ordered as a narrative a
reviewer can follow without your commentary. Everything in it already exists in the n8n execution
history from the Phase 4 run at 12:58 to 13:03 today. Only the two optional shots need a fresh fire.

## Before you start

The evaluated tickets are all in terminal stages. Do not re-fire 001 to 011: a re-run exits at I1b,
writes nothing, and overwrites nothing, but it also puts a boring two-node execution at the top of
the list and pushes the real evidence down. Everything worth photographing has already happened.

Confirm the ticket side matches what you are about to photograph:

```bash
cd ~/Downloads/Nous
node tools/ticket-state.mjs
```

That is GETs only, so it moves no attempt counters. Expect Success on 001, 002, 006, 009; Failure
with both reasons on 003, 004, 007, 008; Manual on 005, 011; and 010 still Open with
`automation_status: completed` and no note.

## Deliverable 1: the export

Two things to fix before you download, because the export captures live state.

**Set the poll interval back to 60 minutes.** It is on 2 minutes from Phase 4 testing. Open
`Schedule: poll Waiting` → *Trigger Interval*. n8n's Minutes field caps at 59 (60 minutes is an hour,
not a minutes value), so set it to Hours → *Hours Between Triggers* = `1`, not Minutes → 60. The repo
copy at `workflow/nous-mso-mobile-recommendation.json` already says Hours/1; the live one may not.

**Name the workflow** something the file name can carry, for example `Nous MSO mobile recommendation
v1`. n8n names the download after the workflow, so this decides what lands in the reviewer's folder.

Then: Save, three dots top right → *Download*. That file is the deliverable, not the repo copy. The
n8n export includes the credential reference and any layout you have nudged since importing.

Check the download is the workflow you think it is:

```bash
node -e '
const a=require("./workflow/nous-mso-mobile-recommendation.json");
const b=require(process.argv[1]);
const n=(w)=>w.nodes.map((x)=>x.name).sort();
const A=n(a), B=n(b);
console.log("repo nodes", A.length, "| export nodes", B.length);
console.log("only in repo:", A.filter((x)=>!B.includes(x)).join(", ") || "none");
console.log("only in export:", B.filter((x)=>!A.includes(x)).join(", ") || "none");
const s=b.nodes.find((x)=>x.name==="Schedule: poll Waiting");
console.log("poll interval:", JSON.stringify(s.parameters.rule.interval));
' ~/Downloads/Nous_MSO_mobile_recommendation_v1.json
```

Adjust the path to wherever Chrome put it. You want 43 nodes both sides, no differences, and
`{"field":"hours","hoursInterval":1}`. If nodes differ, the live workflow drifted from the repo and
the export wins: copy it over `workflow/nous-mso-mobile-recommendation.json` and note what changed.

## Deliverable 2: the screenshots

### Frame conventions

Apply these to all eight, so the set reads as one thing.

- **Crop to the n8n content area.** No browser chrome, no bookmarks bar, no macOS menu bar. On a Mac,
  `Cmd+Shift+4` then drag, or `Cmd+Shift+4` then `Space` to grab a window and crop after.
- **Light mode**, browser zoom at 100%. Dark screenshots print badly and this may be read on paper.
- **The node name must be in frame.** Every claim below rests on which node you are looking at. In an
  open node the name is the panel title; on the canvas it is the label under the node.
- **PNG**, named `01-…` to `08-…` so the folder sorts into the narrative order.
- **No redaction needed.** Everything is synthetic and the bearer token never appears in a node panel,
  only in the credential, which you are not photographing.

### Where things are in n8n

- **Executions list:** left sidebar → *Overview* → *Executions* tab. That is the global list. The
  per-workflow list is the *Executions* tab next to *Editor* inside the workflow itself; use that one
  for shot 2, it is already filtered to this workflow.
- **Opening an execution:** click the row. You get the canvas in read-only, with the path that ran
  picked out and the branches that did not greyed.
- **Opening a node inside an execution:** double-click it. You get *INPUT* on the left and *OUTPUT* on
  the right, each with a **Table / JSON / Schema** toggle at the top of the panel. Use **JSON** for
  every shot below unless it says otherwise; Table flattens nested objects and the nesting is the
  point.

### Finding the executions

Fire times from `test/fires.log`, in UTC. n8n's *Started* is within a second of each.

| Ticket | UTC | UTC+1 | Outcome |
|---|---|---|---|
| **009** | 12:58:57 | 13:58:57 | Waiting, then the scheduled poll finished it |
| **010** | 13:01:26 | 14:01:26 | Exit, zero writes |
| 005 | 13:01:46 | 14:01:46 | Manual |
| 011 | 13:01:51 | 14:01:51 | Manual |
| 008 | 13:01:56 | 14:01:56 | Failure, price |
| 003 | 13:02:00 | 14:02:00 | Failure, price |
| **004** | 13:02:05 | 14:02:05 | Failure, coverage |
| 007 | 13:02:10 | 14:02:10 | Failure, data |
| **001** | 13:02:15 | 14:02:15 | Success |
| **002** | 13:02:20 | 14:02:20 | Success, iD loses |
| **006** | 13:02:24 | 14:02:24 | Success, after the 500 |

Bold are the six the shot list needs. n8n renders times in the browser's timezone, so print the same
table in yours rather than guessing the offset:

```bash
node -e '
const rows=require("fs").readFileSync("test/fires.log","utf8").trim().split("\n").map((l)=>({
  id:(l.match(/"ticketId":"(TICKET-\d+)"/)||[])[1], t:new Date(l.slice(0,24))
})).sort((a,b)=>a.t-b.t);
for(const r of rows) console.log(r.id, r.t.toLocaleTimeString());
'
```

If the clock still does not line up, use the order instead. It is fixed: 009 alone, a gap of about
two and a half minutes, then ten more at roughly five-second intervals in exactly the sequence above.
Counting up from the bottom of the block gets you there without trusting a timestamp.

**Expect scheduled rows in between.** The Schedule trigger was on two minutes during Phase 4 and every
poll saves an execution, including the ones that find nothing. Two consequences: bound the filter
panel's *Execution start* to roughly 12:55 to 13:05 for shot 2, and find 009's scheduled execution by
**run time** rather than by hunting. The empty polls stop at `Is Waiting?` in a second or two; the one
that completed 009 carries on through the data fetch and four PATCHes and takes visibly longer.

### The set

| # | Shot | The claim it carries |
|---|---|---|
| 1 | TICKET-001 execution, whole canvas | This is the shape of the job, and one ticket takes one path through it |
| 2 | Executions list, the 12:58 to 13:03 block | All eleven evaluated tickets ran, and nothing errored |
| 3 | TICKET-002, `Evaluate deals` output | The iD bar is a number in a ranked list, not a hand-wave |
| 4 | TICKET-004, the failure chain on canvas | Both reasons written, read back, verified, and only then the stage moves |
| 5 | TICKET-004, `POST WhatsApp` input | The customer message, and it is chosen by cause |
| 6 | TICKET-009, the scheduled execution | Empty inventory waits and retries rather than failing |
| 7 | TICKET-010 execution | Safe to re-run: a ticket already handled is touched by nothing |
| 8 | TICKET-006, `GET deals` | A 500 from the deal feed is absorbed, not surfaced |

Eight is the right number. A reviewer skims; each extra shot dilutes the ones that matter.

---

**1. `01-canvas-success-path.png`** — the workflow executing, and its shape.

Workflow → *Executions* tab → the TICKET-001 row (13:02:15). Zoom to fit with the control bottom left,
or `Cmd+Shift+1`. Capture the whole canvas.

In frame: both triggers on the left, the converging path through `Config`, `GET ticket`,
`Intake guards`, `Route intake`, the data fetch, `Evaluate deals`, `Route outcome`, and the lit
success branch through `PATCH: recommendation_pending` → `POST recommendation` →
`PATCH: recommendation_sent` → `PATCH: Success stage + completed`. The failure, waiting and manual
branches should be visibly present but unlit.

Caption: *TICKET-001, end to end. The four outcome branches are all on the canvas; one ticket lights
one of them. Status markers bracket the customer-facing POST so an interrupted run is legible.*

---

**2. `02-executions-all-eleven.png`** — the evidence that the set was actually run.

Workflow → *Executions* tab. Scroll so the block from 12:58:57 to roughly 13:03 is in frame: eleven
webhook executions plus the scheduled one that finished 009.

In frame: status (all Succeeded), start time, and the execution IDs. If your build shows a *Mode*
column, include it: it is what distinguishes the webhook runs from the `Schedule` one, and that
difference is the point of shot 6. If the list shows a workflow name column, fine, it confirms these
are all one workflow.

Caption: *The eleven evaluated tickets, one run each, plus the scheduled poll that completed 009.
Twelve executions, no errors. Outcomes in `test/results.md`.*

If the list is too tall to crop cleanly, take it in one shot at browser zoom 80%. Legibility of the
times and statuses matters more than the pixel scale.

---

**3. `03-evaluate-deals-id-penalty.png`** — the sharpest judgement shot in the set.

TICKET-002's execution (13:02:20) → double-click `Evaluate deals` → **OUTPUT** → **JSON**.

Scroll so the `evaluation` object is in frame, specifically:

- `feedCount: 3` and the `removed` counts
- the `pool` array in ranked order: **Talkmobile `price: 12.5`, `rankPence: 1250`**, then
  **Giffgaff `price: 14`, `rankPence: 1400`**, then **iD Mobile `price: 12`, `rankPence: 1400`**.
  iD is the cheapest deal in the feed and finishes last: the penalty puts it level with Giffgaff and
  the non-iD tie-break puts it behind
- `best` being the Talkmobile deal
- `decision.note` reading `Recommending Talkmobile 15GB £12.5/mo, saves £7.50/mo…`

That is the whole iD argument in one frame: iD is the cheapest line in the feed, the £2 penalty puts
it second, and the penalty is in the ranking key only, so the saving quoted to the customer is the
real £7.50 and not a penalised number.

Caption: *TICKET-002. iD Mobile is 50p cheaper and still loses: `rankPence` carries a £2 penalty from
`Config`, which changes the ordering and never the saving. The ops Slack thread about iD is a config
value, not a special case in the logic.*

If `pool` is collapsed or scrolled off, drag the divider between INPUT and OUTPUT to widen the right
panel. Two shots is acceptable here if one cannot hold both `pool` and `decision`, but try for one.

---

**4. `04-failure-reasons-verified.png`** — the post-mortem the process doc mentions.

TICKET-004's execution (13:02:05), in the **Logs** view rather than on the canvas. Select
`POST WhatsApp` in the left rail and leave the **INPUT** panel open.

The claim here is about order, and the Logs rail shows order with every node name legible, which a
zoomed canvas does not: `PATCH: failure reasons + note` → `GET ticket: read back reasons` →
`Verify reasons` → `Reasons verified?` → `PATCH: message_pending` → `POST WhatsApp` →
`PATCH: message_sent` → `PATCH: Failure stage + completed`.

The INPUT panel then does the rest of the work for free. It shows the ticket at the moment the message
is about to go out, and three things in it are the whole argument:

- both failure reasons already written and valid
- `automation_status: message_pending`, the marker bracketing the send
- `hs_pipeline_stage: 390658766`, **still the open stage**

Both reasons on the ticket, stage not yet moved. That is the post-mortem guard visible as data rather
than asserted in a caption.

Caption: *The brief's post-mortem was a ticket moved with only one reason set. Here both are written
in one PATCH, read back from the API and checked against the allowed lists before anything else
happens. The stage is still 390658766 at this point; it moves last, after the message is confirmed
sent. A read-back that disagrees routes to Manual instead.*

---

**5. `05-whatsapp-coverage.png`** — the customer-facing judgement.

Same TICKET-004 execution → `Evaluate deals` → **OUTPUT** → **JSON** → scroll to `whatsappMessage`.

**Not `POST WhatsApp`'s INPUT panel.** A node's INPUT is what the *upstream* node emitted, and
`POST WhatsApp` sits downstream of `PATCH: message_pending`, so its input is the PATCH response: the
whole ticket, no message in it. The body is built by an expression that reaches back past it:

```
{{ JSON.stringify({ ticketId: …, userId: …, message: $('Evaluate deals').item.json.whatsappMessage, testMode: … }) }}
```

So `Evaluate deals` is where the literal text lives. Also worth checking the **Parameters** tab on
`POST WhatsApp`: n8n usually renders a resolved preview under an expression field when there is
execution data, which would show the exact JSON that went over the wire. If it renders, prefer it.
Verify before relying on it.

In frame: `whatsappMessage`, reading the coverage template:

> Hi Casey, it's Nous.
> We've just looked at the SIM-only deals available at your address.
> The deals we found aren't expected to have good coverage at your postcode, so we're not going to
> move you onto something that might not work where you live.
> If you'd like us to look again, or you've spotted a deal you'd like us to check, just reply here.

`POST WhatsApp`'s OUTPUT is the mock's `{messageId, status: "sent"}`, which proves the call landed but
says nothing about what you wrote. Pair it with this shot only if you have room.

Caption: *004 failed on coverage, not price, so the customer is told about coverage. Three templates
keyed on `failureCause`. The reporting enum has no coverage value, so the ticket says
`INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL` and the customer gets the truth. That gap is my pushback item.*

That last sentence links the screenshot to Part A. Worth doing for exactly one shot; do it for more
and the captions start doing the doc's job.

---

**6. `06-waiting-then-scheduled-poll.png`** — inventory refreshes through the day.

This is two executions and you need both. Take it as one shot if you can get the two rows plus the
open execution in frame; otherwise `06a` and `06b`.

- `06a`: the webhook execution for 009 (12:58:57), ending at `PATCH: Waiting stage + stored input`.
  Open that node's **INPUT** → **JSON** to show the stored `automation_household_id`,
  `automation_user_id`, `automation_test_mode` and `automation_attempts: 1` going onto the ticket.
- `06b`: the later execution whose trigger is `Schedule: poll Waiting`, running
  `List poll candidates` → `GET ticket (poll)` → `Is Waiting?` → `Normalise polled ticket` → `Config`
  and on through to Success.

Caption: *009's first deals call came back empty. Rather than failing the ticket, the run parks it at
Waiting with everything the next attempt needs written onto the ticket itself, and a scheduled poll
picks it up. No n8n Wait node, so nothing is held in memory and a restart loses nothing. The note ends
`[schedule]` so you can tell from the ticket which path completed it.*

The stored-input detail is the one most worth showing: it is why the workflow survives being
re-dispatched, and it is not obvious from the canvas.

---

**7. `07-idempotent-exit.png`** — safe to re-run.

TICKET-010's execution (13:01:26). The whole canvas, which is short: `Webhook` →
`Normalise webhook input` → `Config` → `GET ticket` → `Intake guards` → `Route intake` →
`Slack: info (no action)` → `Exit: nothing to do`.

Optionally open `Intake guards` → **OUTPUT** → **JSON** to show `decision.shape: "I1b"` and the reason.

Caption: *010 arrives with `automation_status: completed` already set. The run re-reads the ticket
from the API rather than trusting the webhook, recognises it, posts one informational Slack line
because a completed marker on an open stage is worth a human knowing about, and stops. Zero writes.
Every evaluated ticket is now in this state, so every one of them is re-runnable without damage.*

---

**8. `08-deals-retry-500.png`** — the transient upstream failure.

TICKET-006's execution (13:02:24) → `GET deals`.

**Check this one before you rely on it.** The claim is that the node shows two tries, the first a 500.
n8n's in-node retries do not always surface as separate runs in the execution view. Open the node and
look for a *Run 1 of 2* selector at the top of the OUTPUT panel, or retry detail in the node's
footer. If it is there, photograph it and caption it as below.

If it is not there, take this instead, from the **editor**, not an execution: `GET deals` → *Settings*
tab, showing *Retry On Fail* on, *Max Tries* 4, *Wait Between Tries* 2000ms, and *On Error* set to
*Continue (using error output)*. Caption it as the policy rather than the event, and say in the doc
that 006's 500 was absorbed. Do not claim a retry is visible in a screenshot where it is not.

Caption, if the retry is visible: *006's deal feed returns a 500 on the first call and deals on the
second. The node absorbs it: four tries, two seconds apart. The ticket shows a clean Success and no
sign anything went wrong, which is the correct outcome. GETs retry; `POST recommendation` and
`POST WhatsApp` do not, because a duplicate there reaches the customer.*

That last clause is worth keeping whichever version you use. The asymmetry is a deliberate decision
and it is invisible unless you say it.

---

### Optional, if you want two more

Neither is necessary. Add them only if the set feels thin.

**9. The 18-deal feed.** TICKET-019 is unspent and its feed is the full unfiltered Stickee response:
18 deals across 14 providers, of which 12 are non-approved. It is the only place the approved-network
filter is visibly doing real work. It also repeats the iD result at scale: iD at £12 is the cheapest
approved deal and loses to Giffgaff at £14 on the penalty.

```bash
node tools/fire.mjs 019 --dry     # see the payload first
node tools/fire.mjs 019           # fire it, wait, print before and after
```

Then Overview → Executions → top row → `Evaluate deals` → OUTPUT → JSON. In frame:
`feedCount: 18`, `removed.nonApproved: 12`, the ranked `pool`, and
`decision.note` reading `Recommending Giffgaff 25GB £14/mo, saves £16.00/mo…`.

Firing spends 019. That is fine, it is sandbox, and the brief says to use them however helps.

**10. The unhandled-error path.** `Unhandled error` → `Slack: alert` → `PATCH: Manual stage + note`.
There should be an execution from Phase 3 showing this (the run with `HH-999`). If it is still in the
list, photograph it with `Slack: alert` selected and its **INPUT** open, scrolled to `decision.slack`,
which carries the severity, title, message and context that the request body is assembled from. Caption: *every node has its error output wired to one handler. Nothing fails
silently; anything unexpected becomes a Manual ticket and a Slack alert with enough context to act on.*

If that execution has aged out, skip it rather than manufacturing an error on a good ticket.

## Packaging

```
Saffron - Nous case study/
  Nous_MSO_mobile_recommendation_v1.json     the n8n download
  case-study.pdf                             your 2-page doc
  workflow-executions.pdf                    the eight screenshots, one per page
```

Send the doc as PDF, not a Google Doc link: it is going to a recruiter's inbox and page count is part
of the brief, so you want the pagination fixed.

Two judgement calls on packaging:

**Whether to include the repo.** The brief does not ask for it, and `catalogue.md`, `rules.md` and
`decisions.md` are considerably more than two pages. My view: do not attach them. Mention in the
doc's AI note that the probing catalogue and the rules table exist and that you will bring them to
the onsite. That way they are a demonstration of method when you are in the room to walk through
them, rather than unrequested reading now.

**Whether to caption the screenshots.** Yes, and in a separate PDF annex rather than in the doc. See
below.

## Formatting the screenshots

The screenshots are their own deliverable, not part of the two-page doc. Eight of them would eat the
whole page budget you need for Part A and Part B. Build them as a **separate PDF annex**, one file,
eight pages.

A folder of PNGs is worse than it looks: the ordering depends on how the reviewer's file manager
sorts, and they have to open eight windows. One PDF opens once and scrolls.

### Layout

**Landscape A4, one shot per page.** The canvas is wide and the JSON panels are dense. Two per page
drops the text below legibility, which defeats the point of showing JSON at all.

Each page, top to bottom:

1. **A bold one-line title**, the claim the shot carries. "TICKET-002: the iD bar, visible in the
   ranking." Not "Screenshot 3".
2. **The image**, as wide as the margins allow.
3. **Two or three lines of caption** underneath, smaller.

Number each page 1 to 8 to match the file names, because the doc points at them.

A contents page is overkill for eight pages. If you want orientation, put a four-line preamble at the
top of page 1: what the workflow is, that these are real executions from the evaluated set, and the
date they ran.

### Annotation

Sparingly, and only where what matters is one value buried in a wall of JSON. That is two shots:

- **Shot 3**: a box around `rankPence: 1250` and `rankPence: 1400`.
- **Shot 8**, if the retry is visible: a box around the run selector.

Everywhere else the node names and the canvas do the work. One accent colour, thin stroke, no drop
shadows, no callout bubbles. An over-annotated deck reads as though the screenshots cannot speak for
themselves.

### Legibility

The JSON is the evidence, so it has to survive. Before exporting, check one page at 100% on screen
and, if you can, printed. If `rankPence` is not readable, the shot is not doing its job. Crop tighter
rather than shrinking, and take a second shot instead of cramming two panels into one.

### Build

**Keynote, exported to PDF.** New document, choose a plain white theme, set the slide size to
1920x1080 or A4 landscape under *Document → Slide Size*. One shot per slide. Title in the title box,
image below, caption in a text box under it. For the two annotated shots use *Shape → Rectangle* with
no fill and a 3pt stroke in one colour. Then *File → Export To → PDF*, image quality Best.

Keep the deck file. If shot 8 has to be re-taken, you are swapping one image rather than rebuilding
the layout.

### How the doc uses it

Reference shots by number in the two-page doc: "the iD penalty is a ranking key, not a discount
(shot 3)". That buys the evidence without spending a line describing it.

Hold this line: **the argument lives in the two pages, the evidence lives in the annex.** Captions
describe what is on screen; they do not make the case. A caption that starts arguing belongs in
Part A. The one exception is shot 5, where the reporting-enum gap is the pushback item and the
screenshot is the clearest way to show it.

## Formatting Part A and Part B

Max two pages is the binding constraint, and the brief gives you seven things to cover in them. At
11pt single-spaced with 2cm margins that is roughly 900 to 1100 words. Budget it before you write,
because the two judgement calls are where the marks are and they are the easiest thing to get
squeezed by a long preamble.

**No preamble at all.** No restating the task, no "in this exercise I". The reviewer knows what they
set. First heading, then straight into it.

### Suggested split

| | Section | Rough words | Form |
|---|---|---|---|
| **Page 1** | Two judgement calls | 130 each | Prose |
| | What I would push back on, or the question | 90 | Prose |
| | v2 after two weeks | 90 | Prose or three bullets |
| | Three metrics and their triggers | 130 | **Table** |
| **Page 2** | Three replies and their routing | 60 each | **Table** |
| | How I would know the classifier was wrong | 130 | Prose |
| | How I used AI | 60 | Prose |

Two tables and the rest prose. The tables are doing real work: three metrics with a pause trigger
each, and three replies with a route and a reason each, are both grids, and writing them as
paragraphs costs you a third of a page for nothing. Everything else is judgement, and judgement reads
better in sentences.

### Headings

Mirror the brief's own words so the reviewer can tick them off: `Part A: Reflection`, then
`Two judgement calls`, `What I would push back on`, `v2`, `Metrics`. Then `Part B: Reply handling`.
Use a colon rather than the brief's dash, per the writing conventions.

Bold the lead phrase of each judgement call so the two are findable in a skim. That is the only
formatting flourish worth having.

### Where the raw material is

`decisions.md` has every judgement call across four phases with the reasoning attached. The
candidates worth considering for the two:

- **The 009 finding.** Probing with throwaway ticket IDs protected the evaluated set and hid the one
  retry-then-success scenario, because the mock keys it on the real ticket ID. The Waiting path was
  built on the process doc's word rather than on the probe evidence, and it was right. A judgement
  call with a visible payoff, and shot 6 is the evidence.
- **Manual for an interrupted run**, rather than a silent exit or an automatic resume. The workflow
  cannot tell whether the side effect went out, so it does not guess.
- **Three WhatsApp templates by cause**, with the reporting enum left honest but imprecise. This one
  doubles as the pushback item, so do not spend it twice.
- **The hard data floor**, and the shadow note that turns it into something measurable rather than an
  article of faith.

For the pushback, `decisions.md` "Open questions for onsite" has seven, already written up. Number 1
(no coverage-specific failure reason) is the strongest because it has a customer consequence and a
screenshot. Number 6 (what re-raises a ticket after a Switch Failure) is the better *question*,
because it is the thing that decides Part B reply 3, and using it ties the two halves of the doc
together.

For the metrics, two come free from the notes the workflow already writes: the share of failures
carrying a data-floor shadow line, and the share of tickets that pass through Waiting and then
succeed, which was 1 of 11 in the evaluated set. The third is yours.

For Part B, the useful thing to notice is that the "no deal" message deliberately does not promise to
check again, and it deliberately invites a reply. So reply 1 is traffic the message generates on
purpose, and reply 3 lands on a question the workflow cannot answer because the upstream cadence is
not ours. Say that, rather than inventing a policy.

I have not drafted any of this and will not. Send me a draft and I will check it against the brief,
the two-page limit and the writing conventions.

## Terminal reference

```bash
cd ~/Downloads/Nous

node tools/ticket-state.mjs               # all 11 evaluated tickets, read-only
node tools/ticket-state.mjs 019 012       # specific tickets
node tools/ticket-state.mjs sandbox       # 012 to 024

node tools/fire.mjs 019 --dry             # payload and curl, fires nothing
node tools/fire.mjs 019                   # fire a sandbox ticket, print before and after

node workflow/simulate.mjs                # offline re-check of every ticket against rules.md
node test/harness.mjs report              # rebuild test/results.md from what is on disk
```

`fire.mjs` refuses 001 to 011 and the sandbox tickets already spent (014, 016, 020, 023, 024). Unspent
sandbox: 012, 013, 015, 017, 018, 019, 021, 022.

Both tools read `.env` for `NOUS_BASE_URL`, `NOUS_BEARER_TOKEN` and `N8N_WEBHOOK_URL`, and append to
`probe/calls.log` and `test/fires.log` so the record of what touched the mock stays complete.
