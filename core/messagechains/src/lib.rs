use std::collections::HashMap;
use std::collections::VecDeque;
use std::fmt::Debug;
use std::hash::Hash;

use log;

pub mod sha256;
pub mod wasm_wrapper;

/// Generic device ID
pub trait DeviceId: Sized + Hash + Eq + Ord + Clone + Debug + AsRef<[u8]> {}

/// Blanket implementation of the [`DeviceId`] type for [`String`]
impl DeviceId for String {}

/// Generic wrapper over a cryptographic message digest
pub trait MessageDigest: Sized + Hash + Eq + Ord + Clone + Debug + Default {}

/// Blanket implementation of the [`MessageDigest`] type for [`String`]
impl MessageDigest for String {}

pub trait MessageHasher<D: DeviceId> {
    type Output: MessageDigest;

    fn hash_message<'a, BD: std::borrow::Borrow<D>>(
        &'a mut self,
        prev_digest: Option<&Self::Output>,
        recipients: &mut impl Iterator<Item = BD>,
        message: &[u8],
    ) -> Self::Output
    where
        D: 'a;
}

pub struct MessageChains<D: DeviceId, H: MessageHasher<D>> {
    own_device: D,
    pending_messages: VecDeque<H::Output>,
    chains: HashMap<D, (usize, VecDeque<H::Output>)>,
    hasher: H,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    TooFewRecipients,
    MissingSelfRecipient,
    InvalidRecipientsOrder,
    InvariantViolated,
    OwnMessageInvalidReordered,
}

// TODO: Implement quorum for message.
impl<D: DeviceId, H: MessageHasher<D>> MessageChains<D, H> {
    pub fn new(own_device: D, hasher: H) -> Self {
        let mut pending_messages = VecDeque::new();
        pending_messages.push_back(H::Output::default());

        MessageChains {
            own_device,
            pending_messages,
            chains: HashMap::new(),
            hasher,
        }
    }

    pub fn send_message<BD: std::borrow::Borrow<D>>(
        &mut self,
        message: &[u8],
        mut recipients: impl Iterator<Item = BD>,
    ) {
        let message_hash_entry = self.hasher.hash_message(
            Some(self.pending_messages.back().unwrap()),
            &mut recipients,
            message,
        );

        self.pending_messages.push_back(message_hash_entry);
    }

    pub fn insert_message<BD: std::borrow::Borrow<D>>(
        &mut self,
        sender: &D,
        message: &[u8],
        mut recipients: impl Iterator<Item = BD>,
    ) -> Result<(), Error> {
        use std::borrow::Borrow;

        // Validate that the recipients list is sorted as defined by
        // the [`Ord`] trait, as well as that we've seen our own
        // device as part of the recipients.
        //
        // Because we need the iterator below as well, we collect into
        // an intermediate vector. This could potentially be
        // optimized.
        let mut recipients_vec: Vec<BD> = Vec::new();
        let (recipients_count, acc) =
            recipients.try_fold((0, None), |(count, acc): (usize, Option<(D, bool)>), r| {
                let new_acc = if let Some((prev_recipient, seen_self)) = acc {
                    if *prev_recipient.borrow() >= *r.borrow() {
                        println!(
                            "Invalid recipients order: {:?} >= {:?}",
                            *prev_recipient.borrow(),
                            *r.borrow()
                        );
                        Err(Error::InvalidRecipientsOrder)?
                    } else {
                        Some((
                            r.borrow().clone(),
                            seen_self || *r.borrow() == self.own_device,
                        ))
                    }
                } else {
                    Some((r.borrow().clone(), *r.borrow() == self.own_device))
                };

                recipients_vec.push(r);

                Ok((count + 1, new_acc))
            })?;

        // The message must go to at least one recipient (ourselves):
        if recipients_count < 1 {
            return Err(Error::TooFewRecipients);
        }

        // Now that we are sure to have executed the fold lambda
        // twice, the accumulator must have a non-None value:
        let (_, seen_self) = acc.unwrap();

        // Our own device ID was not found in the recipient list, this
        // is invalid:
        if !seen_self {
            return Err(Error::MissingSelfRecipient);
        }

        // If this message was sent by us, ensure that it matches the
        // head of the pending_messages queue. If it does not, the
        // server must have reordered it or changed its contents or
        // recipients:
        if *sender == self.own_device {
            // We must have at least two elements in the VecDeque: the
            // base hash and the resulting (expected) message hash.
            let mut pending_messages_iter = self.pending_messages.iter();
            let base_hash = pending_messages_iter.next().unwrap();
            let expected_hash = pending_messages_iter
                .next()
                .ok_or(Error::OwnMessageInvalidReordered)?;

            let calculated_hash = self.hasher.hash_message(
                Some(base_hash),
                &mut recipients_vec.iter().map(|r| r.borrow()),
                message,
            );

            if *expected_hash != calculated_hash {
                return Err(Error::OwnMessageInvalidReordered);
            }

            self.pending_messages.pop_front();
        }

        // Hash the message in the context of all its recipient's
        // pairwise hash-chains:
        for r in recipients_vec
            .iter()
            .filter(|r| *Borrow::<D>::borrow(*r) != self.own_device)
        {
            let (_, ref mut recipient_chain) = self
                .chains
                .entry(r.borrow().clone())
                .or_insert_with(|| (0, VecDeque::new()));

            let message_hash_entry = self.hasher.hash_message(
                recipient_chain.back(),
                &mut recipients_vec.iter().map(|r| r.borrow()),
                message,
            );

            recipient_chain.push_back(message_hash_entry);
        }

        Ok(())
    }

    pub fn validate_chain(
        &self,
        validation_sender: impl std::borrow::Borrow<D>,
        validation_payload: Option<(usize, impl std::borrow::Borrow<H::Output>)>,
    ) -> Result<(), Error> {
        log::trace!(
            "validate_chain(validation_sender: {:?}, validation_payload: {:?})",
            validation_sender.borrow(),
            validation_payload
                .as_ref()
                .map(|(seq, hash)| (*seq, hash.borrow())),
        );

        // We must never send a validation payload to ourselves and
        // hence can never use a loopback-message to trim any hash
        // chains:
        if *validation_sender.borrow() == self.own_device {
            assert!(validation_payload.is_none());
            return Ok(());
        }

        // TODO: error if validation payload is none unexpectedly (we should've
        // received a validation payload but didn't)
        let (seq, hash) = match validation_payload {
            None => {
                return Ok(());
            }
            Some((seq, hash)) => (seq, hash),
        };

        // If this validation payload comes from a sender we haven't interacted
        // with, an invariant has been violated:
        let (ref pairwise_chain_offset, ref pairwise_chain) =
            self.chains.get(validation_sender.borrow()).ok_or_else(|| {
                log::debug!(
                    "validate_chain: invariant violated - validation payload \
                     from unknown sender ({:?})",
                    validation_sender.borrow(),
                );
                Error::InvariantViolated
            })?;

        // If this refers to a sequence number we don't know yet, or have
        // already trimmed, the sender or server has violated an invariant:
        if seq < *pairwise_chain_offset || seq >= (pairwise_chain_offset + pairwise_chain.len()) {
            log::debug!(
                "validate_chain: invariant violated - validation payload \
                 sent by {:?} refers to invalid sequence number {}. Valid \
                 sequence numbers are within [{}; {})",
                validation_sender.borrow(),
                seq,
                pairwise_chain_offset,
                pairwise_chain_offset + pairwise_chain.len()
            );
            return Err(Error::InvariantViolated);
        }

        // The referenced sequence number is in the range of locally kept
        // sequence number for the sender, thus check whether the hashes match
        // at this entry:
        println!(
            "{:?}: Validating {}, {:?} vs {:?}",
            self.own_device,
            seq,
            &pairwise_chain[seq - pairwise_chain_offset],
            hash.borrow(),
        );
        if pairwise_chain[seq - pairwise_chain_offset] != *hash.borrow() {
            log::debug!(
                "validate_chain: invariant violated - validation payload \
                 sent by {:?} features incorrect hash for sequence number {}: \
                 expected {:?} vs. actual {:?}",
                validation_sender.borrow(),
                seq,
                pairwise_chain[seq - pairwise_chain_offset],
                hash.borrow(),
            );
            return Err(Error::InvariantViolated);
        }

        // All checks passed, this validation payload is valid in the context of
        // the local chain:
        Ok(())
    }

    pub fn validate_trim_chain(
        &mut self,
        validation_sender: impl std::borrow::Borrow<D>,
        validation_payload: Option<(usize, impl std::borrow::Borrow<H::Output>)>,
    ) -> Result<usize, Error> {
        // First, validate whether this validation payload should be
        // accepted. This also validates that, if this is a
        // loopback-message from our own device, we must never have a
        // validation payload and hence never trim any chains below:
        self.validate_chain(
            validation_sender.borrow(),
            validation_payload
                .as_ref()
                .map(|(seq, hash)| (*seq, hash.borrow())),
        )?;

        // Trim the hash-chains:
        if let Some((seq, _hash)) = validation_payload {
            let (ref mut pairwise_chain_offset, ref mut pairwise_chain) =
                self.chains.get_mut(validation_sender.borrow()).unwrap();

            // All checks passed, we can trim the chain up to (but excluding) the
            // referenced sequence number:
            let mut trimmed = 0;
            while *pairwise_chain_offset < seq {
                trimmed += 1;
                *pairwise_chain_offset += 1;
                pairwise_chain.pop_front();
            }

            Ok(trimmed)
        } else {
            Ok(0)
        }
    }

    pub fn validation_payload(&self, recipient: &D) -> Option<(usize, H::Output)> {
        self.chains
            .get(recipient)
            .and_then(|(recipient_chain_offset, recipient_chain)| {
                recipient_chain.back().map(|hash| {
                    (
                        recipient_chain_offset + recipient_chain.len() - 1,
                        hash.clone(),
                    )
                })
            })
    }
}

#[cfg(test)]
mod test {
    use crate::sha256::{Sha256MessageDigest, Sha256MessageHasher};

    #[derive(Debug, Clone, PartialOrd, Ord, PartialEq, Eq, Hash)]
    struct U64DeviceId([u8; 8]);

    impl U64DeviceId {
        pub fn new(id: u64) -> Self {
            U64DeviceId(u64::to_be_bytes(id))
        }
    }

    impl AsRef<[u8]> for U64DeviceId {
        fn as_ref(&self) -> &[u8] {
            &self.0
        }
    }

    impl super::DeviceId for U64DeviceId {}

    struct TestDeviceState {
        pub id: U64DeviceId,
        pub chains: super::MessageChains<U64DeviceId, Sha256MessageHasher<U64DeviceId>>,
    }

    impl TestDeviceState {
        pub fn new(device_id: u64) -> TestDeviceState {
            let device_id = U64DeviceId::new(device_id);
            TestDeviceState {
                id: device_id.clone(),
                chains: super::MessageChains::new(device_id.clone(), Sha256MessageHasher::new()),
            }
        }
    }

    fn two_devices_base() -> (TestDeviceState, TestDeviceState) {
        let mut dev_a = TestDeviceState::new(0);
        let mut dev_b = TestDeviceState::new(1);

        // For most exchanged messages, we can use the same recipients list:
        let mut recipients_a_b = [&dev_a.id, &dev_b.id];
        recipients_a_b.sort();

        // Now, let a send a message to b. A should have no validation
        // payload to send to Bob.
        let message_a_b_0 = "Hi Bob!".as_bytes(); // message 0
        assert!(dev_a.chains.validation_payload(&dev_b.id).is_none());
        dev_a
            .chains
            .send_message(message_a_b_0, recipients_a_b.iter().map(|r| *r));

        // Bob receives the message.
        dev_b
            .chains
            .validate_trim_chain(&dev_b.id, None::<(usize, &Sha256MessageDigest)>)
            .unwrap();
        dev_b
            .chains
            .insert_message(&dev_a.id, message_a_b_0, recipients_a_b.iter().map(|r| *r))
            .unwrap();

        // Alice also needs to receive her own message:
        dev_b
            .chains
            .validate_trim_chain(&dev_a.id, None::<(usize, &Sha256MessageDigest)>)
            .unwrap();
        dev_a
            .chains
            .insert_message(&dev_a.id, message_a_b_0, recipients_a_b.iter().map(|r| *r))
            .unwrap();

        // Let's have Bob reply to Alice's message. He should have a validation
        // payload ready to send along the message now:
        let message_b_a_0 = "Hey Alice, how are you?".as_bytes(); // message 1
        let message_b_a_0_vp = dev_b.chains.validation_payload(&dev_a.id).unwrap();
        assert!(message_b_a_0_vp.0 == 0); // validation payload refers to message 0
        dev_b
            .chains
            .send_message(message_b_a_0, recipients_a_b.iter().map(|r| *r));

        // Bob receives his own message.
        let trimmed = dev_b
            .chains
            .validate_trim_chain(&dev_b.id, None::<(usize, &Sha256MessageDigest)>)
            .unwrap();
        assert!(trimmed == 0);
        dev_b
            .chains
            .insert_message(&dev_b.id, message_b_a_0, recipients_a_b.iter().map(|r| *r))
            .unwrap();

        // Alice receives Bob's reply, along with the validation
        // payload. Validate the message (must not trim anything yet) and insert
        // it:
        let trimmed = dev_a
            .chains
            .validate_trim_chain(&dev_b.id, Some((message_b_a_0_vp.0, &message_b_a_0_vp.1)))
            .unwrap();
        assert!(trimmed == 0);
        dev_a
            .chains
            .insert_message(&dev_b.id, message_b_a_0, recipients_a_b.iter().map(|r| *r))
            .unwrap();

        // Alice answers Bob's message:
        let message_a_b_1 = "I'm good, thanks for asking!".as_bytes(); // message 2
        let message_a_b_1_vp = dev_a.chains.validation_payload(&dev_b.id).unwrap();
        assert!(message_a_b_1_vp.0 == 1); // validation payload refers to message 1
        dev_a
            .chains
            .send_message(message_a_b_1, recipients_a_b.iter().map(|r| *r));

        // Alice receives her own message:
        let trimmed = dev_a
            .chains
            .validate_trim_chain(&dev_a.id, None::<(usize, &Sha256MessageDigest)>)
            .unwrap();
        assert!(trimmed == 0);
        dev_a
            .chains
            .insert_message(&dev_a.id, message_a_b_1, recipients_a_b.iter().map(|r| *r))
            .unwrap();

        // Bob validates and receives Alice's message (this should trim the
        // inital message from Bob's pairwise chain with Alice):
        let trimmed = dev_b
            .chains
            .validate_trim_chain(&dev_a.id, Some((message_a_b_1_vp.0, &message_a_b_1_vp.1)))
            .unwrap();
        assert!(trimmed == 1);
        dev_b
            .chains
            .insert_message(&dev_a.id, message_a_b_1, recipients_a_b.iter().map(|r| *r))
            .unwrap();

        (dev_a, dev_b)
    }

    #[test]
    fn test_two_devices_base() {
        two_devices_base();
    }

    #[test]
    fn test_two_devices_dropped_message() {
        let (mut dev_a, mut dev_b) = two_devices_base();

        // All messages are intended to be received by both recipients:
        let mut recipients_a_b = [&dev_a.id, &dev_b.id];
        recipients_a_b.sort();

        // Alice sends two messages (concurrently) to Bob, but the server does
        // not deliver the first one to Bob

        // message 3 for Alice
        let message_1 = "Hey Bob, please ignore the contents of the next message:".as_bytes();
        let message_1_vp = dev_a.chains.validation_payload(&dev_b.id).unwrap();
        assert!(message_1_vp.0 == 2); // validation payload refers to message 2
        dev_a
            .chains
            .send_message(message_1, recipients_a_b.iter().map(|r| *r));

        let message_2 = "We're no longer friends.".as_bytes(); // message 4 for Alice, 3 for Bob
        let message_2_vp = dev_a.chains.validation_payload(&dev_b.id).unwrap();
        assert!(message_1_vp.0 == 2); // validation payload refers to message 2
        dev_a
            .chains
            .send_message(message_2, recipients_a_b.iter().map(|r| *r));

        // Alice receives both messages in order:
        let trimmed = dev_a
            .chains
            .validate_trim_chain(&dev_a.id, None::<(usize, &Sha256MessageDigest)>)
            .unwrap();
        assert!(trimmed == 0);
        dev_a
            .chains
            .insert_message(&dev_a.id, message_1, recipients_a_b.iter().map(|r| *r))
            .unwrap();
        let trimmed = dev_a
            .chains
            .validate_trim_chain(&dev_a.id, None::<(usize, &Sha256MessageDigest)>)
            .unwrap();
        assert!(trimmed == 0);
        dev_a
            .chains
            .insert_message(&dev_a.id, message_2, recipients_a_b.iter().map(|r| *r))
            .unwrap();

        // Bob recieves only the second message. He can't yet detect that
        // something fishy is going on, as Alice sent both messages concurrently
        // and couldn't reference message_1 in message_2's validation
        // payload. Instead, he's able to successfully trim a prior message from
        // his chain:
        let trimmed = dev_b
            .chains
            .validate_trim_chain(&dev_a.id, Some((message_2_vp.0, &message_2_vp.1)))
            .unwrap();
        assert!(trimmed == 1);
        dev_b
            .chains
            .insert_message(&dev_a.id, message_2, recipients_a_b.iter().map(|r| *r))
            .unwrap();

        // Now, Bob send's Alice a message (message 4 for Bob, 5 for Alice)
        let message_3 = "What have I done to you?".as_bytes();
        let message_3_vp = dev_b.chains.validation_payload(&dev_a.id).unwrap();
        assert!(message_3_vp.0 == 3); // validation payload refers to message 3 (from Bob's perspective)
        dev_b
            .chains
            .send_message(message_3, recipients_a_b.iter().map(|r| *r));

        // Bob recieves his own message back:
        let trimmed = dev_b
            .chains
            .validate_trim_chain(&dev_b.id, None::<(usize, &Sha256MessageDigest)>)
            .unwrap();
        assert!(trimmed == 0);
        dev_b
            .chains
            .insert_message(&dev_b.id, message_3, recipients_a_b.iter().map(|r| *r))
            .unwrap();

        // Alice recieves Bob's message and should be able to realize that
        // there's something going on: Bob's validation payload doesn't make
        // sense from Alice's point of view:
        assert!(
            dev_a
                .chains
                .validate_trim_chain(&dev_b.id, Some((message_3_vp.0, &message_3_vp.1)))
                == Err(super::Error::InvariantViolated)
        );
    }
}
