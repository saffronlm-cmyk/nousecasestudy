# Phase 4 results

Generated 2026-09-17T13:03:04.962Z by `test/harness.mjs`. Oracle: `rules.md`, Expected outcomes. Per-ticket before/after in `test/results/`. Webhook fires in `test/fires.log`.

Messages sent are inferred from the status markers: `completed` on Failure means `message_sent` was reached, which only happens after `POST /comms/whatsapp` returned 200; likewise `completed` on Success for `POST /recommendation`. The n8n execution log is the direct evidence.

| Ticket | Expected | Actual | Result | Failure reasons | Note written |
|---|---|---|---|---|---|
| 009 | success / completed | success / completed (attempts 1) | pass |  | Recommending Giffgaff 30GB £15/mo, saves £10.00/mo. stickeeDealId: SDL-GIFF-001. 4 deals in feed, removed 0 malformed, 1 non-approved, 0 current provider, 0 coverage, 0 data. [schedule] |
| 010 | open / completed | open / completed | pass |  |  |
| 005 | manual / manual | manual / manual | pass |  | Routed to manual: monthlyData missing on MOB-005. |
| 011 | manual / manual | manual / manual | pass |  | Routed to manual: payment null on MOB-011. |
| 008 | failure / completed | failure / completed | pass | Mob - can't beat deal / INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL | Best eligible: Giffgaff 10GB £8, saves £-2.00, below £3.00 floor. 3 deals in feed, removed 0 malformed, 0 non-approved, 0 current provider, 0 coverage, 0 data. [webhook] |
| 003 | failure / completed | failure / completed | pass | Mob - can't beat deal / INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL | Best eligible: Giffgaff 15GB £14.5, saves £0.50, below £3.00 floor. 2 deals in feed, removed 0 malformed, 0 non-approved, 0 current provider, 0 coverage, 0 data. [webhook] |
| 004 | failure / completed | failure / completed | pass | Mob - can't beat deal / INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL | Best eligible: none (cause: coverage). 3 deals in feed, removed 0 malformed, 0 non-approved, 0 current provider, 3 coverage, 0 data. [webhook] |
| 007 | failure / completed | failure / completed | pass | Mob - can't beat deal / INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL | Best eligible: none (cause: data). 3 deals in feed, removed 0 malformed, 0 non-approved, 0 current provider, 0 coverage, 3 data. Ignoring data floor: Giffgaff 10GB £10 would save £20.00. [webhook] |
| 001 | success / completed | success / completed | pass |  | Recommending Giffgaff 30GB £15/mo, saves £10.00/mo. stickeeDealId: SDL-GIFF-001. 4 deals in feed, removed 0 malformed, 1 non-approved, 0 current provider, 0 coverage, 0 data. [webhook] |
| 002 | success / completed | success / completed | pass |  | Recommending Talkmobile 15GB £12.5/mo, saves £7.50/mo. stickeeDealId: SDL-TALK-002. 3 deals in feed, removed 0 malformed, 0 non-approved, 0 current provider, 0 coverage, 0 data. [webhook] |
| 006 | success / completed | success / completed | pass |  | Recommending Giffgaff 30GB £15/mo, saves £10.00/mo. stickeeDealId: SDL-GIFF-001. 4 deals in feed, removed 0 malformed, 1 non-approved, 0 current provider, 0 coverage, 0 data. [webhook] |
