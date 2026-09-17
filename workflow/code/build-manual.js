// Every Manual route lands here with a decision already attached. Builds the single PATCH that
// writes the note, sets automation_status=manual and moves the stage. The IF that follows fires
// Slack first when the decision carries one, so the alert goes out even if the PATCH then fails.
// This node is deliberately not wired to Unhandled error (see decisions.md, "would loop"), so it
// cannot rely on cfg always being present: Unhandled error's own fallback path (paired-item
// resolution to Config failing) can hand it an item with no cfg at all. Falling back to the known
// Manual stage ID here, rather than throwing, is what keeps that edge case from being the one
// place the workflow dies silently with no ticket write and no Slack alert.
const j = $json;
const manualStageId = (j.cfg && j.cfg.stages && j.cfg.stages.manual) || '440806104';
const attemptsProperty = (j.cfg && j.cfg.ATTEMPTS_PROPERTY) || 'automation_attempts';
const cfgMissingNote = j.cfg ? '' : ' [cfg missing on this item; stage ID hardcoded as a fallback, check Unhandled error upstream]';
return { json: { ...j, manualPatch: {
  next_task_description: ((j.decision && j.decision.note) || 'Routed to manual: no note recorded.') + cfgMissingNote,
  automation_status: 'manual',
  hs_pipeline_stage: manualStageId,
  // W2 arrives with the attempt that hit the cap; record it so the property matches the note.
  ...(j.decision && j.decision.attempt ? { [attemptsProperty]: j.decision.attempt } : {}),
} } };
