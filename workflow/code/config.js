// Config. Every threshold, ID and message the workflow uses lives here so ops can change
// behaviour without touching logic. Mirrors the config block in rules.md.
// Runs once per ticket, straight after the two trigger paths converge. Every later node reads
// the run's input with $('Config').item.json.
const cfg = {
  baseUrl: 'https://nous-case-study-saffron.vercel.app',

  SAVING_FLOOR_PENCE: 300,          // £3.00. Compared in pence, never in floats.
  ID_PENALTY_PENCE: 200,            // £2.00 added to iD Mobile for ranking only, never for the saving.
  APPROVED_PROVIDER_IDS: [9, 13, 18], // Talkmobile, Giffgaff, iD Mobile
  ID_MOBILE_PROVIDER_ID: 18,
  COVERAGE_ACCEPTED: ['LIKELY'],    // allow-list; anything else is excluded
  MAX_WAITING_ATTEMPTS: 3,          // third empty feed goes to Manual


  PIPELINE_ID: '228462820',
  stages: { open: '390658766', success: '446512118', failure: '409734350', manual: '440806104', waiting: '5060559097' },

  // Group 1 is the customer segment (for the first name), group 2 is the service index.
  SUBJECT_REGEX: '^MOB \\| (.+?) \\| Make recommendation \\| Mobile #(\\d+)',
  NO_SERVICE_MARKER: '#No service found',
  ATTEMPTS_PROPERTY: 'automation_attempts',
  INTERRUPTED_STATUSES: ['recommendation_pending', 'recommendation_sent', 'message_pending', 'message_sent'],

  EMAIL_REASONS: ["Mob - can't beat deal", 'Customer ineligible/can\'t process switch', 'Customer unresponsive', 'Customer rejects switch', 'N/A'],
  REPORTING_REASONS: ['INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL', 'INELIGIBLE_IN_CONTRACT', 'MOB_MANAGEMENT_SWITCHED_OFF', 'UNABLE_REQUEST_OUT_OF_SERVICE_PARAMS', 'OTHER'],
  FAILURE_REASONS: { email: "Mob - can't beat deal", reporting: 'INELIGIBLE_COULD_NOT_BEAT_CURRENT_DEAL' },

  // WhatsApp bodies by failureCause. The greeting line is added by the evaluation node so the
  // first-name fallback works. {monthlyData} is replaced with the service allowance.
  WHATSAPP: {
    price: [
      "We've just compared the SIM-only deals available at your address with what you're paying now.",
      "Nothing out there would save you enough to make a switch worth your while, so we're leaving your mobile as it is.",
      "If you'd like us to look again, or you've spotted a deal you'd like us to check, just reply here.",
    ].join('\n'),
    coverage: [
      "We've just looked at the SIM-only deals available at your address.",
      "The deals we found aren't expected to have good coverage at your postcode, so we're not going to move you onto something that might not work where you live.",
      "If you'd like us to look again, or you've spotted a deal you'd like us to check, just reply here.",
    ].join('\n'),
    data: [
      "We've just compared the SIM-only deals available at your address with your current plan.",
      "Nothing we found gives you at least your current {monthlyData}GB for less, and we didn't want to save you money by cutting your data.",
      "If you'd like us to look again, or you've spotted a deal you'd like us to check, just reply here.",
    ].join('\n'),
  },
};

return { json: { ...$json, cfg } };
