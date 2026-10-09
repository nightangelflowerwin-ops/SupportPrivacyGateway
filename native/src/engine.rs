use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Debug, Serialize)]
pub struct Span {
    pub start: usize,
    pub end: usize,
    pub label: String,
    pub source: String,
}

pub fn luhn(value: &str) -> bool {
    let digits: Vec<u32> = value.chars().filter_map(|c| c.to_digit(10)).collect();
    if !(13..=19).contains(&digits.len()) || digits.iter().all(|n| *n == digits[0]) {
        return false;
    }
    let sum: u32 = digits
        .iter()
        .rev()
        .enumerate()
        .map(|(i, n)| {
            let mut n = *n;
            if i % 2 == 1 {
                n *= 2;
                if n > 9 {
                    n -= 9;
                }
            }
            n
        })
        .sum();
    sum.is_multiple_of(10)
}

fn normalize(input: &str) -> (String, Vec<(usize, usize)>) {
    let mut text = String::new();
    let mut origin = Vec::new();
    for (start, ch) in input.char_indices() {
        if matches!(
            ch,
            '\u{200b}' | '\u{200c}' | '\u{200d}' | '\u{2060}' | '\u{feff}' | '\u{ad}'
        ) {
            continue;
        }
        let mapped = match ch {
            '\u{43e}' => 'o',
            '\u{430}' => 'a',
            '\u{435}' => 'e',
            '\u{440}' => 'p',
            '\u{441}' => 'c',
            _ => ch,
        };
        let piece: String = mapped.to_string().nfkc().collect();
        origin.extend(std::iter::repeat_n(
            (start, start + ch.len_utf8()),
            piece.len(),
        ));
        text.push_str(&piece);
    }
    (text, origin)
}

fn rules() -> &'static Vec<(Regex, &'static str, bool)> {
    static RULES: OnceLock<Vec<(Regex, &'static str, bool)>> = OnceLock::new();
    RULES.get_or_init(|| vec![
        (Regex::new(r"[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+").unwrap(), "EMAIL", false),
        (Regex::new(r"\b(?:\d[ -]?){12,18}\d\b").unwrap(), "CARD", false),
        (Regex::new(r"\b(?:\d{1,3}\.){3}\d{1,3}\b").unwrap(), "IP", false),
        // Regional candidates use format rules, not libphonenumber metadata.
        (Regex::new(r"(?:\+254[ -]?[17](?:[ -]?\d){8}|\+256[ -]?7(?:[ -]?\d){8}|\+255[ -]?[67](?:[ -]?\d){8}|\b0[17](?:[ -]?\d){8})\b").unwrap(), "PHONE", false),
        (Regex::new(r"\+1[ -]?\(?\d{3}\)?[ -]?\d{3}[ -]?\d{4}\b").unwrap(), "PHONE", false),
        (Regex::new(r"\b(?i:my name is|name\s*:|jina langu ni|naitwa|jina\s*:)\s+([\p{Lu}][\p{L}'-]+(?:[ \t]+[\p{Lu}][\p{L}'-]+){0,3})").unwrap(), "NAME", true),
        (Regex::new(r"(?i)\b(?:address|anwani)\s*[:=]\s*([^\n;.]{3,100})").unwrap(), "ADDRESS", true),
        (Regex::new(r"(?i)\b(?:national id|id number|kitambulisho|nambari ya kitambulisho)\s*[:#=-]?\s*(\d{7,8})\b").unwrap(), "NATIONAL_ID", true),
        (Regex::new(r"(?i)\b(?:nin|national identification number)\s*[:#=-]?\s*([A-Z0-9]{14})\b").unwrap(), "NATIONAL_ID", true),
        (Regex::new(r"(?i)\b(?:kra pin|tax pin)\s*[:#=-]?\s*([A-Z]\d{9}[A-Z])\b").unwrap(), "TAX_ID", true),
        (Regex::new(r"(?i)\b(?:m-?pesa|receipt|muamala)\s*(?:code|ref|reference|receipt|ya)?\s*[:#=-]?\s*([A-Z0-9]{10})\b").unwrap(), "MPESA_REF", true),
    ])
}

pub fn detect(input: &str) -> Vec<Span> {
    let (text, origin) = normalize(input);
    let mut found = Vec::new();
    for (re, label, contextual) in rules() {
        for captures in re.captures_iter(&text) {
            let m = captures.get(if *contextual { 1 } else { 0 }).unwrap();
            if *label == "CARD" && !luhn(m.as_str()) {
                continue;
            }
            if *label == "IP" && !m.as_str().split('.').all(|p| p.parse::<u8>().is_ok()) {
                continue;
            }
            found.push(Span {
                start: origin[m.start()].0,
                end: origin[m.end() - 1].1,
                label: label.to_string(),
                source: if *contextual {
                    "regional-rule"
                } else {
                    "native-rule"
                }
                .into(),
            });
        }
    }
    found.sort_by_key(|s| (s.start, std::cmp::Reverse(s.end)));
    let mut out: Vec<Span> = Vec::new();
    for span in found {
        if let Some(last) = out.last_mut() {
            if span.start < last.end {
                last.end = last.end.max(span.end);
                if span.label != last.label {
                    last.label = "PII".into();
                }
                continue;
            }
        }
        out.push(span);
    }
    out
}

pub fn utf16_spans(text: &str, spans: &[Span]) -> Vec<Span> {
    spans
        .iter()
        .map(|s| Span {
            start: text[..s.start].encode_utf16().count(),
            end: text[..s.end].encode_utf16().count(),
            label: s.label.clone(),
            source: s.source.clone(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn checksums_and_boundary_mapping() {
        assert!(luhn("4111 1111 1111 1111"));
        assert!(!luhn("4111 1111 1111 1112"));
        let text = "🙂 j\u{200b}ohn@example.com, card ４１１１ １１１１ １１１１ １１１１";
        let spans = detect(text);
        assert_eq!(spans.len(), 2);
        assert_eq!(
            &text[spans[0].start..spans[0].end],
            "j\u{200b}ohn@example.com"
        );
        assert_eq!(utf16_spans(text, &spans)[0].start, 3);
    }
    #[test]
    fn regional_names_ids_and_negative_examples() {
        let s = detect("Jina langu ni Amina Wanjiku. Simu +254 712 345 678. Kitambulisho: 12345678. KRA PIN A123456789Z. M-PESA ref QAB12CD345.");
        assert_eq!(s.len(), 5);
        assert!(detect("Order 12345678. Version 999.0.0.1. Card 4111111111111112.").is_empty());
    }
}
