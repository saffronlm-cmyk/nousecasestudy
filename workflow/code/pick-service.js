// Guards D0 to D2. Verifies the household belongs to the user on the ticket input, then picks
// mobileServices[N-1] and checks its data allowance is usable.
const ctx = $('Intake guards').item.json;
const cx = $json;
const services = Array.isArray(cx.mobileServices) ? cx.mobileServices : [];
const N = ctx.serviceIndex;
const manual = (shape, note) => ({ json: { ...ctx, context: { id: cx.id, userId: cx.userId, serviceCount: services.length }, decision: { route: 'manual', shape, note: 'Routed to manual: ' + note, slack: null } } });

if (String(cx.userId) !== String(ctx.userId)) return manual('D0', `household ${ctx.householdId} belongs to ${cx.userId}, ticket input says ${ctx.userId}.`);
if (!(N >= 1 && N <= services.length)) return manual('D1', `Mobile #${N} out of range, ${services.length} services found.`);
const service = services[N - 1];
const data = Number(service.monthlyData);
if (service.monthlyData === null || service.monthlyData === undefined || !Number.isFinite(data)) return manual('D2', `monthlyData missing on ${service.id}.`);

return { json: { ...ctx,
  context: { id: cx.id, postcode: cx.postcode, userId: cx.userId, serviceCount: services.length },
  service: { ...service, monthlyData: data },
  decision: { route: 'continue', shape: null, note: null, slack: null } } };
