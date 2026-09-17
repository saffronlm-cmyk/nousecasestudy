// Guards D4 and D5. A 200 with a null or zero amount is a data problem, not a price.
const ctx = $('Pick service').item.json;
const amt = $json.amountInGbpPounds;
const manual = (shape, note) => ({ json: { ...ctx, decision: { route: 'manual', shape, note: 'Routed to manual: ' + note, slack: null } } });

if (amt === null || amt === undefined) return manual('D4', `payment null on ${ctx.service.id}.`);
const n = Number(amt);
if (!Number.isFinite(n)) return manual('D4', `payment not numeric on ${ctx.service.id}: ${JSON.stringify(amt)}.`);
if (n === 0) return manual('D5', `payment is £0 on ${ctx.service.id}, possible data error.`);

return { json: { ...ctx, paymentGbp: n, paymentPence: Math.round(n * 100), decision: { route: 'continue', shape: null, note: null, slack: null } } };
