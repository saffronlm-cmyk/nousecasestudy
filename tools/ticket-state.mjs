#!/usr/bin/env node
// Read-only. Prints the current state of one or more tickets from the mock, so the ticket side of
// a screenshot can be checked against what n8n shows.
//
//   node tools/ticket-state.mjs                 all 11 evaluated tickets
//   node tools/ticket-state.mjs 019 012         those two
//   node tools/ticket-state.mjs sandbox         012 to 024
//
// GETs only. Safe on evaluated tickets: it does not touch /deals, so no attempt counter moves.

import { readFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split('\n')
  .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const BASE = ENV.NOUS_BASE_URL, TOKEN = ENV.NOUS_BEARER_TOKEN;

const STAGE_NAME = {
  '390658766': 'Open', '446512118': 'Success', '409734350': 'Failure',
  '440806104': 'Manual', '5060559097': 'Waiting',
};

const pad = (n) => `TICKET-${String(n).padStart(3, '0')}`;
const args = process.argv.slice(2);
let ids;
if (args.length === 0) ids = Array.from({ length: 11 }, (_, i) => pad(i + 1));
else if (args[0] === 'sandbox') ids = Array.from({ length: 13 }, (_, i) => pad(i + 12));
else if (args[0] === 'all') ids = Array.from({ length: 24 }, (_, i) => pad(i + 1));
else ids = args.map((a) => (/^TICKET-/i.test(a) ? a.toUpperCase() : pad(Number(a))));

async function get(id) {
  const res = await fetch(`${BASE}/hubspot/tickets/${id}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  appendFileSync(join(ROOT, 'probe', 'calls.log'),
    `${new Date().toISOString()} GET /hubspot/tickets/${id} - status=${res.status} # ticket-state\n`);
  if (res.status !== 200) return { error: `HTTP ${res.status}` };
  return (await res.json()).properties;
}

const rows = [];
for (const id of ids) {
  const p = await get(id);
  rows.push({
    id,
    stage: p.error || STAGE_NAME[p.hs_pipeline_stage] || p.hs_pipeline_stage || '-',
    status: p.automation_status || '-',
    attempts: p.automation_attempts ?? '-',
    email: p.email_switch_failure_reason || '-',
    reporting: p.reporting_switch_failure_reason || '-',
    note: p.next_task_description || '',
  });
}

const w = (k, min) => Math.max(min, ...rows.map((r) => String(r[k]).length));
const cols = [['id', 10], ['stage', 7], ['status', 22], ['attempts', 8]];
console.log(cols.map(([k, m]) => k.padEnd(w(k, m))).join('  '));
for (const r of rows) {
  console.log(cols.map(([k, m]) => String(r[k]).padEnd(w(k, m))).join('  '));
  if (r.email !== '-' || r.reporting !== '-') console.log(`    reasons: ${r.email} / ${r.reporting}`);
  if (r.note) console.log(`    note: ${r.note}`);
}
