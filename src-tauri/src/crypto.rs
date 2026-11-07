//! The envelope, and nothing else.

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};

/// What `letters.algorithm` says, so a future reader knows what they hold.
pub const ALGORITHM: &str = "xchacha20poly1305";

/// What `letters.envelope` says.
pub const ENVELOPE_VERSION: i64 = 1;

/// Key and nonce lengths for XChaCha20-Poly1305.
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 24;

/// Bytes from the operating system's own generator.
fn random_bytes(length: usize) -> Result<Vec<u8>, String> {
    let mut bytes = vec![0_u8; length];
    getrandom::getrandom(&mut bytes)
        .map_err(|e| format!("no randomness available to seal with: {e}"))?;
    Ok(bytes)
}

pub fn random_key() -> Result<Vec<u8>, String> {
    random_bytes(KEY_LEN)
}

pub fn random_nonce() -> Result<Vec<u8>, String> {
    random_bytes(NONCE_LEN)
}

fn cipher(key: &[u8]) -> Result<XChaCha20Poly1305, String> {
    if key.len() != KEY_LEN {
        return Err(format!("a key is {KEY_LEN} bytes, not {}", key.len()));
    }
    Ok(XChaCha20Poly1305::new(Key::from_slice(key)))
}

fn checked_nonce(nonce: &[u8]) -> Result<&XNonce, String> {
    if nonce.len() != NONCE_LEN {
        return Err(format!("a nonce is {NONCE_LEN} bytes, not {}", nonce.len()));
    }
    Ok(XNonce::from_slice(nonce))
}

/// Closes the envelope.
pub fn seal(
    key: &[u8],
    nonce: &[u8],
    plaintext: &[u8],
    associated_data: &[u8],
) -> Result<Vec<u8>, String> {
    cipher(key)?
        .encrypt(
            checked_nonce(nonce)?,
            Payload {
                aad: associated_data,
                msg: plaintext,
            },
        )
        .map_err(|_| "the letter could not be sealed".to_string())
}

/// Opens the envelope, or refuses.
pub fn unseal(
    key: &[u8],
    nonce: &[u8],
    ciphertext: &[u8],
    associated_data: &[u8],
) -> Result<Vec<u8>, String> {
    cipher(key)?
        .decrypt(
            checked_nonce(nonce)?,
            Payload {
                aad: associated_data,
                msg: ciphertext,
            },
        )
        .map_err(|_| "the envelope does not authenticate".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const AAD: &[u8] = b"wattle-letter-v1\x1f7\x1f2031-03-14\x1f2026-08-21T10:00:00.000Z";

    fn material() -> (Vec<u8>, Vec<u8>) {
        (random_key().unwrap(), random_nonce().unwrap())
    }

    #[test]
    fn what_goes_in_comes_back_out() {
        let (key, nonce) = material();
        let letter = r#"{"type":"doc","content":[{"type":"paragraph"}]}"#;
        let sealed = seal(&key, &nonce, letter.as_bytes(), AAD).unwrap();
        assert_ne!(
            sealed,
            letter.as_bytes(),
            "the letter must not be in the clear"
        );
        let opened = unseal(&key, &nonce, &sealed, AAD).unwrap();
        assert_eq!(String::from_utf8(opened).unwrap(), letter);
    }

    #[test]
    fn the_wrong_key_opens_nothing() {
        let (key, nonce) = material();
        let sealed = seal(&key, &nonce, b"a letter", AAD).unwrap();
        let (other, _) = material();
        assert!(unseal(&other, &nonce, &sealed, AAD).is_err());
    }

    #[test]
    fn the_wrong_nonce_opens_nothing() {
        let (key, nonce) = material();
        let sealed = seal(&key, &nonce, b"a letter", AAD).unwrap();
        let (_, other) = material();
        assert!(unseal(&key, &other, &sealed, AAD).is_err());
    }

    #[test]
    fn the_wrong_associated_data_opens_nothing() {
        let (key, nonce) = material();
        let sealed = seal(&key, &nonce, b"a letter", AAD).unwrap();
        let moved_forward = b"wattle-letter-v1\x1f7\x1f2026-08-20\x1f2026-08-21T10:00:00.000Z";
        assert!(
            unseal(&key, &nonce, &sealed, moved_forward).is_err(),
            "a tampered date must fail to authenticate, not quietly open"
        );
    }

    #[test]
    fn one_flipped_bit_of_ciphertext_opens_nothing() {
        let (key, nonce) = material();
        let mut sealed = seal(&key, &nonce, b"a letter", AAD).unwrap();
        sealed[0] ^= 0x01;
        assert!(unseal(&key, &nonce, &sealed, AAD).is_err());
    }

    #[test]
    fn a_truncated_envelope_opens_nothing() {
        let (key, nonce) = material();
        let mut sealed = seal(&key, &nonce, b"a letter", AAD).unwrap();
        sealed.pop();
        assert!(unseal(&key, &nonce, &sealed, AAD).is_err());
    }

    #[test]
    fn every_letter_gets_its_own_key_and_its_own_nonce() {
        let (key_a, nonce_a) = material();
        let (key_b, nonce_b) = material();
        assert_eq!(key_a.len(), KEY_LEN);
        assert_eq!(nonce_a.len(), NONCE_LEN);
        assert_ne!(key_a, key_b);
        assert_ne!(nonce_a, nonce_b);
        assert_ne!(key_a, vec![0_u8; KEY_LEN], "a key of zeroes is not a key");
    }

    #[test]
    fn material_of_the_wrong_length_is_refused_rather_than_padded() {
        assert!(seal(&[0_u8; 16], &[0_u8; NONCE_LEN], b"x", AAD).is_err());
        assert!(seal(&[0_u8; KEY_LEN], &[0_u8; 12], b"x", AAD).is_err());
    }

    #[test]
    fn only_this_file_can_open_an_envelope() {
        let mut checked = 0;
        for entry in walk("src") {
            let name = entry.to_string_lossy().replace('\\', "/");
            if name.ends_with("src/crypto.rs") {
                continue;
            }
            let source = std::fs::read_to_string(&entry).unwrap();
            for symbol in ["chacha", "ChaCha", "decrypt", "Aead"] {
                assert!(
                    !source.contains(symbol),
                    "{name} must not know about {symbol}: crypto.rs is the one gate"
                );
            }
            checked += 1;
        }
        assert!(checked > 10, "the walk found almost nothing; it is broken");
    }

    fn walk(dir: &str) -> Vec<std::path::PathBuf> {
        let mut found = Vec::new();
        let mut stack = vec![std::path::PathBuf::from(dir)];
        while let Some(next) = stack.pop() {
            for entry in std::fs::read_dir(next).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.extension().is_some_and(|ext| ext == "rs") {
                    found.push(path);
                }
            }
        }
        found
    }
}
