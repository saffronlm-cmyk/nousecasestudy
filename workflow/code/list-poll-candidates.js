// Schedule path, mock only. The mock has no "search tickets by stage" endpoint, so this node
// emits one item per ticket ID to check. Production: replace this single node with a HubSpot
// search on hs_pipeline_stage = Waiting. These three values are duplicated from Config because
// this node runs before the paths converge; keep them in step.
const poll = {
  baseUrl: 'https://nous-case-study-saffron.vercel.app',
  waitingStageId: '5060559097',
  ticketIds: ['TICKET-001', 'TICKET-002', 'TICKET-003', 'TICKET-004', 'TICKET-005', 'TICKET-006',
    'TICKET-007', 'TICKET-008', 'TICKET-009', 'TICKET-010', 'TICKET-011'],
};
return poll.ticketIds.map((ticketId) => ({ json: { ticketId, poll } }));
