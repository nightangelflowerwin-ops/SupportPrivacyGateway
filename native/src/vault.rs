use crate::engine::Span;
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use hmac::{Hmac, Mac};
use rand::{rngs::OsRng, RngCore};
use sha2::Sha256;
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

pub struct Vault {
    cipher: Aes256Gcm,
    mac_key: [u8; 32],
    scopes: HashMap<String, Scope>,
}
struct Scope {
    created: Instant,
    values: HashMap<String, (Vec<u8>, Vec<u8>)>,
    digests: HashMap<String, String>,
}

impl Vault {
    pub fn new() -> Self {
        let mut key = [0u8; 32];
        let mut mac_key = [0u8; 32];
        OsRng.fill_bytes(&mut key);
        OsRng.fill_bytes(&mut mac_key);
        Self {
            cipher: Aes256Gcm::new_from_slice(&key).unwrap(),
            mac_key,
            scopes: HashMap::new(),
        }
    }
    fn purge(&mut self) {
        self.scopes
            .retain(|_, scope| scope.created.elapsed() < Duration::from_secs(1800));
    }
    pub fn redact(
        &mut self,
        text: &str,
        spans: &[Span],
        action: &str,
        conversation: &str,
    ) -> Result<String, &'static str> {
        if !["mask", "hash", "pseudonymize"].contains(&action) {
            return Err("invalid action");
        }
        self.purge();
        if self.scopes.len() >= 1000 && !self.scopes.contains_key(conversation) {
            return Err("session capacity reached");
        }
        let scope = self
            .scopes
            .entry(conversation.into())
            .or_insert_with(|| Scope {
                created: Instant::now(),
                values: HashMap::new(),
                digests: HashMap::new(),
            });
        let mut out = String::new();
        let mut last = 0;
        for span in spans {
            let value = &text[span.start..span.end];
            let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&self.mac_key).unwrap();
            mac.update(span.label.as_bytes());
            mac.update(&[0]);
            mac.update(value.as_bytes());
            let digest = hex::encode(mac.finalize().into_bytes());
            let replacement = if action == "mask" {
                format!("[{}]", span.label)
            } else if action == "hash" {
                format!("[{}:{}]", span.label, &digest[..20])
            } else if let Some(token) = scope.digests.get(&digest) {
                token.clone()
            } else {
                if scope.values.len() >= 10000 {
                    return Err("token capacity reached");
                }
                let token = format!(
                    "[[{}:{}:{}]]",
                    &conversation[..8],
                    span.label,
                    scope.values.len() + 1
                );
                let mut nonce = [0u8; 12];
                OsRng.fill_bytes(&mut nonce);
                let aad = format!("{conversation}\0{token}");
                let ciphertext = self
                    .cipher
                    .encrypt(
                        Nonce::from_slice(&nonce),
                        Payload {
                            msg: value.as_bytes(),
                            aad: aad.as_bytes(),
                        },
                    )
                    .map_err(|_| "encryption failed")?;
                scope
                    .values
                    .insert(token.clone(), (nonce.to_vec(), ciphertext));
                scope.digests.insert(digest, token.clone());
                token
            };
            out.push_str(&text[last..span.start]);
            out.push_str(&replacement);
            last = span.end;
        }
        out.push_str(&text[last..]);
        Ok(out)
    }
    pub fn restore(&mut self, text: &str, conversation: &str) -> Result<String, &'static str> {
        self.purge();
        let scope = self
            .scopes
            .get(conversation)
            .ok_or("unknown or expired conversation")?;
        let re = regex::Regex::new(r"\[\[[a-f0-9-]+:[A-Z_]+:\d+\]\]").unwrap();
        let mut out = String::new();
        let mut last = 0;
        for m in re.find_iter(text) {
            out.push_str(&text[last..m.start()]);
            if let Some((nonce, ciphertext)) = scope.values.get(m.as_str()) {
                let aad = format!("{conversation}\0{}", m.as_str());
                let value = self
                    .cipher
                    .decrypt(
                        Nonce::from_slice(nonce),
                        Payload {
                            msg: ciphertext,
                            aad: aad.as_bytes(),
                        },
                    )
                    .map_err(|_| "authentication failed")?;
                out.push_str(std::str::from_utf8(&value).map_err(|_| "invalid vault value")?);
            } else {
                out.push_str(m.as_str());
            }
            last = m.end();
        }
        out.push_str(&text[last..]);
        Ok(out)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scoped_round_trip_and_ciphertext() {
        let mut vault = Vault::new();
        let id = uuid::Uuid::new_v4().simple().to_string();
        let text = "mail john@example.com then john@example.com";
        let spans = crate::engine::detect(text);
        let redacted = vault.redact(text, &spans, "pseudonymize", &id).unwrap();
        assert!(!redacted.contains("john@example.com"));
        assert_eq!(vault.restore(&redacted, &id).unwrap(), text);
        assert_eq!(vault.scopes[&id].values.len(), 1);
        assert!(vault.restore(&redacted, "other").is_err());
        let entry = vault
            .scopes
            .get_mut(&id)
            .unwrap()
            .values
            .values_mut()
            .next()
            .unwrap();
        entry.1[0] ^= 1;
        assert!(vault.restore(&redacted, &id).is_err());
    }
}
