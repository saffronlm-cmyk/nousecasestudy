// Webhook path. Pull the four fields the run needs out of the webhook body. Nothing else from
// the payload is trusted; the ticket is re-read from the API as the source of truth.
const b = $json.body || {};
return { json: {
  ticketId: b.ticketId ?? null,
  householdId: b.householdId ?? null,
  userId: b.userId ?? null,
  testMode: b.testMode === true || b.testMode === 'true',
  source: 'webhook',
} };
