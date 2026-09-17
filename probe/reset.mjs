#!/usr/bin/env node
// Reset TICKET-001 to TICKET-011 to their starting state before the final Phase 4 screenshot pass.
// Resets ticket properties only. The deals attempt counter (HH-006's 500 on attempt 1) is
// server-side and cannot be reset here — see note at the bottom.
//
// Usage: node probe/reset.mjs [--dry-run]

import { readFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = join(ROOT, 'probe', 'calls.log');
const ENV = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split('\n')
    .map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean).map(m => [m[1], m[2]])
);
const BASE = ENV.NOUS_BASE_URL;
const TOKEN = ENV.NOUS_BEARER_TOKEN;
if (!BASE || !TOKEN) throw new Error('NOUS_BASE_URL and NOUS_BEARER_TOKEN must be set in .env');

const DRY_RUN = process.argv.includes('--dry-run');
const EVALUATED = Array.from({ length: 11 }, (_, i) => `TICKET-${String(i + 1).padStart(3, '0')}`);

const RESET_PROPERTIES = {
  hs_pipeline_stage: '390658766',
  automation_status: null,
  next_task_description: null,
  email_switch_failure_reason: null,
  reporting_switch_failure_reason: null,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(method, path, body) {
  const headers = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  appendFileSync(LOG, `${new Date().toISOString()} ${method} ${path} status=${res.status} # reset\n`);
  return { status: res.status, body: JSON.parse(text) };
}

function verify(ticketId, props) {
  const p = props;
  const failures = [];
  if (p.hs_pipeline_stage !== RESET_PROPERTIES.hs_pipeline_stage)
    failures.push(`stage=${p.hs_pipeline_stage}`);
  if (p.automation_status !== null)
    failures.push(`automation_status=${p.automation_status}`);
  if (p.next_task_description !== null)
    failures.push(`next_task_description=${p.next_task_description}`);
  if (p.email_switch_failure_reason !== null)
    failures.push(`email_switch_failure_reason=${p.email_switch_failure_reason}`);
  if (p.reporting_switch_failure_reason !== null)
    failures.push(`reporting_switch_failure_reason=${p.reporting_switch_failure_reason}`);
  if (failures.length) {
    console.error(`  FAIL ${ticketId}: ${failures.join(', ')}`);
    return false;
  }
  console.log(`  OK   ${ticketId}`);
  return true;
}

appendFileSync(LOG, `\n# ${new Date().toISOString()} reset ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}\n`);
console.log(DRY_RUN ? '\n-- DRY RUN: no writes --\n' : '\n-- LIVE: patching evaluated tickets --\n');

let allOk = true;
for (const ticketId of EVALUATED) {
  if (DRY_RUN) {
    const { body } = await api('GET', `/hubspot/tickets/${ticketId}`);
    const p = body.properties;
    const dirty = [
      p.hs_pipeline_stage !== RESET_PROPERTIES.hs_pipeline_stage && `stage=${p.hs_pipeline_stage}`,
      p.automation_status && `automation_status=${p.automation_status}`,
      p.next_task_description && `next_task_description set`,
      p.email_switch_failure_reason && `email_reason set`,
      p.reporting_switch_failure_reason && `reporting_reason set`,
    ].filter(Boolean);
    console.log(`${ticketId}: ${dirty.length ? 'dirty — ' + dirty.join(', ') : 'already clean'}`);
  } else {
    await api('PATCH', `/hubspot/tickets/${ticketId}`, { properties: RESET_PROPERTIES });
    await sleep(150);
    const { body } = await api('GET', `/hubspot/tickets/${ticketId}`);
    const ok = verify(ticketId, body.properties);
    if (!ok) allOk = false;
  }
  await sleep(150);
}

if (!DRY_RUN) {
  console.log(allOk ? '\nAll 11 tickets verified clean.' : '\nOne or more tickets failed verification — check output above.');
}

// NOTE ON TICKET-006:
// The deals attempt counter (what causes HH-006 to return 500 on call 1 and deals on call 2)
// is server-side and is NOT reset by this script. It resets per X-Ticket-Id, not per run.
// After the first real Phase 4 run, TICKET-006's counter will be at attempt 2+.
// The 500 retry only fires on a ticket ID's first-ever deals call. If the workflow handles
// it correctly on the first run, use that execution's screenshot — don't reset and re-run.
