import type { Span } from './core';
let worker: Worker | undefined, counter = 0;
const waiting = new Map<number, { resolve: (spans: Span[]) => void; reject: (error: Error) => void }>();
export function detectModel(text: string, status: (message: string) => void): Promise<Span[]> {
  if (!worker) {
    worker = new Worker(new URL('./model.worker.ts', import.meta.url), { type: 'module' });
    worker.onerror = () => { for (const pending of waiting.values()) pending.reject(new Error('Local model worker failed')); waiting.clear(); worker?.terminate(); worker = undefined; };
  }
  const id = ++counter;
  worker.onmessage = event => {
    const data = event.data;
    if (data.progress) { status('Loading local model assets. Ticket stays in this browser.'); return; }
    const pending = waiting.get(data.id); if (!pending) return;
    waiting.delete(data.id);
    if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.spans);
  };
  return new Promise((resolve, reject) => { waiting.set(id, { resolve, reject }); worker!.postMessage({ id, text }); });
}
export function disposeModel() {
  // Termination also releases the worker's WASM heap and active model.
  worker?.terminate(); worker = undefined;
  for (const pending of waiting.values()) pending.reject(new Error('Session cleared'));
  waiting.clear();
}
