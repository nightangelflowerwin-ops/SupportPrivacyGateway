import { performance } from 'node:perf_hooks';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { detectRules } = await vite.ssrLoadModule('/src/core.ts');
  const input = 'Jina langu ni Amina Wanjiku. Mail amina@example.com. Simu +254 712 345 678. KRA PIN A123456789Z. Card 4111 1111 1111 1111.';
  detectRules(input); const timings = [];
  for (let i = 0; i < 1000; i++) { const start = performance.now(); detectRules(input); timings.push(performance.now() - start); }
  timings.sort((a,b) => a-b);
  const fixtures = JSON.parse(await readFile('../fixtures/regional.json', 'utf8'));
  let goldChars = 0, leaked = 0, masked = 0, wrong = 0;
  const rows = fixtures.map(f => {
    const predicted = detectRules(f.text), gold = new Set(), pred = new Set();
    for (const span of f.spans) for (let i=span.start;i<span.end;i++) gold.add(i);
    for (const span of predicted) for (let i=span.start;i<span.end;i++) pred.add(i);
    for (const i of gold) { goldChars++; if(!pred.has(i)) leaked++; }
    for (const i of pred) { masked++; if(!gold.has(i)) wrong++; }
    return { id:f.id, language:f.language, gold_spans:f.spans.length, predicted_spans:predicted.length, leaked_chars:[...gold].filter(i=>!pred.has(i)).length };
  });
  const report = { engine:'typescript-regional-rules', iterations:1000, p50_ms:timings[500], p95_ms:timings[950], fixture_chars:input.length, corpus:{ examples:fixtures.length, pii_character_leakage:goldChars?leaked/goldChars:0, over_redaction:masked?wrong/masked:0, rows }, limitations:'Synthetic development fixtures, not a held-out accuracy benchmark. JavaScript includes libphonenumber; native Rust phone matching is format-based. Timings are not a like-for-like language speed comparison.' };
  await mkdir('../work/benchmarks', {recursive:true}); await writeFile('../work/benchmarks/typescript.json',JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
} finally { await vite.close(); }
