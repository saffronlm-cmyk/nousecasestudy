// Filter, rank, saving, failureCause, data-floor shadow and the decision note, exactly as in
// rules.md. Also precomputes every body the outcome branches will send, so the HTTP nodes
// downstream are plain and the execution trail shows what will be written before it is.
const ctx = $('Check payment').item.json;
const cfg = ctx.cfg;
const svc = ctx.service;
const feed = Array.isArray($json.deals) ? $json.deals : [];
const fetchError = $json.fetchError || null;
const pence = (x) => Math.round(Number(x) * 100);
const gbp = (p) => (p / 100).toFixed(2);
const isId = (d) => d.providerId === cfg.ID_MOBILE_PROVIDER_ID;

// Filter in order, counting what each step removed.
const s0 = feed.filter((d) => d && Number.isInteger(d.providerId)
  && Number.isFinite(Number(d.effective_line_rental)) && Number(d.effective_line_rental) > 0
  && Number.isFinite(Number(d.monthlyData)) && typeof d.coverageAtHouseholdLocation === 'string');
const s1 = s0.filter((d) => cfg.APPROVED_PROVIDER_IDS.includes(d.providerId));
const s2 = s1.filter((d) => d.providerId !== svc.currentProviderId);
const s3 = s2.filter((d) => cfg.COVERAGE_ACCEPTED.includes(d.coverageAtHouseholdLocation));
const s4 = s3.filter((d) => Number(d.monthlyData) >= svc.monthlyData);
const removed = { malformed: feed.length - s0.length, nonApproved: s0.length - s1.length, currentProvider: s1.length - s2.length, coverage: s2.length - s3.length, data: s3.length - s4.length };

// Rank: iD penalty on the sort key only, then data desc, then non-iD first, then deal id.
const rank = (arr) => arr
  .map((d) => ({ stickeeDealId: d.stickeeDealId, providerId: d.providerId, providerName: d.providerName,
    price: Number(d.effective_line_rental), monthlyData: Number(d.monthlyData), coverage: d.coverageAtHouseholdLocation,
    rankPence: pence(d.effective_line_rental) + (isId(d) ? cfg.ID_PENALTY_PENCE : 0) }))
  .sort((a, b) => a.rankPence - b.rankPence || b.monthlyData - a.monthlyData
    || (isId(a) ? 1 : 0) - (isId(b) ? 1 : 0) || String(a.stickeeDealId).localeCompare(String(b.stickeeDealId)));
const pool = rank(s4);
const best = pool[0] || null;
const shadow = rank(s3)[0] || null;           // same ranking with the data floor skipped
const savingOf = (d) => ctx.paymentPence - pence(d.price);

const shadowNote = shadow && (!best || shadow.stickeeDealId !== best.stickeeDealId)
  ? ` Ignoring data floor: ${shadow.providerName} ${shadow.monthlyData}GB £${shadow.price} would save £${gbp(savingOf(shadow))}.` : '';
const trail = `${feed.length} deals in feed, removed ${removed.malformed} malformed, ${removed.nonApproved} non-approved, ${removed.currentProvider} current provider, ${removed.coverage} coverage, ${removed.data} data.`;
const src = ` [${ctx.source}]`;
const slackCtx = (shape) => ({ shape, stepFailed: 'Evaluate deals', ticketStage: ctx.ticket.hs_pipeline_stage });

let decision;
const evaluation = { feedCount: feed.length, removed, poolCount: pool.length, pool: pool.slice(0, 5), best, shadow, fetchError, savingPence: null };

if (feed.length === 0) {
  const attempt = ctx.attempts + 1;
  const why = fetchError ? ` Deals fetch failed: ${fetchError}.` : '';
  if (attempt < cfg.MAX_WAITING_ATTEMPTS) {
    decision = { route: 'waiting', shape: 'W1', cause: null, attempt, note: `Attempt ${attempt} of ${cfg.MAX_WAITING_ATTEMPTS}: no eligible deals in feed.${why}${src}`, slack: null };
  } else {
    decision = { route: 'manual', shape: 'W2', cause: null, attempt, note: `Routed to manual: no deals in feed after ${cfg.MAX_WAITING_ATTEMPTS} attempts.${why}${src}`,
      slack: { severity: 'warning', title: 'Retry cap exhausted', message: `${ctx.ticketId}: empty deals feed on ${cfg.MAX_WAITING_ATTEMPTS} attempts. Routed to Manual.`, context: slackCtx('W2') } };
  }
} else if (s0.length === 0) {
  decision = { route: 'manual', shape: 'F0', cause: null, note: `Routed to manual: ${feed.length} deals in feed, none parseable. Sample: ${JSON.stringify(feed[0]).slice(0, 300)}${src}`,
    slack: { severity: 'warning', title: 'Deals feed unreadable', message: `${ctx.ticketId}: ${feed.length} deals in feed, none parseable.`, context: slackCtx('F0') } };
} else if (!best) {
  const cause = s2.length === 0 ? 'price' : s3.length === 0 ? 'coverage' : 'data';
  decision = { route: 'failure', shape: 'F1', cause, note: `Best eligible: none (cause: ${cause}). ${trail}${shadowNote}${src}`, slack: null };
} else {
  const savingPence = savingOf(best);
  evaluation.savingPence = savingPence;
  const summary = `${best.providerName} ${best.monthlyData}GB £${best.price}`;
  if (savingPence >= cfg.SAVING_FLOOR_PENCE) {
    decision = { route: 'success', shape: 'S1', cause: null, note: `Recommending ${summary}/mo, saves £${gbp(savingPence)}/mo. stickeeDealId: ${best.stickeeDealId}. ${trail}${shadowNote}${src}`, slack: null };
  } else {
    decision = { route: 'failure', shape: 'F2', cause: 'price', note: `Best eligible: ${summary}, saves £${gbp(savingPence)}, below £${gbp(cfg.SAVING_FLOOR_PENCE)} floor. ${trail}${shadowNote}${src}`, slack: null };
  }
}

const out = { ...ctx, evaluation, decision };
if (decision.route === 'waiting') {
  out.waitingPatch = { next_task_description: decision.note, automation_status: 'waiting', [cfg.ATTEMPTS_PROPERTY]: decision.attempt,
    automation_household_id: ctx.householdId, automation_user_id: ctx.userId, automation_test_mode: ctx.testMode, hs_pipeline_stage: cfg.stages.waiting };
}
if (decision.route === 'failure') {
  const greeting = ctx.firstName ? `Hi ${ctx.firstName}, it's Nous.` : "Hi, it's Nous.";
  out.whatsappMessage = greeting + '\n' + cfg.WHATSAPP[decision.cause].replace('{monthlyData}', String(svc.monthlyData));
  out.failurePatch = { next_task_description: decision.note, email_switch_failure_reason: cfg.FAILURE_REASONS.email, reporting_switch_failure_reason: cfg.FAILURE_REASONS.reporting };
}
if (decision.route === 'success') {
  out.recommendationBody = { ticketId: ctx.ticketId, householdId: ctx.householdId, userId: ctx.userId, mobileServiceId: svc.id, stickeeDealId: best.stickeeDealId, testMode: ctx.testMode };
}
return { json: out };
