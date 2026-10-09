import { mapSpan, normalize, union, type Span } from './core';
export interface Token { word: string; entity: string; score: number; index: number }

export function alignTokens(input: string, tokens: Token[]): Span[] {
  const norm = normalize(input), text = norm.text;
  let cursor = 0, lastIndex = 0; const found: Span[] = [];
  let current: Span | undefined;
  for (const token of tokens) {
    const word = token.word.replace(/^##/, '').trim();
    if (!word) continue;
    const at = text.indexOf(word, cursor);
    if (at < 0 || text.slice(cursor, at).trim() !== '' || (lastIndex && token.index !== lastIndex + 1)) {
      throw new Error('Model token alignment is incomplete. Review with rules mode or edit unsupported characters.');
    }
    const end = at + word.length;
    const [bio, kind] = token.entity.split('-');
    const label = ({ PER: 'NAME', LOC: 'LOCATION', ORG: 'ORG', MISC: 'OTHER' } as Record<string, string>)[kind];
    if (label) {
      if (bio === 'I' && current?.label === label && text.slice(current.end, at).trim() === '') {
        current.end = end; current.score = Math.min(current.score ?? 1, token.score);
      } else { current = { start: at, end, label, source: 'local-model', score: token.score }; found.push(current); }
    } else current = undefined;
    cursor = end; lastIndex = token.index;
  }
  if (text.slice(cursor).trim()) throw new Error('Model did not cover the complete input. No export allowed.');
  return union(found.map(s => mapSpan(norm, s)), input.length);
}

export function chunks(text: string): { text: string; offset: number }[] {
  const result: { text: string; offset: number }[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + 350, text.length);
    if (end < text.length) {
      const space = text.lastIndexOf(' ', end);
      if (space > offset + 200) end = space;
      if (/^[\uDC00-\uDFFF]$/.test(text[end] ?? '')) end--;
    }
    result.push({ text: text.slice(offset, end), offset });
    if (end === text.length) break;
    let next = Math.max(offset + 1, end - 70);
    while (next < end && !/\s/.test(text[next - 1] ?? '')) next++;
    offset = next;
  }
  return result;
}
