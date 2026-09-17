// Convert a Claude Code session export (transcript.jsonl, from the app's Export or the export_transcript tool)
// into a readable markdown transcript. Run from the unzipped export directory:
//   node tools/export-transcript.mjs "<first line of the starting user message>" /path/to/out.md "Title"
// Omit the start marker to convert the whole session. Bearer token is redacted.
import fs from 'node:fs';

const [,, startMarker, outPath, title] = process.argv;
let lines = fs.readFileSync('transcript.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  .filter((l) => l.type === 'user' || l.type === 'assistant');
if (startMarker) {
  const i = lines.findIndex((l) => typeof l.message.content === 'string' && l.message.content.includes(startMarker));
  if (i < 0) throw new Error('start marker not found');
  lines = lines.slice(i);
}

const fence = (s, lang = '') => { const f = s.includes('```') ? '````' : '```'; return `${f}${lang}\n${s}\n${f}`; };
const strip = (s) => s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();

const out = [
  `# ${title || 'Nous case study transcript'}`, '',
  'Exported 17 September 2026 from the Claude Code session. Tool calls and results are included; model thinking is omitted. The bearer token has been redacted.', '',
];
let step = 0;

for (const l of lines) {
  const c = l.message.content;
  const ts = l.timestamp ? l.timestamp.slice(11, 19) : '';
  if (typeof c === 'string') { const t = strip(c); if (t) out.push(`## User (${ts})`, '', t, ''); continue; }
  for (const b of c) {
    if (b.type === 'text') {
      const t = strip(b.text); if (!t) continue;
      out.push(l.type === 'user' ? `## User (${ts})` : `## Claude (${ts})`, '', t, '');
    } else if (b.type === 'tool_use') {
      step++;
      const inp = { ...b.input };
      const parts = [`### Tool call ${step}: \`${b.name}\` (${ts})`];
      if (inp.description) { parts.push('', `_${inp.description}_`); delete inp.description; }
      if (typeof inp.command === 'string') { parts.push('', fence(inp.command, 'bash')); delete inp.command; }
      if (typeof inp.content === 'string') { parts.push('', `**File written: \`${inp.file_path}\`**`, '', fence(inp.content)); delete inp.content; delete inp.file_path; }
      if (Object.keys(inp).length) parts.push('', fence(JSON.stringify(inp, null, 2), 'json'));
      out.push(...parts, '');
    } else if (b.type === 'tool_result') {
      let t = typeof b.content === 'string' ? b.content : (b.content || []).map((x) => (x.type === 'text' ? x.text : `[${x.type}]`)).join('\n');
      t = strip(t);
      if (/^PDF file read/.test(t)) t = '(brief.pdf read: 7 pages, content not reproduced here)';
      if (t.length > 12000) t = t.slice(0, 12000) + `\n... [truncated, ${t.length} chars total]`;
      out.push(`**Result${b.is_error ? ' (error)' : ''}:**`, '', fence(t), '');
    }
  }
}

let md = out.join('\n').replace(/cs-saffron-[a-z0-9]+-2026/g, '<redacted>');
fs.writeFileSync(outPath || '/Users/saffron/Downloads/Nous/phase1.md', md);
console.log('written', md.length, 'chars,', step, 'tool calls');
