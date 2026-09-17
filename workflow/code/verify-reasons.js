// Read-back check after writing both failure reasons. Both must be present and in the allowed
// lists before the stage moves. This is the guard the process doc's post-mortem asks for.
const ctx = $('Evaluate deals').item.json;
const cfg = ctx.cfg;
const p = $json.properties || {};
const email = p.email_switch_failure_reason;
const reporting = p.reporting_switch_failure_reason;
const ok = cfg.EMAIL_REASONS.includes(email) && cfg.REPORTING_REASONS.includes(reporting);

if (ok) return { json: { ...ctx, verified: { email, reporting }, decision: { ...ctx.decision, route: 'failure_verified' } } };
return { json: { ...ctx, decision: { route: 'manual', shape: 'FV',
  note: `Routed to manual: failure reason validation failed. Read back email=${JSON.stringify(email)} reporting=${JSON.stringify(reporting)}. Stage not moved.`,
  slack: { severity: 'error', title: 'Failure reason validation failed', message: `${ctx.ticketId}: reasons did not read back as written. Stage not moved, routed to Manual.`, context: { shape: ctx.decision.shape, stepFailed: 'Verify reasons', ticketStage: ctx.ticket.hs_pipeline_stage } } } } };
