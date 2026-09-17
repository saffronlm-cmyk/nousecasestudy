# Workflow

n8n workflow JSON for the MSO mobile recommendation job. Built from `rules.md`.

## Files

| File | What |
|---|---|
| `nous-mso-mobile-recommendation.json` | The complete workflow. Same as `05-error-handling.json`. This is the submission file. |
| `01-intake-and-guards.json` to `05-error-handling.json` | Cumulative sections. File N contains everything in 1 to N. Outputs that lead into a later section end at a `Next section: ...` placeholder so each file runs on its own. |
| `build.mjs` | Generates every JSON file from one definition. `node workflow/build.mjs`. |
| `code/*.js` | The Code node sources. Edit these, rebuild, re-import. |
| `simulate.mjs` | Runs the generated JSON offline against the Phase 1 dumps and checks every ticket against `rules.md`. `node workflow/simulate.mjs`. |

## One-time setup in n8n

1. **Credential.** Credentials → Add → *Header Auth*. Name it exactly `Nous mock API`. Header name `Authorization`, value `Bearer <token from .env>`. Every HTTP node references this credential by name; if n8n shows them without a credential after import, pick it from the dropdown once and it applies to the node (do this for each HTTP node, or use the credential's "apply to all" if offered).
2. **Import.** Workflow → three dots → *Import from file* → pick the section file. Importing replaces the current canvas, so import each section into the same workflow in order, or into new workflows if you want to keep them side by side.
3. **Webhook URL.** Open `Webhook: HubSpot ticket`. The *Test URL* works while the editor is listening (click *Test workflow*), the *Production URL* works once the workflow is active.

## Firing a ticket

```bash
curl -s -X POST "https://<your-instance>.app.n8n.cloud/webhook-test/mso-mobile-recommendation" \
  -H "Content-Type: application/json" \
  -d '{"ticketId":"TICKET-024","householdId":"HH-024","userId":"USR-024","subject":"MOB | Dylan Owens | Make recommendation | Mobile #1","ticketCategory":"Mobile","pipelineId":"228462820","stageId":"390658766","testMode":true}'
```

The workflow only reads `ticketId`, `householdId`, `userId` and `testMode` from the body. Everything else comes from the ticket.

To exercise the Schedule path without waiting an hour: open `Schedule: poll Waiting` and click *Test step*. It polls the configured ticket list once.

## Which tickets to test each section with

The mock keeps state per ticket ID. Evaluated tickets (001 to 011) are one-shot and reserved for Phase 4. Test sections with sandbox tickets, and note that anything a section *writes* to is spent.

| Section | Writes? | Use | Why |
|---|---|---|---|
| 1 Intake and guards | No (one Slack info for 010) | Any ticket. 021 (subject suffix), 020 (silent exit, mutated) | GET only |
| 2 Data fetch | No | 013 (`#2` of 3), 023 (payment £0 → Manual placeholder) | GET only |
| 3 Deal evaluation | No, but each deals call under a real ticket ID advances that ticket's attempt counter | 019 (18-deal feed), 015 (coverage), 022 (data floor + iD), 012 (current provider) | Evaluation output visible in `Evaluate deals` |
| 4 Outcome branches | **Yes** | 024 (Success), 016 (Failure, price), 023 (Manual) | Each is then spent |
| 5 Error handling | Yes | Re-run 024 after section 4: it should exit at I1b with no writes. Send a webhook with a wrong `userId` for 018: D0 → Manual. | Idempotency and D0 |

Do not fire 006 or 009 before Phase 4: 006's first-attempt 500 and 009's empty feed are the retry scenarios and they only happen once per ticket ID.

## Reading an execution

Click any node in the execution view. The Code nodes carry the trail:

- `Intake guards`, `Pick service`, `Check payment`: `decision.route` and `decision.note` say which guard fired.
- `Evaluate deals`: `evaluation` shows the feed count, what each filter removed, the ranked pool, the best deal, the data-floor shadow and the saving in pence. `decision.note` is what will be written to the ticket. `waitingPatch` / `failurePatch` / `recommendationBody` / `whatsappMessage` are the exact bodies the branch will send.
- `Build manual`: `manualPatch` is what goes on the ticket.

## Notes on n8n behaviour the build relies on

- **Paired items.** Every Code node runs *once per item* and later nodes fetch earlier data with `$('Node name').item.json`. n8n resolves `.item` by walking back through the paired-item chain, so an HTTP node ten steps downstream can read the run input from `Config` without it being copied through every node. The Schedule path can emit several tickets at once and each one resolves to its own ancestors.
- **Error outputs.** HTTP and Code nodes have *Settings → On Error → Continue (using error output)*. That adds a second output that carries `{ error: { message } }`. Section 5 wires every one of them to `Unhandled error`. Before section 5 the setting is off, so an error stops the execution visibly in the editor.
- **Retry.** HTTP nodes have *Retry On Fail* with 4 tries, 2 seconds apart. Retries happen before the error output fires. The two customer-facing POSTs (`POST recommendation`, `POST WhatsApp`) have retry off: a duplicate there is a customer-facing error.
- **Switch outputs** are in rule order: `Route intake` is continue / manual / exit_slack / exit; `Route outcome` is success / failure / waiting / manual. `fallbackOutput: none` means an unrecognised route drops the item, which cannot happen because the Code nodes only emit those values.
- **PATCH and POST bodies** are built with `JSON.stringify(...)` in an expression. Note that this means the body is *not* in the node's INPUT panel: INPUT shows whatever the upstream node emitted, which for a node mid-chain is usually the previous PATCH's response. To see what was actually sent, read the source object on the node the expression names (`waitingPatch`, `failurePatch`, `manualPatch`, `recommendationBody`, `whatsappMessage`, `decision.slack`, all on `Evaluate deals` or `Build manual`), or open the node's *Parameters* tab, where n8n renders the resolved expression against the execution data.
