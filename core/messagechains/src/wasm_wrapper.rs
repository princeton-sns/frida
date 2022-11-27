use wasm_bindgen::prelude::*;

use crate::sha256::{Sha256MessageDigest, Sha256MessageHasher};
use crate::MessageChains;

pub fn error_to_string(error: crate::Error) -> &'static str {
    match error {
        crate::Error::TooFewRecipients => "to_few_recipients",
        crate::Error::MissingSelfRecipient => "missing_self_recipient",
        crate::Error::InvalidRecipientsOrder => "invalid_recipients_order",
        crate::Error::InvariantViolated => "invariant_violated",
    }
}

#[wasm_bindgen]
pub struct Sha256StringMessageChains(MessageChains<String, Sha256MessageHasher<String>>);

#[wasm_bindgen]
impl Sha256StringMessageChains {
    pub fn new(own_device: String) -> Self {
        Sha256StringMessageChains(MessageChains::new(own_device, Sha256MessageHasher::new()))
    }

    pub fn insert_message(
        &mut self,
        message: &[u8],
        recipients: Vec<js_sys::JsString>,
    ) -> Result<(), String> {
        self.0
            .insert_message(message, recipients.iter().map(Into::<String>::into))
            .map_err(error_to_string)
            .map_err(ToString::to_string)
    }

    pub fn validate_chain(
        &self,
        validation_sender: String,
        seq: usize,
        digest: String,
    ) -> Result<(), String> {
        let mut digest_bytes = [0_u8; 32];
        hex::decode_to_slice(&digest, &mut digest_bytes)
            .map_err(|_| "invalid_hash_format".to_string())?;

        self.0
            .validate_chain(&validation_sender, seq, &Sha256MessageDigest(digest_bytes))
            .map_err(error_to_string)
            .map_err(ToString::to_string)
    }

    pub fn validate_trim_chain(
        &mut self,
        validation_sender: String,
        seq: usize,
        digest: String,
    ) -> Result<u32, String> {
        let mut digest_bytes = [0_u8; 32];
        hex::decode_to_slice(&digest, &mut digest_bytes)
            .map_err(|_| "invalid_hash_format".to_string())?;

        self.0
            .validate_trim_chain(&validation_sender, seq, &Sha256MessageDigest(digest_bytes))
            .map_err(error_to_string)
            .map_err(ToString::to_string)
            .map(|trimmed| trimmed as u32)
    }

    pub fn validation_payload(&self, recipient: String) -> Option<js_sys::Array> {
        self.0.validation_payload(&recipient).map(|(seq, digest)| {
            let hex_digest = hex::encode(&digest.0);
            // TODO: what if the sequence number reaches u32::MAX?
            js_sys::Array::of2(
                &js_sys::Number::from(seq as u32),
                &js_sys::JsString::from(hex_digest),
            )
        })
    }
}
