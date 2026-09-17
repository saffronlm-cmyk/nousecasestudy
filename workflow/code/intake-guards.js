// Guards I0 to I5 from rules.md, in order. Reads the ticket just fetched (the source of truth),
// never the trigger payload. Emits decision.route: continue | manual | exit_slack | exit.
const ctx = $('Config').item.json;
const cfg = ctx.cfg;
const p = $json.properties || {};
const status = p.automation_status ?? null;
const stage = String(p.hs_pipeline_stage ?? '');
const subject = String(p.subject ?? '');
const st = cfg.stages;

const slack = (severity, title, message, shape) => ({ severity, title, message, context: { shape, stepFailed: 'Intake guards', ticketStage: stage } });
const manual = (shape, note, s = null) => ({ route: 'manual', shape, note: 'Routed to manual: ' + note, slack: s });
const exit = (shape, s = null) => ({ route: s ? 'exit_slack' : 'exit', shape, note: null, slack: s });

let decision;
if (!ctx.householdId || !ctx.userId) {
  decision = manual('I0', `${ctx.source} input is missing householdId or userId.`);
} else if (cfg.INTERRUPTED_STATUSES.includes(status)) {
  const what = status.startsWith('recommendation') ? 'recommendation' : 'message';
  decision = manual('I1a', `interrupted run, last status ${status}. Check whether the ${what} went out before re-running.`,
    slack('warning', 'Interrupted run', `${ctx.ticketId} found at ${status}. Routed to Manual.`, 'I1a'));
} else if (status !== null && status !== 'waiting') {
  const odd = status === 'completed' && stage === st.open;
  decision = exit('I1b', odd ? slack('info', 'Completed marker on open stage', `${ctx.ticketId} has automation_status=completed but is still in the open stage. No action taken.`, 'I1b') : null);
} else if (![st.open, st.waiting].includes(stage)) {
  decision = exit('I2');
} else if (String(p.hs_pipeline_id) !== cfg.PIPELINE_ID) {
  decision = manual('I3', `unexpected pipeline ${p.hs_pipeline_id}.`);
} else if (subject.includes(cfg.NO_SERVICE_MARKER)) {
  decision = exit('I4');
} else {
  const m = new RegExp(cfg.SUBJECT_REGEX).exec(subject);
  if (!m) {
    decision = manual('I5', 'subject pattern not recognised, confirm ticket type.');
  } else {
    const firstName = (m[1].match(/[A-Za-z][A-Za-z'-]*/) || [null])[0];
    const attempts = Number(p[cfg.ATTEMPTS_PROPERTY]) || 0;
    return { json: { ...ctx, ticket: p, serviceIndex: Number(m[2]), firstName, attempts, decision: { route: 'continue', shape: null, note: null, slack: null } } };
  }
}
return { json: { ...ctx, ticket: p, decision } };
