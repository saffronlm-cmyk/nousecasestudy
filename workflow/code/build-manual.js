// Every Manual route lands here with a decision already attached. Builds the single PATCH that
// writes the note, sets automation_status=manual and moves the stage. The IF that follows fires
// Slack first when the decision carries one, so the alert goes out even if the PATCH then fails.
const j = $json;
return { json: { ...j, manualPatch: {
  next_task_description: (j.decision && j.decision.note) || 'Routed to manual: no note recorded.',
  automation_status: 'manual',
  hs_pipeline_stage: j.cfg.stages.manual,
  // W2 arrives with the attempt that hit the cap; record it so the property matches the note.
  ...(j.decision && j.decision.attempt ? { [j.cfg.ATTEMPTS_PROPERTY]: j.decision.attempt } : {}),
} } };
