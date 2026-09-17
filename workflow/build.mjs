#!/usr/bin/env node
// Generates the n8n workflow JSON from one definition. Sections are cumulative: file N contains
// everything in files 1..N, with outputs that lead into a later section wired to a placeholder
// NoOp so each file imports and runs on its own.
//
//   node workflow/build.mjs
//
// Code node sources live in workflow/code/*.js. Edit those, not the JSON.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_NAME = 'Nous MSO mobile recommendation';
const CREDENTIAL_NAME = 'Nous mock API';       // HTTP Header Auth: Authorization: Bearer <token>
const RETRY = { retryOnFail: true, maxTries: 4, waitBetweenTries: 2000 }; // 1 try + 3 retries, 2s apart
const SECTIONS = [
  [1, '01-intake-and-guards'],
  [2, '02-data-fetch'],
  [3, '03-deal-evaluation'],
  [4, '04-outcome-branches'],
  [5, '05-error-handling'],
];

const uuid = (s) => { const h = createHash('md5').update(s).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const src = (f) => readFileSync(join(DIR, 'code', f), 'utf8');
const pos = ([c, r]) => [c * 260, r * 170];
const cond = (left, right, type = 'string', operation = 'equals') => ({
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
  conditions: [{ id: uuid(left + right), leftValue: left, rightValue: right, operator: { type, operation } }],
  combinator: 'and',
});

// ---- node builders -------------------------------------------------------
// Every node: { name, section, errorFrom, at, ...n8n node fields }. `section` is the file it first
// appears in; `errorFrom` is the section from which its error output is enabled and wired.

const nodes = [];
const add = (n) => { nodes.push(n); return n; };

const code = (name, file, { section, at, mode = 'each', errorFrom = 5 }) => add({
  name, section, errorFrom, at,
  type: 'n8n-nodes-base.code', typeVersion: 2,
  parameters: { jsCode: src(file), ...(mode === 'each' ? { mode: 'runOnceForEachItem' } : {}) },
});

const http = (name, { section, at, method, url, headers, body, retry = true, errorFrom = 5 }) => add({
  name, section, errorFrom, at,
  type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
  parameters: {
    method, url,
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    ...(headers ? { sendHeaders: true, headerParameters: { parameters: headers.map(([n, v]) => ({ name: n, value: v })) } } : {}),
    ...(body ? { sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: body } : {}),
    options: {},
  },
  credentials: { httpHeaderAuth: { id: uuid(CREDENTIAL_NAME), name: CREDENTIAL_NAME } },
  ...(retry ? RETRY : {}),
});

const ifNode = (name, { section, at, left, right, type, operation }) => add({
  name, section, errorFrom: 99, at,
  type: 'n8n-nodes-base.if', typeVersion: 2.2,
  parameters: { conditions: cond(left, right, type, operation), options: {} },
});

const switchNode = (name, { section, at, left, outputs }) => add({
  name, section, errorFrom: 99, at,
  type: 'n8n-nodes-base.switch', typeVersion: 3.2,
  parameters: { rules: { values: outputs.map((o) => ({ conditions: cond(left, o), renameOutput: true, outputKey: o })) }, options: { fallbackOutput: 'none' } },
});

const noop = (name, { section, at }) => add({ name, section, errorFrom: 99, at, type: 'n8n-nodes-base.noOp', typeVersion: 1, parameters: {} });

// ---- expression helpers --------------------------------------------------
const C = "$('Config').item.json";          // run input anchor
const E = "$('Evaluate deals').item.json";  // evaluation anchor for the outcome branches
const ticketUrl = (anchor) => `={{ ${anchor}.cfg.baseUrl }}/hubspot/tickets/{{ ${anchor}.ticketId }}`;
const patchBody = (anchor, props) => `={{ JSON.stringify({ properties: ${props.replace(/\$A/g, anchor)} }) }}`;
const slackBody = (anchor) => `={{ JSON.stringify({ ticketId: ${anchor}.ticketId, householdId: ${anchor}.householdId, ...${anchor}.decision.slack, testMode: ${anchor}.testMode }) }}`;

// ---- section 1: triggers, intake and guards ------------------------------
add({ name: 'Webhook: HubSpot ticket', section: 1, errorFrom: 99, at: [0, 2], type: 'n8n-nodes-base.webhook', typeVersion: 2, webhookId: uuid('webhook'),
  parameters: { httpMethod: 'POST', path: 'mso-mobile-recommendation', responseMode: 'onReceived', options: {} } });
code('Normalise webhook input', 'normalise-webhook-input.js', { section: 1, at: [4, 2] });

add({ name: 'Schedule: poll Waiting', section: 1, errorFrom: 99, at: [0, 0], type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
  parameters: { rule: { interval: [{ field: 'hours' }] } } });
code('List poll candidates', 'list-poll-candidates.js', { section: 1, at: [1, 0], mode: 'all' });
http('GET ticket (poll)', { section: 1, at: [2, 0], method: 'GET', url: '={{ $json.poll.baseUrl }}/hubspot/tickets/{{ $json.ticketId }}', errorFrom: 1 });
ifNode('Is Waiting?', { section: 1, at: [3, 0], left: '={{ $json.properties.hs_pipeline_stage }}', right: "={{ $('List poll candidates').item.json.poll.waitingStageId }}" });
code('Normalise polled ticket', 'normalise-polled-ticket.js', { section: 1, at: [4, 0] });

code('Config', 'config.js', { section: 1, at: [5, 1], errorFrom: 99 });
http('GET ticket', { section: 1, at: [6, 1], method: 'GET', url: '={{ $json.cfg.baseUrl }}/hubspot/tickets/{{ $json.ticketId }}' });
code('Intake guards', 'intake-guards.js', { section: 1, at: [7, 1] });
switchNode('Route intake', { section: 1, at: [8, 1], left: '={{ $json.decision.route }}', outputs: ['continue', 'manual', 'exit_slack', 'exit'] });
http('Slack: info (no action)', { section: 1, at: [9, 3], method: 'POST', url: `={{ ${C}.cfg.baseUrl }}/slack/notify`, body: slackBody('$json'), errorFrom: 99 });
noop('Exit: nothing to do', { section: 1, at: [9, 4] });

// ---- section 2: data fetch -----------------------------------------------
http('GET context', { section: 2, at: [9, 1], method: 'GET', url: '={{ $json.cfg.baseUrl }}/context/{{ $json.householdId }}' });
code('Pick service', 'pick-service.js', { section: 2, at: [10, 1] });
ifNode('Service ok?', { section: 2, at: [11, 1], left: '={{ $json.decision.route }}', right: 'continue' });
http('GET current payment', { section: 2, at: [12, 1], method: 'GET', url: '={{ $json.cfg.baseUrl }}/current-payment/{{ $json.service.id }}', errorFrom: 2 });
code('Payment failed', 'payment-failed.js', { section: 2, at: [12, 3], errorFrom: 99 });
code('Check payment', 'check-payment.js', { section: 2, at: [13, 1] });
ifNode('Payment ok?', { section: 2, at: [14, 1], left: '={{ $json.decision.route }}', right: 'continue' });

// ---- section 3: deal evaluation ------------------------------------------
http('GET deals', { section: 3, at: [15, 1], method: 'GET', url: '={{ $json.cfg.baseUrl }}/deals/{{ $json.householdId }}', headers: [['X-Ticket-Id', '={{ $json.ticketId }}']], errorFrom: 3 });
code('Deals fetch failed', 'deals-fetch-failed.js', { section: 3, at: [15, 3], errorFrom: 99 });
code('Evaluate deals', 'evaluate-deals.js', { section: 3, at: [16, 1] });
switchNode('Route outcome', { section: 3, at: [17, 1], left: '={{ $json.decision.route }}', outputs: ['success', 'failure', 'waiting', 'manual'] });

// ---- section 4: outcome branches -----------------------------------------
// Success
http('PATCH: recommendation_pending', { section: 4, at: [18, 0], method: 'PATCH', url: ticketUrl('$json'), body: patchBody('$json', '{ next_task_description: $A.decision.note, automation_status: "recommendation_pending" }') });
http('POST recommendation', { section: 4, at: [19, 0], method: 'POST', url: `={{ ${E}.cfg.baseUrl }}/recommendation`, body: `={{ JSON.stringify(${E}.recommendationBody) }}`, retry: false });
http('PATCH: recommendation_sent', { section: 4, at: [20, 0], method: 'PATCH', url: ticketUrl(E), body: patchBody(E, '{ automation_status: "recommendation_sent" }') });
http('PATCH: Success stage + completed', { section: 4, at: [21, 0], method: 'PATCH', url: ticketUrl(E), body: patchBody(E, '{ automation_status: "completed", hs_pipeline_stage: $A.cfg.stages.success }') });
// Switch Failure
http('PATCH: failure reasons + note', { section: 4, at: [18, 1], method: 'PATCH', url: ticketUrl('$json'), body: patchBody('$json', '$A.failurePatch') });
http('GET ticket: read back reasons', { section: 4, at: [19, 1], method: 'GET', url: ticketUrl(E) });
code('Verify reasons', 'verify-reasons.js', { section: 4, at: [20, 1] });
ifNode('Reasons verified?', { section: 4, at: [21, 1], left: '={{ $json.decision.route }}', right: 'failure_verified' });
http('PATCH: message_pending', { section: 4, at: [22, 1], method: 'PATCH', url: ticketUrl(E), body: patchBody(E, '{ automation_status: "message_pending" }') });
http('POST WhatsApp', { section: 4, at: [23, 1], method: 'POST', url: `={{ ${E}.cfg.baseUrl }}/comms/whatsapp`, body: `={{ JSON.stringify({ ticketId: ${E}.ticketId, userId: ${E}.userId, message: ${E}.whatsappMessage, testMode: ${E}.testMode }) }}`, retry: false });
http('PATCH: message_sent', { section: 4, at: [24, 1], method: 'PATCH', url: ticketUrl(E), body: patchBody(E, '{ automation_status: "message_sent" }') });
http('PATCH: Failure stage + completed', { section: 4, at: [25, 1], method: 'PATCH', url: ticketUrl(E), body: patchBody(E, '{ automation_status: "completed", hs_pipeline_stage: $A.cfg.stages.failure }') });
// Waiting
http('PATCH: Waiting stage + stored input', { section: 4, at: [18, 2], method: 'PATCH', url: ticketUrl('$json'), body: patchBody('$json', '$A.waitingPatch') });
// Manual (shared by every manual route)
code('Build manual', 'build-manual.js', { section: 4, at: [18, 5], errorFrom: 99 });
ifNode('Slack needed?', { section: 4, at: [19, 5], left: "={{ $json.decision && $json.decision.slack ? 'yes' : 'no' }}", right: 'yes' });
http('Slack: alert', { section: 4, at: [20, 5], method: 'POST', url: `={{ ${C}.cfg.baseUrl }}/slack/notify`, body: slackBody("$('Build manual').item.json") });
http('PATCH: Manual stage + note', { section: 4, at: [21, 5], method: 'PATCH', url: ticketUrl("$('Build manual').item.json"), body: patchBody("$('Build manual').item.json", '$A.manualPatch') });

// ---- section 5: error handling -------------------------------------------
code('Unhandled error', 'unhandled-error.js', { section: 5, at: [13, 7], errorFrom: 99 });
http('Slack: manual PATCH failed', { section: 5, at: [22, 6], method: 'POST', url: `={{ ${C}.cfg.baseUrl }}/slack/notify`, errorFrom: 99,
  body: `={{ JSON.stringify({ ticketId: ${C}.ticketId, householdId: ${C}.householdId, severity: 'error', title: 'Manual PATCH failed', message: ${C}.ticketId + ': could not move ticket to Manual: ' + (($json.error || {}).message || JSON.stringify($json.error || {})), context: { shape: 'ERR', stepFailed: 'PATCH: Manual stage + note', ticketStage: null }, testMode: ${C}.testMode }) }}` });

// ---- connections ---------------------------------------------------------
// [from, outputIndex, to]. Output 0 is main/true/first-rule; IF false is 1; Switch rules are 0..n; error output is the last index (`err`).
const err = 'err';
const links = [
  // triggers to Config
  ['Webhook: HubSpot ticket', 0, 'Normalise webhook input'], ['Normalise webhook input', 0, 'Config'],
  ['Schedule: poll Waiting', 0, 'List poll candidates'], ['List poll candidates', 0, 'GET ticket (poll)'], ['GET ticket (poll)', 0, 'Is Waiting?'],
  ['Is Waiting?', 0, 'Normalise polled ticket'], ['Normalise polled ticket', 0, 'Config'],
  // section 1
  ['Config', 0, 'GET ticket'], ['GET ticket', 0, 'Intake guards'], ['Intake guards', 0, 'Route intake'],
  ['Route intake', 0, 'GET context'], ['Route intake', 1, 'Build manual'], ['Route intake', 2, 'Slack: info (no action)'], ['Route intake', 3, 'Exit: nothing to do'],
  // section 2
  ['GET context', 0, 'Pick service'], ['Pick service', 0, 'Service ok?'], ['Service ok?', 0, 'GET current payment'], ['Service ok?', 1, 'Build manual'],
  ['GET current payment', 0, 'Check payment'], ['GET current payment', err, 'Payment failed'], ['Payment failed', 0, 'Build manual'],
  ['Check payment', 0, 'Payment ok?'], ['Payment ok?', 0, 'GET deals'], ['Payment ok?', 1, 'Build manual'],
  // section 3
  ['GET deals', 0, 'Evaluate deals'], ['GET deals', err, 'Deals fetch failed'], ['Deals fetch failed', 0, 'Evaluate deals'], ['Evaluate deals', 0, 'Route outcome'],
  ['Route outcome', 0, 'PATCH: recommendation_pending'], ['Route outcome', 1, 'PATCH: failure reasons + note'], ['Route outcome', 2, 'PATCH: Waiting stage + stored input'], ['Route outcome', 3, 'Build manual'],
  // section 4: success
  ['PATCH: recommendation_pending', 0, 'POST recommendation'], ['POST recommendation', 0, 'PATCH: recommendation_sent'], ['PATCH: recommendation_sent', 0, 'PATCH: Success stage + completed'],
  // section 4: failure
  ['PATCH: failure reasons + note', 0, 'GET ticket: read back reasons'], ['GET ticket: read back reasons', 0, 'Verify reasons'], ['Verify reasons', 0, 'Reasons verified?'],
  ['Reasons verified?', 0, 'PATCH: message_pending'], ['Reasons verified?', 1, 'Build manual'],
  ['PATCH: message_pending', 0, 'POST WhatsApp'], ['POST WhatsApp', 0, 'PATCH: message_sent'], ['PATCH: message_sent', 0, 'PATCH: Failure stage + completed'],
  // section 4: manual
  ['Build manual', 0, 'Slack needed?'], ['Slack needed?', 0, 'Slack: alert'], ['Slack needed?', 1, 'PATCH: Manual stage + note'], ['Slack: alert', 0, 'PATCH: Manual stage + note'],
  // section 5: every remaining error output
  ...['GET ticket', 'Intake guards', 'GET context', 'Pick service', 'Check payment', 'Evaluate deals',
    'PATCH: recommendation_pending', 'POST recommendation', 'PATCH: recommendation_sent', 'PATCH: Success stage + completed',
    'PATCH: failure reasons + note', 'GET ticket: read back reasons', 'Verify reasons', 'PATCH: message_pending', 'POST WhatsApp', 'PATCH: message_sent', 'PATCH: Failure stage + completed',
    'PATCH: Waiting stage + stored input'].map((n) => [n, err, 'Unhandled error']),
  ['Unhandled error', 0, 'Build manual'],
  ['Slack: alert', err, 'PATCH: Manual stage + note'],            // alert failed: still move the ticket
  ['PATCH: Manual stage + note', err, 'Slack: manual PATCH failed'],
];

// ---- emit ------------------------------------------------------------------
const byName = Object.fromEntries(nodes.map((n) => [n.name, n]));
for (const [from, , to] of links) for (const n of [from, to]) if (!byName[n]) throw new Error(`Unknown node in links: ${n}`);

function emit(section, file) {
  const included = nodes.filter((n) => n.section <= section);
  const placeholders = new Map();
  const outNodes = included.map((n) => {
    const { section: s, errorFrom, at, ...rest } = n;
    const node = { ...rest, id: uuid(n.name), position: pos(at) };
    if (errorFrom <= section) node.onError = 'continueErrorOutput';
    return node;
  });
  const maxCol = Math.max(...included.map((n) => n.at[0]));   // placeholders sit just past the section's last column
  const connections = {};
  const connect = (from, index, to) => {
    connections[from] ??= { main: [] };
    while (connections[from].main.length <= index) connections[from].main.push([]);
    connections[from].main[index].push({ node: to, type: 'main', index: 0 });
  };
  for (const [from, out, to] of links) {
    const f = byName[from], t = byName[to];
    if (f.section > section) continue;
    let index = out;
    if (out === err) {
      if (f.errorFrom > section) continue;                    // error output not enabled yet
      index = f.type === 'n8n-nodes-base.if' ? 2 : f.type === 'n8n-nodes-base.switch' ? 4 : 1;
    }
    if (t.section > section) {                                // wire to a placeholder instead
      const pname = `Next section: ${to}`;
      if (!placeholders.has(pname)) placeholders.set(pname, { id: uuid(pname), name: pname, type: 'n8n-nodes-base.noOp', typeVersion: 1, position: pos([maxCol + 1, t.at[1] === 5 ? 2 : t.at[1]]), parameters: {} });
      connect(from, index, pname);
    } else connect(from, index, to);
  }
  const wf = { name: `${WORKFLOW_NAME}${section < 5 ? ` (${file})` : ''}`, nodes: [...outNodes, ...placeholders.values()], connections, settings: { executionOrder: 'v1' }, pinData: {} };
  writeFileSync(join(DIR, `${file}.json`), JSON.stringify(wf, null, 2));
  console.log(`${file}.json: ${outNodes.length} nodes, ${placeholders.size} placeholders`);
  return wf;
}

mkdirSync(DIR, { recursive: true });
let last;
for (const [s, f] of SECTIONS) last = emit(s, f);
writeFileSync(join(DIR, 'nous-mso-mobile-recommendation.json'), JSON.stringify(last, null, 2));
console.log('nous-mso-mobile-recommendation.json: complete workflow (same as 05)');
