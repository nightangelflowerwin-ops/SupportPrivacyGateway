import { describe, expect, it } from 'vitest';
import { detectRules, normalize, mapSpan, luhn, iban, union, redact, SessionVault } from '../src/core';
import { alignTokens, chunks } from '../src/model-alignment';

describe('privacy boundaries', () => {
  it('maps original UTF-16 offsets through Unicode and hidden characters', () => {
    const text = '🙂 email j\u200bohn@example.com, card ４１１１ １１１１ １１１１ １１１１';
    const spans = detectRules(text);
    expect(text.slice(spans[0].start, spans[0].end)).toBe('j\u200bohn@example.com');
    expect(spans[0].start).toBe(9);
    expect(spans.some(s => s.label === 'CARD')).toBe(true);
    const normalized = normalize('½🙂');
    expect(mapSpan(normalized, { start: 0, end: 1, label: 'OTHER', source: 'test' }).end).toBe(1);
  });
  it('checks structured values and rejects lookalike negative examples', () => {
    expect(luhn('4111 1111 1111 1111')).toBe(true);
    expect(luhn('4111 1111 1111 1112')).toBe(false);
    expect(luhn('0000000000000000')).toBe(false);
    expect(iban('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(iban('GB82 WEST 1234 5698 7654 33')).toBe(false);
    expect(detectRules('Order 12345678. Version 999.0.0.1. Card 4111111111111112.')).toEqual([]);
  });
  it('handles mixed English/Swahili context without masking the surrounding prompt', () => {
    const text = 'Jina langu ni Amina Wanjiku. Simu +254 712 345 678. Kitambulisho: 12345678. KRA PIN A123456789Z. M-PESA ref QAB12CD345.';
    const spans = detectRules(text);
    expect(spans.map(s => text.slice(s.start, s.end))).toEqual(['Amina Wanjiku', '+254 712 345 678', '12345678', 'A123456789Z', 'QAB12CD345']);
    expect(detectRules('simu sifuri saba moja mbili tatu nne tano sita saba nane').some(s => s.label === 'PHONE')).toBe(true);
  });
  it('unions overlapping ranges and refuses invalid detector offsets', () => {
    expect(union([{ start: 0, end: 4, label: 'NAME', source: 'a' }, { start: 2, end: 6, label: 'EMAIL', source: 'b' }], 8)).toEqual([{ start: 0, end: 6, label: 'PII', source: 'a+b' }]);
    expect(() => union([{ start: 2, end: 40, label: 'NAME', source: 'bad' }], 8)).toThrow();
  });
  it('pseudonymizes consistently, restores once and discards mappings on reset', async () => {
    const vault = new SessionVault(); await vault.reset();
    const text = 'mail test@example.com twice test@example.com';
    const output = await redact(text, detectRules(text), 'pseudonymize', vault);
    expect(output).not.toContain('test@example.com');
    expect(output.match(/\[\[.*?\]\]/g)?.[0]).toBe(output.match(/\[\[.*?\]\]/g)?.[1]);
    expect(await vault.restore(output)).toBe(text);
    await vault.reset(); expect(await vault.restore(output)).toBe(output);
  });
  it('uses session-keyed hashes, not reversible tokens', async () => {
    const vault = new SessionVault(); await vault.reset();
    const first = await vault.hash('EMAIL', 'same@example.com');
    expect(await vault.hash('EMAIL', 'same@example.com')).toBe(first);
    expect(await vault.hash('NAME', 'same@example.com')).not.toBe(first);
    await vault.reset(); expect(await vault.hash('EMAIL', 'same@example.com')).not.toBe(first);
  });
});

describe('model alignment', () => {
  it('consumes O tokens so repeated words do not align to an earlier occurrence', () => {
    const tokens = [{ word: 'Sarah', entity: 'O', index: 1, score: 1 }, { word: 'met', entity: 'O', index: 2, score: 1 }, { word: 'Sarah', entity: 'B-PER', index: 3, score: .9 }];
    expect(alignTokens('Sarah met Sarah', tokens)[0]).toMatchObject({ start: 10, end: 15, label: 'NAME' });
  });
  it('joins BIO word pieces and rejects skipped unknown tokens', () => {
    expect(alignTokens('Sarah Johnson', [{ word: 'Sarah', entity: 'B-PER', index: 1, score: 1 }, { word: 'John', entity: 'I-PER', index: 2, score: 1 }, { word: '##son', entity: 'I-PER', index: 3, score: 1 }])[0]).toMatchObject({ start: 0, end: 13 });
    expect(() => alignTokens('Sarah 🙂', [{ word: 'Sarah', entity: 'B-PER', index: 1, score: 1 }])).toThrow();
  });
  it('chunks long inputs with overlap and coverage', () => {
    const text = 'Sarah met Johnson. '.repeat(100); const parts = chunks(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every(p => p.text.length <= 350)).toBe(true);
    expect(parts[0].offset).toBe(0);
    expect(parts.at(-1)!.offset + parts.at(-1)!.text.length).toBe(text.length);
    for (let i = 1; i < parts.length; i++) expect(parts[i].offset).toBeLessThanOrEqual(parts[i-1].offset + parts[i-1].text.length);
  });
});
