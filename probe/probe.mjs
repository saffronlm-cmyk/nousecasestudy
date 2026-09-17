#!/usr/bin/env node
// Probe the Nous mock API and dump raw responses to probe/{ticketId}/{endpoint}.json
//
// Usage:
//   node probe/probe.mjs tickets            GET ticket + context for TICKET-001..024 (safe)
//   node probe/probe.mjs payments           GET current-payment for every service found in context dumps (safe)
//   node probe/probe.mjs gate [n]           Test whether a throwaway X-Ticket-Id works on /deals for HH-n (default HH-001)
//   node probe/probe.mjs gate-sandbox       Same, walking HH-012..024 until one shows attempt-based behaviour
//   node probe/probe.mjs deals [n] [list]   GET /deals for HH-001..024 (or comma list of numbers) with PROBE-* ticket ids, n calls each (default 4)
//   node probe/probe.mjs deals-real n [k]   GET /deals/HH-n with the REAL X-Ticket-Id TICKET-n, k times. Sandbox n only. Burns its counter.
//   node probe/probe.mjs errors             Hit unknown ids / missing auth to capture error shapes (safe)
//
// Rules baked in:
//   - Never sends POST or PATCH. Sandbox mutation lives in a separate script.
//   - Never sends X-Ticket-Id: TICKET-0xx on /deals. Only PROBE-* ids.
//   - Every call appended to probe/calls.log.

import { readFileSync, mkdirSync, writeFileSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'probe');
const LOG = join(OUT, 'calls.log');

// ---- config --------------------------------------------------------------

function loadEnv() {
  const env = {};
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}
const ENV = loadEnv();
const BASE = ENV.NOUS_BASE_URL;
const TOKEN = ENV.NOUS_BEARER_TOKEN;
if (!BASE || !TOKEN) throw new Error('NOUS_BASE_URL and NOUS_BEARER_TOKEN must be set in .env');

const EVALUATED = range(1, 11);
const SANDBOX = range(12, 24);
const ALL = [...EVALUATED, ...SANDBOX];
const DELAY_MS = 150;
const RUN_TAG = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ''); // e.g. 202609171045

function range(a, b) { return Array.from({ length: b - a + 1 }, (_, i) => a + i); }
function pad(n) { return String(n).padStart(3, '0'); }
function ticketId(n) { return `TICKET-${pad(n)}`; }
function householdId(n) { return `HH-${pad(n)}`; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- http ----------------------------------------------------------------

async function call({ method = 'GET', path, headers = {}, auth = true, saveTo, label }) {
  const url = BASE + path;
  const h = { Accept: 'application/json', ...headers };
  if (auth) h.Authorization = `Bearer ${TOKEN}`;

  const started = Date.now();
  let status = 0, resHeaders = {}, bodyText = '', body = null, error = null;
  try {
    const res = await fetch(url, { method, headers: h });
    status = res.status;
    res.headers.forEach((v, k) => { resHeaders[k] = v; });
    bodyText = await res.text();
    try { body = JSON.parse(bodyText); } catch { body = bodyText; }
  } catch (e) {
    error = String(e);
  }
  const durationMs = Date.now() - started;

  const record = {
    at: new Date().toISOString(),
    request: { method, url, headers: { ...h, Authorization: auth ? 'Bearer <redacted>' : undefined } },
    status, durationMs, error,
    responseHeaders: resHeaders,
    body,
  };

  const logLine = [
    record.at, method, path,
    headers['X-Ticket-Id'] ? `xtid=${headers['X-Ticket-Id']}` : '-',
    `status=${status}`, `${durationMs}ms`, `${bodyText.length}b`,
    label ? `# ${label}` : '',
  ].join(' ');
  appendFileSync(LOG, logLine + '\n');
  console.log(logLine);

  if (saveTo) {
    mkdirSync(dirname(saveTo), { recursive: true });
    writeFileSync(saveTo, JSON.stringify(record, null, 2));
  }
  await sleep(DELAY_MS);
  return record;
}

function out(ticket, file) { return join(OUT, ticket, file); }

// ---- stages --------------------------------------------------------------

async function stageTickets() {
  for (const n of ALL) {
    const t = ticketId(n), hh = householdId(n);
    await call({ path: `/hubspot/tickets/${t}`, saveTo: out(t, 'ticket.json') });
    await call({ path: `/context/${hh}`, saveTo: out(t, 'context.json') });
  }
}

// Walk a context body and pull out anything that looks like a mobile service id.
// Deliberately loose: we do not yet know the shape. Prints what it found so it can be checked.
function findServiceIds(body) {
  const found = new Map(); // id -> path
  const visit = (node, path) => {
    if (Array.isArray(node)) { node.forEach((v, i) => visit(v, `${path}[${i}]`)); return; }
    if (node && typeof node === 'object') {
      const onMobilePath = /mobile|service/i.test(path);
      for (const [k, v] of Object.entries(node)) {
        // Also collect currentPaymentRef: the brief says the path takes a mobileServiceId, but the
        // context exposes a separate payment ref, so probe both and see which the mock honours.
        if (onMobilePath && /^(id|mobileServiceId|serviceId|currentPaymentRef)$/i.test(k) && (typeof v === 'string' || typeof v === 'number')) {
          if (!found.has(String(v))) found.set(String(v), `${path}.${k}`);
        }
        visit(v, `${path}.${k}`);
      }
    }
  };
  visit(body, '$');
  return found;
}

async function stagePayments() {
  for (const n of ALL) {
    const t = ticketId(n);
    const ctxPath = out(t, 'context.json');
    if (!existsSync(ctxPath)) { console.log(`skip ${t}: no context.json (run "tickets" first)`); continue; }
    const ctx = JSON.parse(readFileSync(ctxPath, 'utf8'));
    const ids = findServiceIds(ctx.body);
    if (ids.size === 0) { console.log(`${t}: no service ids found in context`); continue; }
    for (const [id, path] of ids) {
      console.log(`${t}: service ${id} at ${path}`);
      await call({ path: `/current-payment/${encodeURIComponent(id)}`, saveTo: out(t, `current-payment.${id}.json`) });
    }
  }
}

function summariseDeals(rec) {
  const b = rec.body;
  const deals = b && Array.isArray(b.deals) ? b.deals : null;
  const extraKeys = b && typeof b === 'object' ? Object.keys(b).filter((k) => k !== 'deals') : [];
  return { status: rec.status, dealCount: deals ? deals.length : null, envelopeKeys: extraKeys, extras: Object.fromEntries(extraKeys.map((k) => [k, b[k]])) };
}

async function stageGate(n = 1) {
  const hh = householdId(n);
  const dir = join(OUT, '_gate', hh);
  console.log(`\n== Gate on ${hh}: does a throwaway X-Ticket-Id work on /deals, and is the counter keyed on ticket? ==`);

  const a = [];
  for (let i = 1; i <= 3; i++) {
    a.push(await call({ path: `/deals/${hh}`, headers: { 'X-Ticket-Id': `PROBE-GATE-${hh}-A` }, saveTo: join(dir, `A.attempt${i}.json`), label: 'gate A' }));
  }
  const b = await call({ path: `/deals/${hh}`, headers: { 'X-Ticket-Id': `PROBE-GATE-${hh}-B` }, saveTo: join(dir, 'B.attempt1.json'), label: 'gate B' });
  const noHeader = await call({ path: `/deals/${hh}`, saveTo: join(dir, 'no-header.json'), label: 'gate no X-Ticket-Id' });

  const sa = a.map(summariseDeals), sb = summariseDeals(b), sn = summariseDeals(noHeader);
  console.log('\nA (same probe id x3):', JSON.stringify(sa));
  console.log('B (fresh probe id x1):', JSON.stringify(sb));
  console.log('No header:            ', JSON.stringify(sn));

  const aOk = sa.every((s) => s.status === 200);
  const bOk = sb.status === 200;
  const aChanges = new Set(sa.map((s) => JSON.stringify([s.dealCount, s.extras]))).size > 1;
  const bLooksFresh = JSON.stringify([sb.dealCount, sb.extras]) === JSON.stringify([sa[0].dealCount, sa[0].extras]);

  let verdict;
  if (!aOk || !bOk) verdict = 'FAIL: probe ids rejected. Do not proceed to deals stage. Stop and report.';
  else if (aChanges && bLooksFresh) verdict = 'PASS: attempt state changes per call and resets on a fresh id, so it is keyed on X-Ticket-Id. Safe to probe with PROBE-* ids.';
  else if (aChanges && !bLooksFresh) verdict = 'FAIL: state changed across A but B did not look fresh. Counter may be keyed on household. HH-001 may already be contaminated. Stop and report.';
  else verdict = 'INCONCLUSIVE: probe ids accepted but nothing changed across 3 calls on HH-001. Cannot tell what the counter is keyed on from this household alone. Report before proceeding.';

  console.log('\nVERDICT:', verdict);
  writeFileSync(join(dir, 'verdict.json'), JSON.stringify({ household: hh, a: sa, b: sb, noHeader: sn, verdict }, null, 2));
  return verdict.startsWith('PASS') ? 'PASS' : verdict.startsWith('FAIL') ? 'FAIL' : 'INCONCLUSIVE';
}

// Sandbox households only. Walk until one shows attempt-based behaviour and either confirms or
// refutes that the counter is keyed on X-Ticket-Id. A FAIL stops immediately.
async function stageGateSandbox() {
  for (const n of SANDBOX) {
    const r = await stageGate(n);
    if (r === 'PASS') { console.log(`\nGate PASSED on ${householdId(n)}.`); return; }
    if (r === 'FAIL') { console.log(`\nGate FAILED on ${householdId(n)}. Stopping.`); return; }
  }
  console.log('\nNo sandbox household showed attempt-based behaviour. Gate still inconclusive.');
}

function anyGatePassed() {
  const dir = join(OUT, '_gate');
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((d) => {
    const v = join(dir, d, 'verdict.json');
    // PASS or INCONCLUSIVE both mean probe ids were accepted with 200. Only FAIL blocks.
    return existsSync(v) && !JSON.parse(readFileSync(v, 'utf8')).verdict.startsWith('FAIL');
  });
}

async function stageDeals(attempts, only) {
  if (!anyGatePassed()) throw new Error('No gate has passed. Run "gate" or "gate-sandbox" first and review the verdict.');
  for (const n of (only ?? ALL)) {
    const t = ticketId(n), hh = householdId(n);
    const probeId = `PROBE-${hh}-${RUN_TAG}`;
    for (let i = 1; i <= attempts; i++) {
      const rec = await call({ path: `/deals/${hh}`, headers: { 'X-Ticket-Id': probeId }, saveTo: out(t, `deals.attempt${i}.json`) });
      console.log(`   ${t} attempt ${i}:`, JSON.stringify(summariseDeals(rec)));
    }
  }
}

// Real sandbox ticket id on /deals. This burns that ticket's attempt counter, so sandbox only.
async function stageDealsReal(n, attempts) {
  if (!SANDBOX.includes(n)) throw new Error(`Refusing: TICKET-${pad(n)} is not a sandbox ticket. Real ids only go on TICKET-012..024.`);
  const t = ticketId(n), hh = householdId(n);
  for (let i = 1; i <= attempts; i++) {
    const rec = await call({ path: `/deals/${hh}`, headers: { 'X-Ticket-Id': t }, saveTo: out(t, `deals.REAL.attempt${i}.json`), label: 'REAL ticket id, sandbox' });
    console.log(`   ${t} REAL attempt ${i}:`, JSON.stringify(summariseDeals(rec)));
  }
}

async function stageErrors() {
  const dir = join(OUT, '_errors');
  await call({ path: `/hubspot/tickets/TICKET-999`, saveTo: join(dir, 'ticket-unknown.json'), label: 'unknown ticket' });
  await call({ path: `/context/HH-999`, saveTo: join(dir, 'context-unknown.json'), label: 'unknown household' });
  await call({ path: `/current-payment/NOPE-999`, saveTo: join(dir, 'payment-unknown.json'), label: 'unknown service' });
  await call({ path: `/deals/HH-999`, headers: { 'X-Ticket-Id': 'PROBE-ERR' }, saveTo: join(dir, 'deals-unknown.json'), label: 'unknown household deals' });
  await call({ path: `/hubspot/tickets/TICKET-012`, auth: false, saveTo: join(dir, 'no-auth.json'), label: 'no auth' });
  await call({ path: `/hubspot/tickets/TICKET-012`, headers: { Authorization: 'Bearer wrong' }, auth: false, saveTo: join(dir, 'bad-auth.json'), label: 'bad auth' });
}

// ---- main ----------------------------------------------------------------

const [stage, arg] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
appendFileSync(LOG, `\n# ${new Date().toISOString()} stage=${stage ?? '(none)'} run=${RUN_TAG}\n`);

switch (stage) {
  case 'tickets': await stageTickets(); break;
  case 'payments': await stagePayments(); break;
  case 'gate': await stageGate(Number(arg) || 1); break;
  case 'gate-sandbox': await stageGateSandbox(); break;
  case 'deals': await stageDeals(Number(arg) || 4, process.argv[4] ? process.argv[4].split(',').map(Number) : undefined); break;
  case 'errors': await stageErrors(); break;
  case 'deals-real': await stageDealsReal(Number(arg), Number(process.argv[4]) || 4); break;
  default:
    console.log('Usage: node probe/probe.mjs <tickets|payments|gate|deals [n]|errors>');
    process.exit(1);
}
