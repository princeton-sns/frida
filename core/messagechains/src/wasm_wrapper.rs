use wasm_bindgen::prelude::*;

use crate::sha256::{Sha256MessageDigest, Sha256MessageHasher};
use crate::MessageChains;

pub fn error_to_string(error: crate::Error) -> &'static str {
    match error {
        crate::Error::TooFewRecipients => "too_few_recipients",
        crate::Error::MissingSelfRecipient => "missing_self_recipient",
        crate::Error::InvalidRecipientsOrder => "invalid_recipients_order",
        crate::Error::InvariantViolated => "invariant_violated",
        crate::Error::OwnMessageInvalidReordered => "own_message_invalid_reordered",
        crate::Error::UnknownDevice => "unknown_device",
    }
}

#[wasm_bindgen]
pub struct Sha256StringMessageChains(MessageChains<String, Sha256MessageHasher<String>>);

#[wasm_bindgen]
impl Sha256StringMessageChains {
    pub fn new(own_device: String) -> Self {
        Sha256StringMessageChains(MessageChains::new(own_device, Sha256MessageHasher::new()))
    }

    pub fn send_message(&mut self, message: String, recipients: Vec<js_sys::JsString>) {
        self.0.send_message(
            message.as_bytes(),
            recipients.iter().map(Into::<String>::into),
        )
    }

    pub fn insert_message(
        &mut self,
        sender: String,
        message: String,
        recipients: Vec<js_sys::JsString>,
    ) -> Result<usize, String> {
        self.0
            .insert_message(
                &sender,
                message.as_bytes(),
                recipients.iter().map(Into::<String>::into),
            )
            .map_err(error_to_string)
            .map_err(ToString::to_string)
    }

    pub fn validate_chain(
        &mut self,
        validation_sender: String,
        seq: Option<usize>,
        digest: Option<String>,
    ) -> Result<(), String> {
        let validation_payload = match (seq, digest) {
            (Some(seq), Some(digest)) => {
                let mut digest_bytes = [0_u8; 32];
                hex::decode_to_slice(&digest, &mut digest_bytes)
                    .map_err(|_| "invalid_hash_format".to_string())?;
                Some((seq, Sha256MessageDigest(digest_bytes)))
            }
            (None, None) => None,
            (_, _) => panic!("Invalid arguments to validate_chain!"),
        };

        self.0
            .validate_chain(&validation_sender, validation_payload)
            .map_err(error_to_string)
            .map_err(ToString::to_string)
    }

    pub fn validate_trim_chain(
        &mut self,
        validation_sender: String,
        seq: Option<usize>,
        digest: Option<String>,
    ) -> Result<u32, String> {
        let validation_payload = match (seq, digest) {
            (Some(seq), Some(digest)) => {
                let mut digest_bytes = [0_u8; 32];
                hex::decode_to_slice(&digest, &mut digest_bytes)
                    .map_err(|_| "invalid_hash_format".to_string())?;
                Some((seq, Sha256MessageDigest(digest_bytes)))
            }
            (None, None) => None,
            (_, _) => panic!("Invalid arguments to validate_chain!"),
        };

        self.0
            .validate_trim_chain(&validation_sender, validation_payload)
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

    pub fn sort_recipients(&self, recipients: Vec<js_sys::JsString>) -> Vec<js_sys::JsString> {
        let mut recipients_rust_str: Vec<(js_sys::JsString, String)> = recipients
            .into_iter()
            .map(|js_string| {
                let string = String::from(&js_string);
                (js_string, string)
            })
            .collect();
        recipients_rust_str.sort_by(|(_, a), (_, b)| a.cmp(b));
        recipients_rust_str
            .into_iter()
            .map(|(js_string, _string)| js_string)
            .collect()
    }
}
