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
`Schedule: poll Waiting` → *Trigger Interval* → Minutes → *Minutes Between Triggers* = `60`. The repo
copy at `workflow/nous-mso-mobile-recommendation.json` already says 60; the live one does not.

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
`minutesInterval: 60`. If nodes differ, the live workflow drifted from the repo and the export wins:
copy it over `workflow/nous-mso-mobile-recommendation.json` and note what changed.

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

TICKET-004's execution (13:02:05) → on the canvas, zoom into the failure branch so these six nodes are
in frame in order: `PATCH: failure reasons + note` → `GET ticket: read back reasons` →
`Verify reasons` → `Reasons verified?` → `PATCH: message_pending` → `POST WhatsApp` →
`PATCH: message_sent` → `PATCH: Failure stage + completed`.

The node names alone carry the argument, which is why this is a canvas shot rather than a panel shot.
If you want one panel open, open `Verify reasons` → **OUTPUT** → **JSON** and show `verified` populated
with both values and `decision.route: failure_verified`.

Caption: *The brief's post-mortem was a ticket moved with only one reason set. Here both are written
in one PATCH, read back from the API, checked against the allowed lists, and only then does the stage
move, last. A read-back that disagrees routes to Manual instead.*

---

**5. `05-whatsapp-coverage.png`** — the customer-facing judgement.

Same TICKET-004 execution → double-click `POST WhatsApp` → **INPUT** → **JSON**.

In frame: the request body, with `message` reading the coverage template:

> Hi Casey, it's Nous.
> We've just looked at the SIM-only deals available at your address.
> The deals we found aren't expected to have good coverage at your postcode, so we're not going to
> move you onto something that might not work where you live.
> If you'd like us to look again, or you've spotted a deal you'd like us to check, just reply here.

Use INPUT rather than OUTPUT. The output is the mock's `{messageId, status}`, which proves nothing;
the input is the message you wrote.

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
list, photograph the canvas with `Slack: alert`'s **INPUT** open so the alert body and its `context`
object are visible. Caption: *every node has its error output wired to one handler. Nothing fails
silently; anything unexpected becomes a Manual ticket and a Slack alert with enough context to act on.*

If that execution has aged out, skip it rather than manufacturing an error on a good ticket.

## Packaging

```
Saffron Lawson-Mills - Nous case study/
  Nous_MSO_mobile_recommendation_v1.json     the n8n download
  case-study.pdf                             your 2-page doc
  screenshots/
    01-canvas-success-path.png
    …
    08-deals-retry-500.png
```

Send the doc as PDF, not a Google Doc link: it is going to a recruiter's inbox and page count is part
of the brief, so you want the pagination fixed.

Two judgement calls on packaging:

**Whether to include the repo.** The brief does not ask for it, and `catalogue.md`, `rules.md` and
`decisions.md` are considerably more than two pages. My view: do not attach them. Mention in the
doc's AI note that the probing catalogue and the rules table exist and that you will bring them to
the onsite. That way they are a demonstration of method when you are in the room to walk through
them, rather than unrequested reading now.

**Whether to caption the screenshots.** Yes, but in the screenshots folder, not the doc: a
`screenshots/README.md` or a single caption line in each file name's place. The doc is capped at two
pages and captions would eat it. If you would rather keep the folder clean, put the eight captions
in one short `screenshots/captions.md`.

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
