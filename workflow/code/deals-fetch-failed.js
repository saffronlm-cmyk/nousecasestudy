// GET /deals failed after retries. Treated as an empty feed so the Waiting logic applies.
const err = $json.error || {};
return { json: { deals: [], fetchError: err.message || err.description || JSON.stringify(err).slice(0, 200) } };
