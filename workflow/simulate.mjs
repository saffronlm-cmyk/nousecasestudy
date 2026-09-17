#!/usr/bin/env node
// Offline simulator for the generated workflow JSON. Executes the real node graph: Code nodes run
// under a shim for $json / $('Node').item / $input / $prevNode, expressions are evaluated, and HTTP
// nodes hit an in-memory mock built from the Phase 1 dumps (tickets are mutable copies, deals use
// a per-ticket attempt counter, POSTs are recorded). No network calls.
//
//   node workflow/simulate.mjs [file.json] [ticket numbers...]
//   node workflow/simulate.mjs                       # complete workflow, all 24 tickets
//   node workflow/simulate.mjs workflow/03-deal-evaluation.json 1 6 9
//
// For each ticket: fires the webhook, then re-runs the Schedule path while the ticket is Waiting.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = join(ROOT, 'probe');
const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith('.json')) || join(ROOT, 'workflow', 'nous-mso-mobile-recommendation.json');
const only = args.filter((a) => /^\d+$/.test(a)).map(Number);
const wf = JSON.parse(readFileSync(file, 'utf8'));
const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));

// ---- in-memory mock --------------------------------------------------------
const pad = (n) => String(n).padStart(3, '0');
const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const state = { tickets: {}, dealsAttempt: {}, posts: [] };
function ticketFor(id) {
  if (!state.tickets[id]) {
    const p = join(PROBE, id, 'ticket.json');
    if (!existsSync(p)) return null;
    state.tickets[id] = JSON.parse(JSON.stringify(load(p).body));
  }
  return state.tickets[id];
}
function mock(method, url, headers, body) {
  const u = new URL(url); const path = u.pathname;
  let m;
  if (method === 'GET' && (m = path.match(/^\/hubspot\/tickets\/(.+)$/))) { const t = ticketFor(m[1]); return t ? [200, t] : [404, { error: 'Ticket not found' }]; }
  if (method === 'PATCH' && (m = path.match(/^\/hubspot\/tickets\/(.+)$/))) {
    const t = ticketFor(m[1]); if (!t) return [404, { error: 'Ticket not found' }];
    const props = body && body.properties ? body.properties : body || {};
    Object.assign(t.properties, props); return [200, t];
  }
  if (method === 'GET' && (m = path.match(/^\/context\/(.+)$/))) { const n = m[1].replace('HH-', ''); const p = join(PROBE, `TICKET-${n}`, 'context.json'); return existsSync(p) ? [load(p).status, load(p).body] : [404, { error: 'Household not found' }]; }
  if (method === 'GET' && (m = path.match(/^\/current-payment\/(.+)$/))) { const n = m[1].replace(/^MOB-(\d{3}).*$/, '$1'); const p = join(PROBE, `TICKET-${n}`, `current-payment.${m[1]}.json`); return existsSync(p) ? [load(p).status, load(p).body] : [404, { error: 'Payment not found' }]; }
  if (method === 'GET' && (m = path.match(/^\/deals\/(.+)$/))) {
    const tid = headers['X-Ticket-Id']; if (!tid) return [400, { error: 'Missing X-Ticket-Id header' }];
    const n = m[1].replace('HH-', ''); const dir = join(PROBE, `TICKET-${n}`);
    if (!existsSync(dir)) return [404, { error: 'Household not found' }];
    const attempt = (state.dealsAttempt[tid] = (state.dealsAttempt[tid] || 0) + 1);
    const files = readdirSync(dir).filter((f) => /^deals\.attempt\d+\.json$/.test(f)).sort();
    const rec = load(join(dir, files[Math.min(attempt, files.length) - 1]));
    return [rec.status, rec.body];
  }
  if (method === 'POST') { state.posts.push({ path, body }); return [200, path === '/recommendation' ? { recommendationId: 'REC-sim', success: true } : path === '/comms/whatsapp' ? { messageId: 'MSG-sim', status: 'sent' } : { ok: true }]; }
  return [404, { error: 'no route' }];
}

// ---- expression + code shim ---------------------------------------------------
function makeCtx(item, allItems, prevNodeName) {
  const $ = (name) => {
    if (!(name in item.history)) throw new Error(`$('${name}').item: node not in this item's ancestry`);
    return { item: { json: item.history[name] }, first: () => ({ json: item.history[name] }), all: () => [{ json: item.history[name] }] };
  };
  return { $json: item.json, $, $input: { item, first: () => allItems[0], all: () => allItems }, $prevNode: { name: prevNodeName } };
}
function evalExpr(value, ctx) {
  if (typeof value !== 'string' || !value.startsWith('=')) return value;
  const s = value.slice(1);
  const parts = []; let last = 0; const re = /\{\{([\s\S]*?)\}\}/g; let m; let single = null;
  while ((m = re.exec(s))) {
    const v = new Function('$json', '$', '$input', '$prevNode', `return (${m[1]});`)(ctx.$json, ctx.$, ctx.$input, ctx.$prevNode);
    if (m.index === 0 && re.lastIndex === s.length) single = v;
    parts.push(s.slice(last, m.index), typeof v === 'object' ? JSON.stringify(v) : String(v)); last = re.lastIndex;
  }
  if (single !== null && last === s.length && parts.length === 2 && parts[0] === '') return single;
  parts.push(s.slice(last)); return parts.join('');
}
function runCode(node, items, prevNodeName) {
  const fn = new Function('$json', '$', '$input', '$prevNode', node.parameters.jsCode);
  if (node.parameters.mode === 'runOnceForEachItem') {
    return items.map((it) => { const c = makeCtx(it, items, prevNodeName); const r = fn(c.$json, c.$, c.$input, c.$prevNode); return { json: r.json, history: { ...it.history } }; });
  }
  const c = makeCtx(items[0], items, prevNodeName);
  return fn(c.$json, c.$, c.$input, c.$prevNode).map((r) => ({ json: r.json, history: { ...items[0].history } }));
}

// ---- graph executor -----------------------------------------------------------
const log = [];
function outputs(node, items, prevNodeName) {
  const errOut = (its, message) => {
    if (node.onError !== 'continueErrorOutput') throw new Error(`${node.name}: ${message}`);
    return { 1: its.map((it) => ({ json: { error: { message } }, history: { ...it.history } })) };
  };
  switch (node.type) {
    case 'n8n-nodes-base.webhook': case 'n8n-nodes-base.scheduleTrigger': case 'n8n-nodes-base.noOp': return { 0: items };
    case 'n8n-nodes-base.code': {
      try { return { 0: runCode(node, items, prevNodeName) }; } catch (e) { return errOut(items, `Code error: ${e.message}`); }
    }
    case 'n8n-nodes-base.httpRequest': {
      const out = { 0: [], 1: [] };
      for (const it of items) {
        const c = makeCtx(it, items, prevNodeName); const p = node.parameters;
        const url = evalExpr(p.url, c); const headers = {}; for (const h of (p.headerParameters?.parameters || [])) headers[h.name] = evalExpr(h.value, c);
        let body; if (p.sendBody) { const b = evalExpr(p.jsonBody, c); body = typeof b === 'string' ? JSON.parse(b) : b; }
        const tries = node.retryOnFail ? node.maxTries : 1; let status, resBody;
        for (let i = 0; i < tries; i++) { [status, resBody] = mock(p.method, url, headers, body); log.push(`${p.method} ${new URL(url).pathname}${headers['X-Ticket-Id'] ? ' xtid=' + headers['X-Ticket-Id'] : ''} -> ${status}${i ? ` (try ${i + 1})` : ''}`); if (status < 400) break; }
        if (status < 400) out[0].push({ json: resBody, history: { ...it.history } });
        else { const e = errOut([it], `HTTP ${status}: ${JSON.stringify(resBody)}`); out[1].push(...e[1]); }
      }
      return out;
    }
    case 'n8n-nodes-base.if': {
      const out = { 0: [], 1: [] };
      for (const it of items) { const c = makeCtx(it, items, prevNodeName); const cd = node.parameters.conditions.conditions[0]; const ok = String(evalExpr(cd.leftValue, c)) === String(evalExpr(cd.rightValue, c)); out[ok ? 0 : 1].push(it); }
      return out;
    }
    case 'n8n-nodes-base.switch': {
      const out = {};
      for (const it of items) { const c = makeCtx(it, items, prevNodeName); const rules = node.parameters.rules.values; const i = rules.findIndex((r) => String(evalExpr(r.conditions.conditions[0].leftValue, c)) === String(evalExpr(r.conditions.conditions[0].rightValue, c))); if (i >= 0) (out[i] ??= []).push(it); }
      return out;
    }
    default: throw new Error(`Unsupported node type ${node.type}`);
  }
}
function execute(startName, startJson) {
  const queue = [[startName, [{ json: startJson, history: {} }], null]];
  const visited = [];
  while (queue.length) {
    const [name, items, prev] = queue.shift(); const node = byName[name];
    for (const it of items) it.history[name] = it.json; // record what this item looked like entering the node
    const outs = outputs(node, items, prev);
    for (const it of items) it.history[name] = null;
    for (const [idx, its] of Object.entries(outs)) { for (const it of its) it.history[name] = it.json; }
    visited.push(name);
    const conns = wf.connections[name]?.main || [];
    for (const [idx, its] of Object.entries(outs)) { if (!its.length) continue; for (const target of (conns[idx] || [])) queue.push([target.node, its.map((it) => ({ json: it.json, history: { ...it.history } })), name]); }
  }
  return visited;
}

// ---- run every ticket ------------------------------------------------------------
const EXPECTED = { // from rules.md
  1: ['446512118', 'completed'], 2: ['446512118', 'completed'], 3: ['409734350', 'completed'], 4: ['409734350', 'completed'], 5: ['440806104', 'manual'],
  6: ['446512118', 'completed'], 7: ['409734350', 'completed'], 8: ['409734350', 'completed'], 9: ['440806104', 'manual'], 10: ['390658766', 'completed'], 11: ['440806104', 'manual'],
  12: ['409734350', 'completed'], 13: ['446512118', 'completed'], 14: ['446512118', 'completed'], 15: ['446512118', 'completed'], 16: ['409734350', 'completed'], 17: ['409734350', 'completed'],
  // 20: dump predates the Phase 1 mutation; live, 020 exits at I1b. Not in the poll list, so stays Waiting here.
  18: ['446512118', 'completed'], 19: ['446512118', 'completed'], 20: ['5060559097', 'waiting'],
  21: ['446512118', 'completed'], 22: ['446512118', 'completed'], 23: ['440806104', 'manual'], 24: ['446512118', 'completed'],
};
const STAGE = { '390658766': 'Open', '446512118': 'Success', '409734350': 'Failure', '440806104': 'Manual', '5060559097': 'Waiting' };
let failures = 0;
const tickets = only.length ? only : Array.from({ length: 24 }, (_, i) => i + 1);
for (const n of tickets) {
  const ticketId = `TICKET-${pad(n)}`, householdId = `HH-${pad(n)}`, userId = `USR-${pad(n)}`;
  state.posts.length = 0; log.length = 0;
  const t0 = ticketFor(ticketId); const subject = t0.properties.subject;
  const payload = { ticketId, householdId, userId, subject, ticketCategory: 'Mobile', pipelineId: '228462820', stageId: t0.properties.hs_pipeline_stage, testMode: true };
  let visited = [], errorMsg = null;
  try {
    visited = execute('Webhook: HubSpot ticket', { headers: {}, params: {}, query: {}, body: payload });
    // Re-dispatch through the Schedule path while the ticket is Waiting (poll list is the evaluated 11).
    let guard = 0;
    while (byName['Schedule: poll Waiting'] && ticketFor(ticketId).properties.hs_pipeline_stage === '5060559097' && guard++ < 5) {
      const before = state.posts.length; visited.push('|poll|', ...execute('Schedule: poll Waiting', { timestamp: new Date().toISOString() }).filter((v) => !v.startsWith('GET ticket (poll)')));
    }
  } catch (e) { errorMsg = e.message; }
  const t = ticketFor(ticketId).properties;
  const wa = state.posts.filter((p) => p.path === '/comms/whatsapp').map((p) => p.body.message.split('\n')[1].slice(0, 40));
  const rec = state.posts.filter((p) => p.path === '/recommendation').map((p) => p.body.stickeeDealId);
  const slack = state.posts.filter((p) => p.path === '/slack/notify').map((p) => `${p.body.severity}:${p.body.title}`);
  const exp = EXPECTED[n]; const got = [t.hs_pipeline_stage, t.automation_status ?? null];
  const complete = /05-error-handling|nous-mso/.test(file);
  const ok = !complete || (exp && got[0] === exp[0] && got[1] === exp[1] && !errorMsg);
  if (!ok) failures++;
  console.log(`${ticketId} ${ok ? 'OK  ' : 'FAIL'} stage=${STAGE[t.hs_pipeline_stage] || t.hs_pipeline_stage} status=${t.automation_status} attempts=${t.automation_attempts ?? '-'}${rec.length ? ' rec=' + rec.join(',') : ''}${wa.length ? ' whatsapp=' + JSON.stringify(wa) : ''}${slack.length ? ' slack=' + slack.join(',') : ''}${errorMsg ? ' ERROR: ' + errorMsg : ''}`);
  if (t.next_task_description) console.log(`   note: ${t.next_task_description}`);
  if (process.env.VERBOSE) { console.log('   path: ' + visited.join(' > ')); console.log('   calls: ' + log.join(' | ')); }
}
console.log(failures ? `\n${failures} ticket(s) differ from rules.md` : '\nAll tickets match rules.md');
process.exit(failures ? 1 : 0);
