import { mkdir, readFile, writeFile, cp, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const publicDir = path.join(root, 'public');
const model = 'Xenova/bert-base-NER';
const infoResponse = await fetch(`https://huggingface.co/api/models/${model}`);
if (!infoResponse.ok) throw new Error('Model metadata unavailable');
const info = await infoResponse.json();
const pinnedPath = path.join(root, 'asset-manifest.json');
let existing;
try { existing = JSON.parse(await readFile(pinnedPath, 'utf8')); } catch { /* First installation */ }
const revision = existing?.model_revision ?? info.sha;
const files = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'vocab.txt', 'onnx/model_quantized.onnx'];
const manifest = { model, model_revision: revision, model_license: 'MIT', files: [] };
async function download(url, relative) {
  const target = path.join(publicDir, relative); await mkdir(path.dirname(target), { recursive: true });
  let bytes;
  const expected = existing?.files.find(file => file.path === relative);
  try { const cached = await readFile(target); if (expected && createHash('sha256').update(cached).digest('hex') === expected.sha256) bytes = cached; } catch { /* Download required */ }
  if (!bytes) {
    process.stdout.write(`Downloading ${relative}\n`);
    const response = await fetch(url); if (!response.ok) throw new Error(`Asset failed: ${relative} (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer()); await writeFile(target, bytes);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (expected && expected.sha256 !== sha256) throw new Error(`Asset digest changed: ${relative}`);
  manifest.files.push({ path: relative, bytes: bytes.length, sha256, source: url });
}
for (const file of files) await download(`https://huggingface.co/${model}/resolve/${revision}/${file}`, `models/${model}/${file}`);
const wasmDir = path.join(root, 'node_modules/onnxruntime-web/dist');
await mkdir(path.join(publicDir, 'runtime'), { recursive: true });
for (const file of await readdir(wasmDir)) if (/^ort-wasm.*\.(wasm|mjs)$/.test(file)) await cp(path.join(wasmDir, file), path.join(publicDir, 'runtime', file));
await mkdir(path.join(publicDir, 'ocr/core'), { recursive: true });
await cp(path.join(root, 'node_modules/tesseract.js/dist/worker.min.js'), path.join(publicDir, 'ocr/worker.min.js'));
const core = path.join(root, 'node_modules/tesseract.js-core');
for (const file of await readdir(core)) if (/\.wasm(?:\.js)?$/.test(file)) await cp(path.join(core, file), path.join(publicDir, 'ocr/core', file));
for (const lang of ['eng', 'swa']) await download(`https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}@1.0.0/4.0.0_best_int/${lang}.traineddata.gz`, `ocr/lang/${lang}.traineddata.gz`);
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) await cp(path.join(root, 'node_modules/pdfjs-dist', folder), path.join(publicDir, 'pdfjs', folder), { recursive: true });
await mkdir(path.join(publicDir, 'fixtures'), { recursive: true });
for (const file of ['fictional-source.pdf', 'fictional-screenshot.png']) await cp(path.join(root, '../fixtures', file), path.join(publicDir, 'fixtures', file));
await writeFile(pinnedPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('Local model, WASM and OCR assets prepared. Runtime requires no cloud inference.');
