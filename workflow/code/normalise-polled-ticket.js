// A Waiting ticket found by the poll. Rebuild the run input from the properties the first pass
// stored on the ticket, because the ticket itself carries no household or user ID. Missing
// stored properties are caught by guard I0.
const p = $json.properties || {};
return { json: {
  ticketId: p.id || $json.id,
  householdId: p.automation_household_id ?? null,
  userId: p.automation_user_id ?? null,
  testMode: p.automation_test_mode === true || p.automation_test_mode === 'true',
  source: 'schedule',
} };
