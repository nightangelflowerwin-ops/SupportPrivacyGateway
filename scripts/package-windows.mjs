import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.resolve(process.argv[2] ?? path.join(root, '../SupportPrivacyGateway-Windows'));
await mkdir(destination, { recursive: true });
await cp(path.join(root, 'native/target/release/support-privacy-native.exe'), path.join(destination, 'support-privacy-native.exe'));
await cp(path.join(root, 'browser/dist'), path.join(destination, 'web'), { recursive: true });
for (const name of ['LICENSE', 'NOTICE']) await cp(path.join(root, name), path.join(destination, name));
await cp(path.join(root, 'browser/asset-manifest.json'), path.join(destination, 'asset-manifest.json'));
await writeFile(path.join(destination, 'Start.cmd'), '@echo off\r\ncd /d "%~dp0"\r\necho Open http://127.0.0.1:8766 in Brave. Close this window to stop.\r\nsupport-privacy-native.exe serve --port 8766\r\npause\r\n');
await writeFile(path.join(destination, 'README.txt'), 'SupportPrivacyGateway Windows x64 prototype\r\n\r\nExtract all files, run Start.cmd, then open http://127.0.0.1:8766 in Brave.\r\nNo Node, Python, Rust, API key or internet connection is needed to run this bundle.\r\nClose the launcher to stop the server. It binds to this device only.\r\nUse fictional data and review every page/span before exporting.\r\nThe BERT model is English; regional rules are not a trained Swahili detector.\r\nPDF exports contain new page images and lose search/accessibility.\r\nThis executable is not code-signed. Source: https://github.com/nightangelflowerwin-ops/SupportPrivacyGateway\r\nUpstream gateway concept: Othmane Menkor / Othocs.\r\n');

// Preserve registry package copyright and license files alongside redistributed bundles.
const licenses = path.join(destination, 'third-party-licenses'); await mkdir(licenses, { recursive: true });
const modules = path.join(root, 'browser/node_modules');
async function collect(directory, packageName) {
  let names; try { names = await readdir(directory); } catch { return; }
  for (const name of names) if (/^(license|licence|copying|notice)(\.|$)/i.test(name)) {
    try { const contents = await readFile(path.join(directory, name)); await writeFile(path.join(licenses, `${packageName.replaceAll('/', '__')}--${name}`), contents); } catch { /* Directory, not a license file. */ }
  }
}
for (const entry of await readdir(modules)) {
  if (entry.startsWith('@')) for (const child of await readdir(path.join(modules, entry))) await collect(path.join(modules, entry, child), `${entry}/${child}`);
  else if (!entry.startsWith('.')) await collect(path.join(modules, entry), entry);
}
await writeFile(path.join(licenses, 'model-and-ocr.txt'), 'BERT NER: dslim/bert-base-NER, converted by Xenova; MIT. Revision and original download URLs in asset-manifest.json.\nOCR: Tesseract.js and tesseract.js-data, Apache-2.0. PDF.js: Apache-2.0.\n');
const sums = [];
async function hashes(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await hashes(full);
    else if (entry.name !== 'SHA256SUMS.txt') sums.push(`${createHash('sha256').update(await readFile(full)).digest('hex')}  ${path.relative(destination, full).replaceAll('\\', '/')}`);
  }
}
await hashes(destination); await writeFile(path.join(destination, 'SHA256SUMS.txt'), sums.sort().join('\n') + '\n');
console.log(`Prepared Windows bundle: ${destination} (${sums.length} files)`);
