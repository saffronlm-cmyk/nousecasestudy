// Any node's error output lands here. Turns it into a Manual decision with a Slack error so
// nothing fails silently. $prevNode names the node that failed.
let ctx;
try { ctx = $('Config').item.json; } catch (e) { ctx = $json; }
let failedNode = 'unknown';
try { failedNode = $prevNode.name; } catch (e) {}
const err = $json.error || {};
const msg = err.message || err.description || JSON.stringify(err).slice(0, 300);
return { json: { ...ctx, decision: { route: 'manual', shape: 'ERR',
  note: `Routed to manual: unhandled error at "${failedNode}": ${msg}`,
  slack: { severity: 'error', title: 'Unhandled error', message: `${ctx.ticketId || 'unknown ticket'}: "${failedNode}" failed: ${msg}`, context: { shape: 'ERR', stepFailed: failedNode, ticketStage: ctx.ticket ? ctx.ticket.hs_pipeline_stage : null } } } } };
