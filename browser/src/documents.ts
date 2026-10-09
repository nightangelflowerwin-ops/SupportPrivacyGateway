import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';
import { createWorker, type Worker as OCRWorker } from 'tesseract.js';
import { detectRules, union, type Span } from './core';

GlobalWorkerOptions.workerSrc = pdfWorker;
export interface Box { x: number; y: number; width: number; height: number }
export interface Region extends Box { label: string; selected: boolean; source: string }
export interface Word { start: number; end: number; box: Box }
export interface DocPage { canvas: HTMLCanvasElement; text: string; words: Word[]; regions: Region[]; reviewed: boolean }
export interface LocalDocument { pages: DocPage[]; kind: 'pdf' | 'image' }
let ocr: OCRWorker | undefined;
let ocrGeneration = 0;

export async function disposeOCR() { ocrGeneration++; const active = ocr; ocr = undefined; await active?.terminate(); }
function canvas(width: number, height: number) {
  if (width * height > 12_000_000 || width > 6000 || height > 6000) throw new Error('Page is too large. Use a smaller document.');
  const c = document.createElement('canvas'); c.width = Math.ceil(width); c.height = Math.ceil(height); return c;
}
export function boxesForSpans(spans: Span[], words: Word[]): Box[] {
  return words.filter(w => spans.some(s => s.start < w.end && s.end > w.start)).map(w => ({ ...w.box }));
}
export function paintProtected(page: DocPage): HTMLCanvasElement {
  const out = canvas(page.canvas.width, page.canvas.height); const context = out.getContext('2d')!;
  context.drawImage(page.canvas, 0, 0); context.fillStyle = '#000000';
  for (const r of page.regions) if (r.selected) {
    // Padding removes antialiased edges outside the recognized glyph bounds.
    context.fillRect(Math.floor(r.x) - 3, Math.floor(r.y) - 3, Math.ceil(r.width) + 6, Math.ceil(r.height) + 6);
  }
  return out;
}
export async function importDocument(file: File, contextual: ((text: string) => Promise<Span[]>) | null, progress: (text: string) => void): Promise<LocalDocument> {
  const generation = ocrGeneration;
  if (file.size > 20 * 1024 * 1024) throw new Error('Maximum file size is 20 MB.');
  const pages: DocPage[] = []; const kind = file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'pdf' : 'image';
  if (kind === 'pdf') {
    const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), cMapUrl: '/pdfjs/cmaps/', standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/' });
    const pdf = await task.promise;
    try {
      if (pdf.numPages > 8) throw new Error('Maximum document length is eight pages.');
      for (let i = 1; i <= pdf.numPages; i++) {
        progress(`Rendering page ${i} of ${pdf.numPages} locally...`);
        const page = await pdf.getPage(i); const viewport = page.getViewport({ scale: 1.6 });
        const c = canvas(viewport.width, viewport.height);
        await page.render({ canvasContext: c.getContext('2d')!, canvas: c, viewport }).promise;
        pages.push({ canvas: c, text: '', words: [], regions: [], reviewed: false }); page.cleanup();
      }
    } finally { await task.destroy(); }
  } else {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Use PDF, PNG, JPEG or WebP.');
    const bitmap = await createImageBitmap(file);
    try { const c = canvas(bitmap.width, bitmap.height); c.getContext('2d')!.drawImage(bitmap, 0, 0); pages.push({ canvas: c, text: '', words: [], regions: [], reviewed: false }); }
    finally { bitmap.close(); }
  }
  if (!ocr) {
    const created = await createWorker('eng+swa', 1, {
    workerPath: '/ocr/worker.min.js', corePath: '/ocr/core', langPath: '/ocr/lang',
    workerBlobURL: false, cacheMethod: 'none', gzip: true,
    });
    if (generation !== ocrGeneration) { await created.terminate(); throw new Error('Session cleared'); }
    ocr = created;
  }
  for (let i = 0; i < pages.length; i++) {
    if (generation !== ocrGeneration) throw new Error('Session cleared');
    progress(`Reading page ${i + 1} of ${pages.length} on this device...`);
    const page = pages[i]; const result = await ocr.recognize(page.canvas, {}, { blocks: true, text: true });
    for (const block of result.data.blocks ?? []) for (const paragraph of block.paragraphs) for (const line of paragraph.lines) {
      for (const word of line.words) {
        if (!word.text.trim()) continue;
        const start = page.text.length; page.text += word.text + ' ';
        page.words.push({ start, end: start + word.text.length, box: { x: word.bbox.x0, y: word.bbox.y0, width: word.bbox.x1 - word.bbox.x0, height: word.bbox.y1 - word.bbox.y0 } });
      }
      page.text += '\n';
    }
    const spans = union([...detectRules(page.text), ...await (contextual?.(page.text) ?? Promise.resolve([]))], page.text.length);
    for (const span of spans) for (const box of boxesForSpans([span], page.words)) page.regions.push({ ...box, label: span.label, source: span.source, selected: true });
  }
  return { pages, kind };
}
export async function exportDocument(doc: LocalDocument): Promise<Blob> {
  if (!doc.pages.length || doc.pages.some(p => !p.reviewed)) throw new Error('Review and approve every page before export.');
  if (doc.kind === 'image') return new Promise((resolve, reject) => paintProtected(doc.pages[0]).toBlob(b => b ? resolve(b) : reject(new Error('Image export failed')), 'image/png'));
  // Create a NEW document. Never copy source pages, forms, text streams or attachments.
  const output = await PDFDocument.create();
  output.setProducer('SupportPrivacyGateway raster redaction'); output.setCreator('SupportPrivacyGateway');
  for (const page of doc.pages) {
    const image = await output.embedPng(paintProtected(page).toDataURL('image/png'));
    const size: [number, number] = [page.canvas.width / 1.6, page.canvas.height / 1.6];
    output.addPage(size).drawImage(image, { x: 0, y: 0, width: size[0], height: size[1] });
  }
  return new Blob([await output.save() as BlobPart], { type: 'application/pdf' });
}
export function clearDocument(doc: LocalDocument | undefined) {
  for (const page of doc?.pages ?? []) { page.canvas.width = 0; page.canvas.height = 0; page.text = ''; page.words = []; page.regions = []; }
}
