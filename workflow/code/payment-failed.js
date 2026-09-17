// D3. The current-payment call failed after retries (404 or persistent 5xx). Manual, no Slack.
const ctx = $('Pick service').item.json;
const err = $json.error || {};
const msg = err.message || err.description || JSON.stringify(err).slice(0, 200);
return { json: { ...ctx, decision: { route: 'manual', shape: 'D3', note: `Routed to manual: payment endpoint failed for ${ctx.service.id} after retries: ${msg}`, slack: null } } };
