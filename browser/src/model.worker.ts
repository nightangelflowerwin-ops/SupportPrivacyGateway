import { env, pipeline } from '@huggingface/transformers';
import { alignTokens, chunks, type Token } from './model-alignment';
import { normalize, union, type Span } from './core';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.useBrowserCache = false;
env.backends.onnx.wasm!.wasmPaths = '/runtime/';
env.backends.onnx.wasm!.numThreads = 1;
let classifier: Awaited<ReturnType<typeof pipeline<'token-classification'>>> | undefined;
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<{ id: number; text: string; dispose?: boolean }>) => {
  queue = queue.then(async () => {
    const { id, text, dispose } = event.data;
    try {
      if (dispose) { await classifier?.dispose(); classifier = undefined; self.postMessage({ id, spans: [] }); return; }
      if (!classifier) classifier = await pipeline('token-classification', 'Xenova/bert-base-NER', {
        dtype: 'q8', device: 'wasm', progress_callback: (info: unknown) => self.postMessage({ id, progress: info }),
      });
      const spans: Span[] = [];
      for (const part of chunks(text)) {
        const normalized = normalize(part.text).text;
        const output = await classifier(normalized, { ignore_labels: [] });
        spans.push(...alignTokens(part.text, output as Token[]).map(s => ({ ...s, start: s.start + part.offset, end: s.end + part.offset })));
      }
      self.postMessage({ id, spans: union(spans, text.length) });
    } catch { self.postMessage({ id: event.data.id, error: 'Local model failed or could not align every token. No result was exported. Use rules mode with manual review.' }); }
  });
};
