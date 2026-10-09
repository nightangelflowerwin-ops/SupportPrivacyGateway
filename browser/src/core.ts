import { findPhoneNumbersInText, parsePhoneNumberFromString } from 'libphonenumber-js';

export interface Span { start: number; end: number; label: string; source: string; score?: number }
export type Action = 'mask' | 'pseudonymize' | 'hash';
export interface Normalized { text: string; starts: number[]; ends: number[] }
const aliases: Record<string, string> = { '\u043e': 'o', '\u0430': 'a', '\u0435': 'e', '\u0440': 'p', '\u0441': 'c' };

export function normalize(input: string): Normalized {
  let text = ''; const starts: number[] = [], ends: number[] = [];
  let offset = 0;
  for (const ch of input) {
    const start = offset; offset += ch.length;
    if (/[\u200b-\u200d\u2060\ufeff\u00ad]/u.test(ch)) continue;
    const value = aliases[ch] ?? ch.normalize('NFKC');
    text += value;
    for (let j = 0; j < value.length; j++) { starts.push(start); ends.push(offset); }
  }
  return { text, starts, ends };
}
export function mapSpan(n: Normalized, s: Span): Span {
  if (s.start < 0 || s.end <= s.start || s.end > n.text.length) throw new Error('Invalid detector offsets');
  return { ...s, start: n.starts[s.start], end: n.ends[s.end - 1] };
}
export function luhn(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (!/^\d{13,19}$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  for (let i = digits.length - 1, alternate = false; i >= 0; i--, alternate = !alternate) {
    let n = Number(digits[i]); if (alternate) { n *= 2; if (n > 9) n -= 9; } sum += n;
  }
  return sum % 10 === 0;
}
export function iban(value: string): boolean {
  const s = value.replace(/\s/g, '').toUpperCase();
  const lengths: Record<string, number> = { GB: 22, DE: 22, FR: 27, ES: 24, IT: 27, NL: 18, BE: 16, CH: 21, IE: 22, PT: 25 };
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s) || lengths[s.slice(0, 2)] !== s.length) return false;
  const numeric = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let mod = 0; for (const digit of numeric) mod = (mod * 10 + Number(digit)) % 97;
  return mod === 1;
}
export function union(spans: Span[], length: number): Span[] {
  const sorted = spans.map(s => ({ ...s })).sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Span[] = [];
  for (const s of sorted) {
    if (!Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < 0 || s.end > length || s.end <= s.start) throw new Error('Invalid detector offsets');
    const last = out.at(-1);
    if (last && s.start < last.end) {
      last.end = Math.max(last.end, s.end);
      if (last.label !== s.label) last.label = 'PII';
      last.source = [...new Set([...last.source.split('+'), ...s.source.split('+')])].join('+');
    } else out.push(s);
  }
  return out;
}

export function detectRules(input: string): Span[] {
  const n = normalize(input), text = n.text, spans: Span[] = [];
  const add = (start: number, end: number, label: string, source = 'validator') => spans.push(mapSpan(n, { start, end, label, source }));
  const scan = (re: RegExp, label: string, valid: (s: string) => boolean = () => true) => {
    for (const m of text.matchAll(re)) if (valid(m[0])) add(m.index!, m.index! + m[0].length, label);
  };
  scan(/[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/g, 'EMAIL');
  scan(/\b(?:\d[ -]?){12,18}\d\b/g, 'CARD', luhn);
  scan(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g, 'IBAN', iban);
  scan(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 'IP', s => s.split('.').every(x => Number(x) <= 255));
  for (const country of ['KE', 'UG', 'TZ', 'US', 'GB'] as const) {
    for (const phone of findPhoneNumbersInText(text, country)) add(phone.startsAt, phone.endsAt, 'PHONE');
  }
  const context = (re: RegExp, label: string) => {
    for (const m of text.matchAll(re)) {
      const value = m[1]; const start = m.index! + m[0].lastIndexOf(value);
      add(start, start + value.length, label, 'regional-rule');
    }
  };
  context(/\b(?:[Mm]y name is|[Nn]ame\s*:|[Jj]ina langu ni|[Nn]aitwa|[Jj]ina\s*:)\s+([\p{Lu}][\p{L}'-]+(?:[ \t]+[\p{Lu}][\p{L}'-]+){0,3})/gu, 'NAME');
  context(/\b(?:address|anwani)\s*[:=]\s*([^\n;.]{3,100})/giu, 'ADDRESS');
  context(/\b(?:national id|id number|kitambulisho|nambari ya kitambulisho)\s*[:#=-]?\s*(\d{7,8})\b/giu, 'NATIONAL_ID');
  context(/\b(?:nin|national identification number)\s*[:#=-]?\s*([A-Z0-9]{14})\b/giu, 'NATIONAL_ID');
  context(/\b(?:kra pin|tax pin)\s*[:#=-]?\s*([A-Z]\d{9}[A-Z])\b/giu, 'TAX_ID');
  context(/\b(?:m-?pesa|receipt|muamala)\s*(?:code|ref|reference|receipt|ya)?\s*[:#=-]?\s*([A-Z0-9]{10})\b/giu, 'MPESA_REF');
  const digitWords: Record<string, string> = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', sifuri: '0', moja: '1', mbili: '2', tatu: '3', nne: '4', tano: '5', sita: '6', saba: '7', nane: '8', tisa: '9' };
  const wordPattern = Object.keys(digitWords).join('|');
  const spoken = new RegExp(`\\b(?:phone|simu|nambari ya simu)\\s*[:=]?\\s*((?:(?:${wordPattern})[ ,]*){9,15})`, 'gi');
  for (const m of text.matchAll(spoken)) {
    const words = m[1].match(new RegExp(`\\b(?:${wordPattern})\\b`, 'gi')) ?? [];
    const digits = words.map(w => digitWords[w.toLowerCase()]).join('');
    const phone = parsePhoneNumberFromString(digits, 'KE');
    if (phone?.isValid()) { const value = m[1].trimEnd(); const start = m.index! + m[0].indexOf(m[1]); add(start, start + value.length, 'PHONE', 'regional-rule'); }
  }
  return union(spans, input.length);
}

export class SessionVault {
  private aes!: CryptoKey; private mac!: CryptoKey;
  private values = new Map<string, { iv: Uint8Array; ciphertext: ArrayBuffer }>();
  private digests = new Map<string, string>(); private counters = new Map<string, number>();
  private prefix = ''; private expires = 0;
  async reset() {
    this.values.clear(); this.digests.clear(); this.counters.clear();
    this.aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    this.mac = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    this.prefix = crypto.randomUUID().slice(0, 8); this.expires = Date.now() + 30 * 60_000;
  }
  private live() { if (Date.now() >= this.expires) { this.values.clear(); this.digests.clear(); throw new Error('Session expired. Clear the session and analyze again.'); } }
  async hash(label: string, value: string) {
    this.live();
    const bytes = await crypto.subtle.sign('HMAC', this.mac, new TextEncoder().encode(`${label}\0${value}`));
    return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('').slice(0, 20);
  }
  async token(label: string, value: string) {
    const digest = await this.hash(label, value); const cached = this.digests.get(digest); if (cached) return cached;
    const n = (this.counters.get(label) ?? 0) + 1; this.counters.set(label, n);
    const token = `[[${this.prefix}:${label}:${n}]]`, iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(token) }, this.aes, new TextEncoder().encode(value));
    this.values.set(token, { iv, ciphertext }); this.digests.set(digest, token); return token;
  }
  async restore(text: string) {
    this.live(); let result = '', last = 0;
    // Single pass: restored source text is never recursively interpreted as another token.
    for (const m of text.matchAll(/\[\[[a-f0-9-]+:[A-Z_]+:\d+\]\]/g)) {
      result += text.slice(last, m.index); const entry = this.values.get(m[0]);
      result += entry ? new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: entry.iv as BufferSource, additionalData: new TextEncoder().encode(m[0]) }, this.aes, entry.ciphertext)) : m[0];
      last = m.index! + m[0].length;
    }
    return result + text.slice(last);
  }
}
export async function redact(text: string, spans: Span[], action: Action, vault: SessionVault) {
  let result = '', last = 0;
  for (const s of union(spans, text.length)) {
    const value = text.slice(s.start, s.end);
    const replacement = action === 'mask' ? `[${s.label}]` : action === 'hash' ? `[${s.label}:${await vault.hash(s.label, value)}]` : await vault.token(s.label, value);
    result += text.slice(last, s.start) + replacement; last = s.end;
  }
  return result + text.slice(last);
}
