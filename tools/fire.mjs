#!/usr/bin/env node
// Fires the production webhook for a sandbox ticket so there is a fresh execution in n8n to
// screenshot. Snapshots the ticket before, waits for it to settle, prints before and after.
//
//   node tools/fire.mjs 019            fire TICKET-019 / HH-019 / USR-019
//   node tools/fire.mjs 019 --dry      print the payload and the curl, fire nothing
//
// Refuses TICKET-001 to 011 (evaluated, all spent) and the sandbox tickets already spent in
// Phases 1 and 3. FORCE=1 overrides, which you should not need.

import { readFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split('\n')
  .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const BASE = ENV.NOUS_BASE_URL, TOKEN = ENV.NOUS_BEARER_TOKEN;
const WEBHOOK = ENV.N8N_WEBHOOK_URL || 'https://nousecasestudy.app.n8n.cloud/webhook/mso-mobile-recommendation';

const SPENT = new Set([14, 16, 20, 23, 24]);           // mutated in Phase 1 and Phase 3
const STAGE_NAME = { '390658766': 'Open', '446512118': 'Success', '409734350': 'Failure', '440806104': 'Manual', '5060559097': 'Waiting' };
const RESTING = new Set(['completed', 'manual', 'waiting']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const n = Number(String(process.argv[2] || '').replace(/\D/g, ''));
const dry = process.argv.includes('--dry');
if (!n || n < 1 || n > 24) { console.error('usage: node tools/fire.mjs <ticket number 12-24> [--dry]'); process.exit(1); }
if (!process.env.FORCE) {
  if (n <= 11) { console.error(`TICKET-${String(n).padStart(3, '0')} is evaluated and already in a terminal stage. Re-running it exits at I1b with no writes, which makes a dull screenshot. Ask Nous for a reset, or use a sandbox ticket.`); process.exit(1); }
  if (SPENT.has(n)) { console.error(`TICKET-${String(n).padStart(3, '0')} was already spent in an earlier phase and is in a terminal stage. Unspent sandbox: 012, 013, 015, 017, 018, 019, 021, 022.`); process.exit(1); }
}

const id = `TICKET-${String(n).padStart(3, '0')}`;
const payload = {
  ticketId: id,
  householdId: `HH-${String(n).padStart(3, '0')}`,
  userId: `USR-${String(n).padStart(3, '0')}`,
  ticketCategory: 'Mobile',
  pipelineId: '228462820',
  stageId: '390658766',
  testMode: true,
};

async function ticket() {
  const res = await fetch(`${BASE}/hubspot/tickets/${id}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  appendFileSync(join(ROOT, 'probe', 'calls.log'), `${new Date().toISOString()} GET /hubspot/tickets/${id} - status=${res.status} # fire.mjs\n`);
  return (await res.json()).properties;
}
const show = (label, p) => {
  console.log(`${label}: stage=${STAGE_NAME[p.hs_pipeline_stage] || p.hs_pipeline_stage} status=${p.automation_status || '-'} attempts=${p.automation_attempts ?? '-'}`);
  if (p.email_switch_failure_reason || p.reporting_switch_failure_reason) console.log(`  reasons: ${p.email_switch_failure_reason || '-'} / ${p.reporting_switch_failure_reason || '-'}`);
  if (p.next_task_description) console.log(`  note: ${p.next_task_description}`);
};

if (dry) {
  console.log(JSON.stringify(payload, null, 2));
  console.log(`\ncurl -s -X POST "${WEBHOOK}" -H "Content-Type: application/json" -d '${JSON.stringify(payload)}'`);
  process.exit(0);
}

const before = await ticket();
show('before', before);
if (before.automation_status && before.automation_status !== 'waiting' && !process.env.FORCE) {
  console.error(`\n${id} already has automation_status=${before.automation_status}. The run would exit at I1b. Stopping.`);
  process.exit(1);
}

const res = await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
const body = await res.text();
appendFileSync(join(ROOT, 'test', 'fires.log'), `${new Date().toISOString()} POST ${WEBHOOK} ${JSON.stringify(payload)} -> ${res.status} ${body}\n`);
console.log(`\nfired -> ${res.status} ${body}`);
if (res.status !== 200) process.exit(1);

const t0 = Date.now();
let after = before;
while (Date.now() - t0 < 60000) {
  await sleep(3000);
  after = await ticket();
  if (after.automation_status !== before.automation_status && RESTING.has(after.automation_status)) break;
}
console.log('');
show('after', after);
console.log('\nNow open the execution in n8n: Overview -> Executions, top of the list.');
