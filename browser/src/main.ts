import './style.css';
import { detectRules, union, redact, SessionVault, type Span, type Action } from './core';
import { detectModel, disposeModel } from './model';
import { importDocument, exportDocument, clearDocument, paintProtected, disposeOCR, type LocalDocument } from './documents';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id)! as T;
const ticket = $<HTMLTextAreaElement>('ticket'), engine = $<HTMLSelectElement>('engine');
const example = ticket.value, vault = new SessionVault();
let ready = vault.reset(), analyzed = false, busy = false, rendering = false, epoch = 0, documentRevision = 0;
let spans: (Span & { selected: boolean })[] = [], source = '', doc: LocalDocument | undefined, pageIndex = 0;
let nativeSession = '', nativeConversation = '', nativeUsed = false;
function status(message: string) { $('status').textContent = message; }
function error(message: string) { $('error').textContent = message; }
const exportLink = document.createElement('a'); exportLink.id = 'prepared-download'; exportLink.className = 'secondary'; exportLink.hidden = true; $('status').after(exportLink);
function discardExport() { exportLink.removeAttribute('href'); exportLink.hidden = true; }
async function save(blob: Blob, filename: string) {
  discardExport();
  const version = epoch, docVersion = documentRevision;
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Export preparation failed')); reader.readAsDataURL(blob);
  });
  if (version !== epoch || docVersion !== documentRevision) return;
  exportLink.href = data; exportLink.download = filename;
  exportLink.textContent = `Download ${filename}`; exportLink.hidden = false;
}
function exportsEnabled() {
  const enabled = analyzed && !busy && !rendering && $<HTMLInputElement>('text-reviewed').checked;
  $<HTMLButtonElement>('copy').disabled = !enabled; $<HTMLButtonElement>('download-text').disabled = !enabled;
}
function invalidate() {
  discardExport();
  epoch++; analyzed = false; rendering = false; spans = []; source = ''; nativeConversation = '';
  $<HTMLInputElement>('text-reviewed').checked = false; $<HTMLInputElement>('text-reviewed').disabled = true;
  $('protected').textContent = 'Analyze the current message before export.'; $('spans').replaceChildren();
  $<HTMLButtonElement>('add-span').disabled = true; exportsEnabled();
}
async function nativeRequest(path: string, body: object) {
  if (!nativeSession) {
    const response = await fetch('/native/session');
    if (!response.ok) throw new Error('Native gateway unavailable. Start the Rust launcher or select a browser engine.');
    nativeSession = (await response.json()).session;
  }
  const response = await fetch(`/native/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Native-Session': nativeSession }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('Native operation failed. No result exported.');
  return response.json();
}
async function detect(text: string): Promise<Span[]> {
  const mode = engine.value;
  if (mode === 'native') return (await nativeRequest('redact', { text, action: 'mask' })).entities;
  return union([...detectRules(text), ...(mode === 'contextual' ? await detectModel(text, status) : [])], text.length);
}
async function preview() {
  discardExport();
  rendering = true; $<HTMLInputElement>('text-reviewed').checked = false; $<HTMLInputElement>('text-reviewed').disabled = true; exportsEnabled();
  const version = ++epoch;
  try {
    const output = await redact(source, spans.filter(s => s.selected), $<HTMLSelectElement>('action').value as Action, vault);
    if (version !== epoch) return;
    $('protected').textContent = output;
    $('counts').textContent = `${spans.filter(s => s.selected).length} protected spans. Export requires your review.`;
    $<HTMLInputElement>('text-reviewed').disabled = false;
  } finally { if (version === epoch) { rendering = false; exportsEnabled(); } }
}
function drawSpans() {
  $('spans').replaceChildren();
  spans.forEach((span, index) => {
    const row = document.createElement('label'); row.className = 'span-row';
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = span.selected;
    const value = document.createElement('span'); value.textContent = `${span.label}: ${source.slice(span.start, span.end)}`;
    const note = document.createElement('small'); note.textContent = `${span.source} · characters ${span.start}-${span.end}`; value.append(note);
    check.addEventListener('change', () => { spans[index].selected = check.checked; preview().catch(e => error(e.message)); });
    row.append(check, value); $('spans').append(row);
  });
  if (!spans.length) $('spans').textContent = 'No spans detected. Select any missed information and add it manually.';
}
ticket.addEventListener('input', invalidate);
engine.addEventListener('change', () => { invalidate(); clearDocument(doc); doc = undefined; renderDocument(); status(engine.value === 'native' ? 'Native mode sends text only to the Rust server on this device.' : 'Browser mode keeps text inside this tab.'); });
$('example').addEventListener('click', () => { ticket.value = example; invalidate(); });
$('analyze').addEventListener('click', async () => {
  if (busy) return;
  invalidate(); const version = epoch, text = ticket.value;
  if (!text.trim() || text.length > 20000) { error('Enter 1 to 20,000 characters.'); return; }
  busy = true; $<HTMLButtonElement>('analyze').disabled = true; error(''); status('Analyzing on this device...');
  try {
    await ready; const found = await detect(text);
    if (version !== epoch) return;
    source = text; spans = found.map(s => ({ ...s, selected: true })); analyzed = true; nativeUsed = engine.value === 'native';
    drawSpans(); await preview(); $<HTMLInputElement>('text-reviewed').disabled = false; $<HTMLButtonElement>('add-span').disabled = false;
    status(nativeUsed ? 'Native Rust analysis complete. Browser session handles reviewed replacements.' : 'Analysis complete inside this tab. Review the spans before exporting.');
  } catch (e) { error((e as Error).message); }
  finally { busy = false; $<HTMLButtonElement>('analyze').disabled = false; exportsEnabled(); }
});
$('add-span').addEventListener('click', () => {
  if (!analyzed || ticket.value !== source) return;
  const start = ticket.selectionStart, end = ticket.selectionEnd;
  if (end <= start) { error('Select the missed text in the original message first.'); return; }
  spans = union([...spans.filter(s => s.selected), { start, end, label: $<HTMLSelectElement>('manual-label').value, source: 'manual-review' }], source.length).map(s => ({ ...s, selected: true }));
  drawSpans(); preview().catch(e => error(e.message)); error('');
});
$('action').addEventListener('change', () => { if (analyzed) preview().catch(e => error(e.message)); });
$('text-reviewed').addEventListener('change', exportsEnabled);
$('copy').addEventListener('click', async () => { if (!analyzed || busy || rendering || !$<HTMLInputElement>('text-reviewed').checked) return; try { await navigator.clipboard.writeText($('protected').textContent ?? ''); status('Protected text copied.'); } catch { error('Clipboard unavailable. Use Export text.'); } });
$('download-text').addEventListener('click', () => { if (analyzed && !busy && !rendering && $<HTMLInputElement>('text-reviewed').checked) save(new Blob([$('protected').textContent ?? ''], { type: 'text/plain;charset=utf-8' }), 'protected-support.txt'); });
$('restore').addEventListener('click', async () => { try { await ready; $('restored').textContent = await vault.restore($<HTMLTextAreaElement>('reply').value); error(''); } catch (e) { $('restored').textContent = ''; error((e as Error).message); } });

for (const name of ['text', 'document']) $(`${name}-tab`).addEventListener('click', () => {
  for (const candidate of ['text', 'document']) { $(`${candidate}-tab`).setAttribute('aria-selected', String(candidate === name)); $(`${candidate}-panel`).hidden = candidate !== name; }
});
function renderDocument() {
  discardExport();
  documentRevision++;
  const page = doc?.pages[pageIndex], canvas = $<HTMLCanvasElement>('document-canvas');
  $('regions').replaceChildren(); $<HTMLInputElement>('page-reviewed').disabled = !page;
  $<HTMLInputElement>('page-reviewed').checked = page?.reviewed ?? false;
  $<HTMLButtonElement>('previous').disabled = !doc || pageIndex === 0;
  $<HTMLButtonElement>('next').disabled = !doc || pageIndex >= doc.pages.length - 1;
  $<HTMLButtonElement>('export-document').disabled = busy || !doc || doc.pages.some(p => !p.reviewed);
  $<HTMLButtonElement>('undo-box').disabled = !page?.regions.some(r => r.source === 'manual-review');
  $('page-count').textContent = doc ? `Page ${pageIndex + 1} of ${doc.pages.length}` : 'No document loaded';
  $('ocr-text').textContent = page?.text ?? '';
  if (!page) { canvas.width = 0; canvas.height = 0; return; }
  canvas.width = page.canvas.width; canvas.height = page.canvas.height; const ctx = canvas.getContext('2d')!;
  if ($<HTMLInputElement>('show-original').checked) {
    ctx.drawImage(page.canvas, 0, 0); ctx.strokeStyle = '#d12e36'; ctx.lineWidth = 3;
    for (const region of page.regions) if (region.selected) ctx.strokeRect(region.x - 3, region.y - 3, region.width + 6, region.height + 6);
  } else ctx.drawImage(paintProtected(page), 0, 0);
  page.regions.forEach((region, index) => {
    const row = document.createElement('label'); row.className = 'span-row';
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = region.selected;
    const label = document.createElement('span'); label.textContent = `${region.label} · rectangle ${index + 1}`;
    const detail = document.createElement('small'); detail.textContent = region.source; label.append(detail);
    check.addEventListener('change', () => { region.selected = check.checked; page.reviewed = false; renderDocument(); }); row.append(check, label); $('regions').append(row);
  });
  if (!page.regions.length) $('regions').textContent = 'No automatic regions found. Inspect the original and drag over missed details.';
}
async function loadFile(file: File) {
  if (busy) return;
  clearDocument(doc); doc = undefined; pageIndex = 0; busy = true; error(''); renderDocument();
  const version = ++epoch;
  try { const imported = await importDocument(file, engine.value === 'rules' ? null : detect, status); if (version !== epoch) { clearDocument(imported); return; } doc = imported; status('Local OCR complete. Review every page and add missed rectangles.'); }
  catch (e) { error((e as Error).message); }
  finally { busy = false; renderDocument(); $<HTMLInputElement>('file').value = ''; }
}
$('file').addEventListener('change', () => {
  const file = $<HTMLInputElement>('file').files?.[0]; if (file) void loadFile(file);
});
const samples = document.createElement('div'); samples.className = 'actions';
for (const [name, filename, type] of [
  ['Load fictional two-page PDF', 'fictional-source.pdf', 'application/pdf'],
  ['Load fictional screenshot', 'fictional-screenshot.png', 'image/png'],
]) {
  const button = document.createElement('button'); button.className = 'secondary'; button.textContent = name;
  button.addEventListener('click', async () => {
    if (busy) return;
    try { const response = await fetch(`/fixtures/${filename}`); if (!response.ok) throw new Error('Fictional sample missing. Run the asset preparation step.'); await loadFile(new File([await response.blob()], filename, { type })); }
    catch (e) { error((e as Error).message); }
  }); samples.append(button);
}
$('file').after(samples);
$('previous').addEventListener('click', () => { if (pageIndex > 0) { pageIndex--; renderDocument(); } });
$('next').addEventListener('click', () => { if (doc && pageIndex < doc.pages.length - 1) { pageIndex++; renderDocument(); } });
$('show-original').addEventListener('change', renderDocument);
$('page-reviewed').addEventListener('change', () => { if (doc) { doc.pages[pageIndex].reviewed = $<HTMLInputElement>('page-reviewed').checked; renderDocument(); } });
$('undo-box').addEventListener('click', () => { const page = doc?.pages[pageIndex]; if (!page) return; const index = page.regions.findLastIndex(r => r.source === 'manual-review'); if (index >= 0) page.regions.splice(index, 1); page.reviewed = false; renderDocument(); });
$('export-document').addEventListener('click', async () => { if (!doc || busy) return; try { const version = documentRevision; const blob = await exportDocument(doc); if (version !== documentRevision) throw new Error('Document changed during export. Review it again.'); await save(blob, doc.kind === 'pdf' ? 'protected-document.pdf' : 'protected-image.png'); status('Protected file prepared. Click the download link above to save it. Source text streams and metadata were not copied.'); } catch (e) { error((e as Error).message); } });
let drag: { x: number; y: number } | undefined;
const docCanvas = $<HTMLCanvasElement>('document-canvas');
function point(event: PointerEvent) { const r = docCanvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(docCanvas.width, (event.clientX - r.left) * docCanvas.width / r.width)), y: Math.max(0, Math.min(docCanvas.height, (event.clientY - r.top) * docCanvas.height / r.height)) }; }
docCanvas.addEventListener('pointerdown', event => { if (doc && !busy) { drag = point(event); docCanvas.setPointerCapture(event.pointerId); } });
docCanvas.addEventListener('pointerup', event => {
  const page = doc?.pages[pageIndex]; if (!drag || !page) return; const end = point(event);
  const box = { x: Math.min(drag.x, end.x), y: Math.min(drag.y, end.y), width: Math.abs(end.x - drag.x), height: Math.abs(end.y - drag.y) }; drag = undefined;
  if (box.width < 3 || box.height < 3) return;
  page.regions.push({ ...box, label: 'MANUAL', selected: true, source: 'manual-review' }); page.reviewed = false; renderDocument();
});
docCanvas.addEventListener('pointercancel', () => { drag = undefined; });
$('clear').addEventListener('click', async () => {
  invalidate(); ticket.value = ''; $<HTMLTextAreaElement>('reply').value = ''; $('restored').textContent = '';
  clearDocument(doc); doc = undefined; renderDocument(); disposeModel(); await disposeOCR(); ready = vault.reset(); await ready;
  nativeSession = ''; nativeConversation = ''; nativeUsed = false; error(''); status('Session cleared. Local mappings and documents discarded.');
});
setInterval(() => { if (analyzed) vault.hash('HEALTH', '').catch(() => { invalidate(); error('Session expired. Clear the session before continuing.'); }); }, 60000);
window.addEventListener('pagehide', () => { disposeModel(); void disposeOCR(); clearDocument(doc); });
