#!/usr/bin/env node
// Phase 4 harness. Fires the production webhook for each evaluated ticket, waits for the workflow
// to finish, reads the ticket back from the mock and compares it with the oracle in rules.md.
//
//   node test/harness.mjs plan                 show the run order and what each run spends, fire nothing
//   node test/harness.mjs snapshot             GET all 11 evaluated tickets to test/results/pre/ (safe)
//   node test/harness.mjs run 9                fire one ticket and check it
//   node test/harness.mjs run 10 5 11 ...      fire several in the order given
//   node test/harness.mjs check 9              re-read a ticket and re-check it (no firing)
//   node test/harness.mjs report               rebuild test/results.md from what is on disk
//
// Every mock call is appended to probe/calls.log. Every webhook fire is appended to test/fires.log.
// Evaluated tickets are one-shot: `run` refuses a ticket that already has a result file unless
// FORCE=1 is set.

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'test', 'results');
const ENV = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const BASE = ENV.NOUS_BASE_URL, TOKEN = ENV.NOUS_BEARER_TOKEN;
const WEBHOOK = ENV.N8N_WEBHOOK_URL || 'https://nousecasestudy.app.n8n.cloud/webhook/mso-mobile-recommendation';
const pad = (n) => String(n).padStart(3, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STAGES = { open: '390658766', success: '446512118', failure: '409734350', manual: '440806104', waiting: '5060559097' };
const STAGE_NAME = Object.fromEntries(Object.entries(STAGES).map(([k, v]) => [v, k]));
const REASONS = { email: "Mob - can't beat deal", reporting: 'INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL' };

// Oracle, from rules.md "Expected outcomes". `note` patterns must all match next_task_description.
const ORACLE = {
  1:  { stage: 'success', status: 'completed', reasons: false, note: [/^Recommending Giffgaff 30GB £15\/mo, saves £10\.00\/mo/, /SDL-GIFF-001/], spends: 'Success: 4 writes + recommendation' },
  2:  { stage: 'success', status: 'completed', reasons: false, note: [/^Recommending Talkmobile 15GB £12\.5\/mo, saves £7\.50\/mo/, /SDL-TALK-002/], spends: 'Success: 4 writes + recommendation. Multi-service #2, iD loses on penalty' },
  3:  { stage: 'failure', status: 'completed', reasons: true, note: [/^Best eligible: Giffgaff 15GB £14\.5, saves £0\.50, below £3\.00 floor/], spends: 'Failure: 6 writes + WhatsApp (price)' },
  4:  { stage: 'failure', status: 'completed', reasons: true, note: [/^Best eligible: none \(cause: coverage\)/, /3 coverage/], spends: 'Failure: 6 writes + WhatsApp (coverage)' },
  5:  { stage: 'manual', status: 'manual', reasons: false, note: [/^Routed to manual: monthlyData missing on MOB-005\./], spends: 'Manual: 1 write, no Slack' },
  6:  { stage: 'success', status: 'completed', reasons: false, note: [/^Recommending Giffgaff 30GB £15\/mo, saves £10\.00\/mo/, /SDL-GIFF-001/], spends: 'Success after in-node retry of the 500 (visible only in n8n). 4 writes + recommendation' },
  7:  { stage: 'failure', status: 'completed', reasons: true, note: [/^Best eligible: none \(cause: data\)/, /3 data/, /Ignoring data floor: Giffgaff 10GB £10 would save £20\.00/], spends: 'Failure: 6 writes + WhatsApp (data)' },
  8:  { stage: 'failure', status: 'completed', reasons: true, note: [/^Best eligible: Giffgaff 10GB £8, saves £-2\.00, below £3\.00 floor/], spends: 'Failure: 6 writes + WhatsApp (price)' },
  9:  { stage: 'success', status: 'completed', reasons: false, attempts: 1, note: [/^Recommending Giffgaff 30GB £15\/mo, saves £10\.00\/mo/, /SDL-GIFF-001/, /\[schedule\]$/],
        interim: { stage: 'waiting', status: 'waiting', attempts: 1 }, spends: 'Waiting (1 write), then the scheduled poll finds deals on attempt 2 and runs the Success chain. Needs the Schedule trigger live.' },
  10: { stage: 'open', status: 'completed', reasons: false, note: [], unchanged: true, spends: 'Nothing. Exit at I1b + one Slack info. Re-runnable.' },
  11: { stage: 'manual', status: 'manual', reasons: false, note: [/^Routed to manual: payment null on MOB-011\./], spends: 'Manual: 1 write, no Slack' },
};
const ORDER = [9, 10, 5, 11, 8, 3, 4, 7, 1, 2, 6];

// ---- mock + webhook ---------------------------------------------------------------------------------
async function getTicket(id) {
  const res = await fetch(`${BASE}/hubspot/tickets/${id}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const body = await res.json();
  appendFileSync(join(ROOT, 'probe', 'calls.log'), `${new Date().toISOString()} GET /hubspot/tickets/${id} - status=${res.status} # phase4 harness\n`);
  if (res.status !== 200) throw new Error(`GET ${id} -> ${res.status}`);
  return body.properties;
}
async function fire(n) {
  const id = `TICKET-${pad(n)}`;
  const payload = { ticketId: id, householdId: `HH-${pad(n)}`, userId: `USR-${pad(n)}`, testMode: true };
  const res = await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const text = await res.text();
  appendFileSync(join(ROOT, 'test', 'fires.log'), `${new Date().toISOString()} POST ${WEBHOOK} ${JSON.stringify(payload)} -> ${res.status} ${text}\n`);
  if (res.status !== 200) throw new Error(`webhook -> ${res.status} ${text}. Is the workflow active?`);
  return text;
}
// Wait until the ticket reaches a resting status (completed, manual, waiting) or the timeout passes.
// The first PATCH in a chain changes the note long before the chain finishes, so "changed" is not enough.
// For a ticket expected to stay untouched (010), wait a fixed grace period instead.
const RESTING = new Set(['completed', 'manual', 'waiting']);
async function settle(id, before, { timeoutMs = 60000, expectChange = true } = {}) {
  const t0 = Date.now();
  if (!expectChange) { await sleep(8000); return await getTicket(id); }
  while (Date.now() - t0 < timeoutMs) {
    await sleep(3000);
    const p = await getTicket(id);
    const changed = p.next_task_description !== before.next_task_description || p.automation_status !== before.automation_status;
    if (changed && RESTING.has(p.automation_status)) return p;
  }
  return await getTicket(id);
}

// ---- checking ------------------------------------------------------------------------------------------
function check(n, p, o) {
  const problems = [];
  if (p.hs_pipeline_stage !== STAGES[o.stage]) problems.push(`stage ${STAGE_NAME[p.hs_pipeline_stage] || p.hs_pipeline_stage} (want ${o.stage})`);
  if ((p.automation_status ?? null) !== o.status) problems.push(`status ${p.automation_status} (want ${o.status})`);
  const e = p.email_switch_failure_reason ?? null, r = p.reporting_switch_failure_reason ?? null;
  if (o.reasons) { if (e !== REASONS.email) problems.push(`email reason ${JSON.stringify(e)}`); if (r !== REASONS.reporting) problems.push(`reporting reason ${JSON.stringify(r)}`); }
  else if (e !== null || r !== null) problems.push(`reasons set on a non-failure: ${e} / ${r}`);
  const note = p.next_task_description ?? '';
  for (const re of o.note) if (!re.test(note)) problems.push(`note does not match ${re}`);
  if (o.unchanged && note !== '') problems.push('note written on a ticket that should be untouched');
  if (o.attempts !== undefined && Number(p.automation_attempts) !== o.attempts) problems.push(`attempts ${p.automation_attempts} (want ${o.attempts})`);
  return problems;
}
function record(n, data) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, `TICKET-${pad(n)}.json`), JSON.stringify(data, null, 2)); }

// ---- commands --------------------------------------------------------------------------------------------
async function plan() {
  console.log(`Webhook: ${WEBHOOK}\nOrder:`);
  for (const n of ORDER) { const o = ORACLE[n]; const done = existsSync(join(OUT, `TICKET-${pad(n)}.json`)) ? ' [has result]' : ''; console.log(`  ${pad(n)}  -> ${o.stage.padEnd(8)} ${String(o.status).padEnd(10)} ${o.spends}${done}`); }
}
async function snapshot() {
  mkdirSync(join(OUT, 'pre'), { recursive: true });
  for (const n of ORDER) { const id = `TICKET-${pad(n)}`; const p = await getTicket(id); writeFileSync(join(OUT, 'pre', `${id}.json`), JSON.stringify(p, null, 2)); console.log(`${id} stage=${STAGE_NAME[p.hs_pipeline_stage] || p.hs_pipeline_stage} status=${p.automation_status}`); }
}
async function run(list) {
  for (const n of list) {
    const id = `TICKET-${pad(n)}`, o = ORACLE[n];
    if (!o) { console.log(`${id}: not an evaluated ticket, skipping`); continue; }
    if (existsSync(join(OUT, `${id}.json`)) && !process.env.FORCE) { console.log(`${id}: already has a result. Set FORCE=1 to fire again.`); continue; }
    const before = await getTicket(id);
    console.log(`\n${id}: firing (${o.spends})`);
    const ack = await fire(n);
    const t0 = Date.now();
    let after = await settle(id, before, { expectChange: !o.unchanged });
    let interim = null, interimProblems = null;
    if (o.interim) {
      interim = after; interimProblems = check(n, after, { ...o.interim, reasons: false, note: [/^Attempt 1 of 3: no eligible deals in feed\./] });
      console.log(`   interim: stage=${STAGE_NAME[after.hs_pipeline_stage]} status=${after.automation_status} attempts=${after.automation_attempts} ${interimProblems.length ? 'PROBLEMS: ' + interimProblems.join('; ') : 'OK'}`);
      console.log('   waiting for the Schedule trigger to run the poll twice (up to 15 minutes)...');
      const t1 = Date.now();
      while (Date.now() - t1 < 15 * 60000) { await sleep(20000); const p = await getTicket(id); if (p.hs_pipeline_stage !== STAGES.waiting) { after = p; break; } if (Number(p.automation_attempts) !== Number(after.automation_attempts)) { after = p; console.log(`   poll advanced: attempts=${p.automation_attempts} note=${p.next_task_description}`); } }
      after = await getTicket(id);
    }
    const problems = check(n, after, o);
    const result = { ticketId: id, firedAt: new Date(t0).toISOString(), webhookAck: ack, before, interim, interimProblems, after, problems, ok: problems.length === 0 && (!interimProblems || interimProblems.length === 0), secondsToSettle: Math.round((Date.now() - t0) / 1000) };
    record(n, result);
    console.log(`   ${result.ok ? 'OK  ' : 'FAIL'} stage=${STAGE_NAME[after.hs_pipeline_stage] || after.hs_pipeline_stage} status=${after.automation_status}${after.automation_attempts != null ? ' attempts=' + after.automation_attempts : ''}`);
    if (after.next_task_description) console.log(`   note: ${after.next_task_description}`);
    if (problems.length) console.log(`   problems: ${problems.join('; ')}`);
  }
  report();
}
async function checkOnly(list) {
  for (const n of list) { const id = `TICKET-${pad(n)}`; const p = await getTicket(id); const problems = check(n, p, ORACLE[n]); console.log(`${id} ${problems.length ? 'FAIL ' + problems.join('; ') : 'OK'} stage=${STAGE_NAME[p.hs_pipeline_stage] || p.hs_pipeline_stage} status=${p.automation_status}`); if (p.next_task_description) console.log(`   note: ${p.next_task_description}`);
    const f = join(OUT, `${id}.json`); if (existsSync(f)) { const r = JSON.parse(readFileSync(f)); r.after = p; r.problems = problems; r.ok = problems.length === 0 && (!r.interimProblems || r.interimProblems.length === 0); r.recheckedAt = new Date().toISOString(); writeFileSync(f, JSON.stringify(r, null, 2)); } }
  report();
}
function report() {
  if (!existsSync(OUT)) return;
  const rows = [];
  for (const n of ORDER) {
    const f = join(OUT, `TICKET-${pad(n)}.json`); if (!existsSync(f)) { rows.push(`| ${pad(n)} | ${ORACLE[n].stage} / ${ORACLE[n].status} | not run | | | |`); continue; }
    const r = JSON.parse(readFileSync(f)); const a = r.after;
    const reasons = a.email_switch_failure_reason ? `${a.email_switch_failure_reason} / ${a.reporting_switch_failure_reason}` : '';
    rows.push(`| ${pad(n)} | ${ORACLE[n].stage} / ${ORACLE[n].status} | ${STAGE_NAME[a.hs_pipeline_stage] || a.hs_pipeline_stage} / ${a.automation_status}${a.automation_attempts != null ? ` (attempts ${a.automation_attempts})` : ''} | ${r.ok ? 'pass' : 'FAIL: ' + r.problems.join('; ')} | ${reasons} | ${(a.next_task_description || '').replace(/\|/g, '\\|')} |`);
  }
  const md = `# Phase 4 results\n\nGenerated ${new Date().toISOString()} by \`test/harness.mjs\`. Oracle: \`rules.md\`, Expected outcomes. Per-ticket before/after in \`test/results/\`. Webhook fires in \`test/fires.log\`.\n\nMessages sent are inferred from the status markers: \`completed\` on Failure means \`message_sent\` was reached, which only happens after \`POST /comms/whatsapp\` returned 200; likewise \`completed\` on Success for \`POST /recommendation\`. The n8n execution log is the direct evidence.\n\n| Ticket | Expected | Actual | Result | Failure reasons | Note written |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
  writeFileSync(join(ROOT, 'test', 'results.md'), md);
}

const [cmd, ...rest] = process.argv.slice(2);
const nums = rest.map(Number).filter((n) => n > 0);
if (cmd === 'plan') await plan();
else if (cmd === 'snapshot') await snapshot();
else if (cmd === 'run') await run(nums.length ? nums : ORDER);
else if (cmd === 'check') await checkOnly(nums.length ? nums : ORDER);
else if (cmd === 'report') report();
else console.log('Usage: node test/harness.mjs <plan|snapshot|run [n...]|check [n...]|report>');
