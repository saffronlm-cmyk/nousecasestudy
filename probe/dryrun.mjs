// Dry run of the Phase 2 rules against the Phase 1 dumps. No API calls.
import fs from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(dirname(fileURLToPath(import.meta.url)));
const CFG = { SAVING_FLOOR_PENCE: 300, ID_PENALTY_PENCE: 200, APPROVED: [9, 13, 18], MAX_WAITING_ATTEMPTS: 3, PIPELINE_ID: '228462820', OPEN: '390658766' };
const RX = /^MOB \| .+ \| Make recommendation \| Mobile #(\d+)/;
const pence = (x) => Math.round(x * 100);
for (let n = 1; n <= 24; n++) {
  const t = `TICKET-${String(n).padStart(3, '0')}`;
  const p = JSON.parse(fs.readFileSync(`${t}/ticket.json`)).body.properties;
  const cx = JSON.parse(fs.readFileSync(`${t}/context.json`)).body;
  let out;
  // intake
  const INTERRUPTED = ['recommendation_pending', 'recommendation_sent', 'message_pending', 'message_sent'];
  if (INTERRUPTED.includes(p.automation_status)) out = `MANUAL: interrupted run (${p.automation_status}), Slack warning`;
  else if (p.automation_status !== null && p.automation_status !== 'waiting') out = `EXIT (automation_status=${p.automation_status}${p.automation_status === 'completed' && p.hs_pipeline_stage === CFG.OPEN ? ', Slack info' : ''})`;
  else if (p.hs_pipeline_id !== CFG.PIPELINE_ID) out = 'MANUAL: unexpected pipeline';
  else if (/#No service found/.test(p.subject)) out = 'EXIT: no service found';
  else if (!RX.test(p.subject)) out = 'MANUAL: subject pattern';
  else {
    const N = Number(RX.exec(p.subject)[1]);
    const svc = cx.mobileServices[N - 1];
    if (!svc) out = `MANUAL: #${N} out of range`;
    else {
      const pay = JSON.parse(fs.readFileSync(`${t}/current-payment.${svc.id}.json`));
      const amt = pay.body && pay.body.amountInGbpPounds;
      if (svc.monthlyData === null || svc.monthlyData === undefined) out = 'MANUAL: monthlyData null';
      else if (pay.status === 404) out = 'MANUAL: payment 404';
      else if (amt === null) out = 'MANUAL: payment null';
      else if (amt === 0) out = 'MANUAL: payment £0';
      else {
        const files = fs.readdirSync(t).filter((f) => /^deals\.attempt\d+\.json$/.test(f)).sort();
        const recs = files.map((f) => JSON.parse(fs.readFileSync(`${t}/${f}`)));
        const first = recs[0];
        const ok = recs.find((r) => r.status === 200);
        const deals = ok ? ok.body.deals : [];
        const note = first.status !== 200 ? ` [first attempt HTTP ${first.status}, in-node retry]` : '';
        if (deals.length === 0) out = `WAITING x${CFG.MAX_WAITING_ATTEMPTS} -> MANUAL (empty feed)`;
        else {
          const s0 = deals.filter((d) => Number.isInteger(d.providerId) && Number.isFinite(Number(d.effective_line_rental)) && Number(d.effective_line_rental) > 0 && Number.isFinite(Number(d.monthlyData)) && typeof d.coverageAtHouseholdLocation === 'string');
          const s1 = s0.filter((d) => CFG.APPROVED.includes(d.providerId));
          const s2 = s1.filter((d) => d.providerId !== svc.currentProviderId);
          const s3 = s2.filter((d) => d.coverageAtHouseholdLocation === 'LIKELY');
          const s4 = s3.filter((d) => d.monthlyData >= svc.monthlyData);
          const cause = s2.length === 0 ? 'price' : s3.length === 0 ? 'coverage' : s4.length === 0 ? 'data' : 'price';
          const rankPool = (arr) => arr
            .map((d) => ({ ...d, rank: pence(d.effective_line_rental) + (d.providerId === 18 ? CFG.ID_PENALTY_PENCE : 0) }))
            .sort((a, b) => a.rank - b.rank || b.monthlyData - a.monthlyData || (a.providerId === 18) - (b.providerId === 18) || a.stickeeDealId.localeCompare(b.stickeeDealId));
          const pool = rankPool(s4);
          const shadow = rankPool(s3)[0];
          const shadowNote = shadow && (!pool[0] || shadow.stickeeDealId !== pool[0].stickeeDealId) ? ` [ignoring data floor: ${shadow.providerName} ${shadow.monthlyData}GB £${shadow.effective_line_rental} would save £${((pence(amt) - pence(shadow.effective_line_rental)) / 100).toFixed(2)}]` : '';
          if (s0.length === 0) out = `MANUAL: feed unreadable (${deals.length} deals, none parseable)`;
          else if (pool.length === 0) out = `FAILURE can't beat, ${cause} message (empty pool; ${deals.length} in feed, removed ${deals.length - s0.length} malformed, ${s0.length - s1.length} non-approved, ${s1.length - s2.length} current, ${s2.length - s3.length} coverage, ${s3.length - s4.length} data)${note}${shadowNote}`;
          else {
            const b = pool[0]; const saving = pence(amt) - pence(b.effective_line_rental);
            out = (saving >= CFG.SAVING_FLOOR_PENCE ? 'SUCCESS' : 'FAILURE can\'t beat, price message') + ` ${b.providerName} ${b.monthlyData}GB £${b.effective_line_rental} saves £${(saving / 100).toFixed(2)}` + (pool.length > 1 ? ` (runner-up ${pool[1].providerName} £${pool[1].effective_line_rental})` : '') + note + shadowNote;
          }
        }
      }
    }
  }
  console.log(t.padEnd(11), out);
}
