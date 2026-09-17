#!/usr/bin/env node
// Sandbox-only mutation probes: discover POST body shapes and PATCH behaviour.
// Hard allowlist. Anything else is refused before a request is built.
//
//   node probe/mutate.mjs shapes      empty-body POSTs to learn required fields (no ticket referenced)
//   node probe/mutate.mjs patch       PATCH behaviour on TICKET-020
//   node probe/mutate.mjs posts       real-body POSTs against TICKET-024 / HH-024 / MOB-024
//
// Dumps to probe/_mutate/{name}.json and appends to probe/calls.log like probe.mjs.

import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'probe', '_mutate');
const LOG = join(ROOT, 'probe', 'calls.log');
const ENV = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const BASE = ENV.NOUS_BASE_URL, TOKEN = ENV.NOUS_BEARER_TOKEN;

const ALLOWED_TICKETS = new Set(['TICKET-020', 'TICKET-024']);
const ALLOWED_HH = new Set(['HH-020', 'HH-024']);
const ALLOWED_MOB = new Set(['MOB-020', 'MOB-024']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function guard(path, body) {
  const text = path + ' ' + JSON.stringify(body ?? {});
  for (const m of text.matchAll(/TICKET-\d{3}/g)) if (!ALLOWED_TICKETS.has(m[0])) throw new Error(`Refusing: ${m[0]} not in allowlist`);
  for (const m of text.matchAll(/HH-\d{3}/g)) if (!ALLOWED_HH.has(m[0])) throw new Error(`Refusing: ${m[0]} not in allowlist`);
  for (const m of text.matchAll(/MOB-\d{3}[A-Z]?/g)) if (!ALLOWED_MOB.has(m[0])) throw new Error(`Refusing: ${m[0]} not in allowlist`);
}

async function call(name, method, path, body, extraHeaders = {}) {
  guard(path, body);
  const headers = { Accept: 'application/json', Authorization: `Bearer ${TOKEN}`, ...extraHeaders };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const started = Date.now();
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  const rec = { at: new Date().toISOString(), request: { method, url: BASE + path, headers: { ...headers, Authorization: 'Bearer <redacted>' }, body }, status: res.status, durationMs: Date.now() - started, body: parsed };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(rec, null, 2));
  const line = `${rec.at} ${method} ${path} ${extraHeaders['X-Ticket-Id'] ? 'xtid=' + extraHeaders['X-Ticket-Id'] : '-'} status=${res.status} ${rec.durationMs}ms ${text.length}b # MUTATE ${name}`;
  appendFileSync(LOG, line + '\n');
  console.log(`\n[${name}] ${method} ${path} -> ${res.status}`);
  if (body !== undefined) console.log('  sent:', JSON.stringify(body));
  console.log('  got: ', JSON.stringify(parsed));
  await sleep(150);
  return rec;
}

const T = 'TICKET-020', T2 = 'TICKET-024';

async function shapes() {
  await call('rec.empty', 'POST', '/recommendation', {});
  await call('rec.nobody', 'POST', '/recommendation');
  await call('wa.empty', 'POST', '/comms/whatsapp', {});
  await call('slack.empty', 'POST', '/slack/notify', {});
}

async function patch() {
  await call('patch.before', 'GET', `/hubspot/tickets/${T}`);
  await call('patch.bare', 'PATCH', `/hubspot/tickets/${T}`, { next_task_description: 'probe: bare body' });
  await call('patch.wrapped', 'PATCH', `/hubspot/tickets/${T}`, { properties: { next_task_description: 'probe: wrapped body' } });
  await call('patch.custom', 'PATCH', `/hubspot/tickets/${T}`, { properties: { probe_custom_marker: 'set-by-probe', automation_status: 'probe_in_progress' } });
  await call('patch.badreason', 'PATCH', `/hubspot/tickets/${T}`, { properties: { email_switch_failure_reason: 'NOT A REAL VALUE' } });
  await call('patch.goodreason', 'PATCH', `/hubspot/tickets/${T}`, { properties: { email_switch_failure_reason: "Mob - can't beat deal", reporting_switch_failure_reason: 'INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL' } });
  await call('patch.badstage', 'PATCH', `/hubspot/tickets/${T}`, { properties: { hs_pipeline_stage: '999999999' } });
  await call('patch.empty', 'PATCH', `/hubspot/tickets/${T}`, {});
  await call('patch.after', 'GET', `/hubspot/tickets/${T}`);
}

async function posts() {
  // Bodies are guesses from the field names seen so far. Errors should tell us what is really required.
  await call('rec.guess1', 'POST', '/recommendation', { ticketId: T2, householdId: 'HH-024', mobileServiceId: 'MOB-024', stickeeDealId: 'SDL-GIFF-024', testMode: true });
  await call('wa.guess1', 'POST', '/comms/whatsapp', { ticketId: T2, userId: 'USR-024', message: 'Probe message, sandbox only.', testMode: true });
  await call('slack.guess1', 'POST', '/slack/notify', { ticketId: T2, severity: 'info', title: 'Probe', message: 'Sandbox probe from mutate.mjs', testMode: true });
  // Does the mock dedupe a second recommendation for the same ticket, and does any POST leave a mark on the ticket?
  await call('rec.duplicate', 'POST', '/recommendation', { ticketId: T2, householdId: 'HH-024', mobileServiceId: 'MOB-024', stickeeDealId: 'SDL-GIFF-024', testMode: true });
  await call('posts.ticket-after', 'GET', `/hubspot/tickets/${T2}`);
  await call('posts.deals-after', 'GET', `/deals/HH-024`, undefined, { 'X-Ticket-Id': T2 });
}

const stage = process.argv[2];
appendFileSync(LOG, `\n# ${new Date().toISOString()} mutate stage=${stage}\n`);
if (stage === 'shapes') await shapes();
else if (stage === 'patch') await patch();
else if (stage === 'posts') await posts();
else { console.log('Usage: node probe/mutate.mjs <shapes|patch|posts>'); process.exit(1); }
