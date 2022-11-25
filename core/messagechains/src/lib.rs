use std::collections::HashMap;
use std::collections::VecDeque;
use std::fmt::Debug;
use std::hash::Hash;

use log;

/// Generic device ID
pub trait DeviceId: Sized + Hash + Eq + Ord + Clone + Debug + AsRef<[u8]> {}

/// Generic wrapper over a cryptographic message digest
pub trait MessageDigest: Sized + Hash + Eq + Ord + Clone + Debug {}

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
    chains: HashMap<D, (usize, VecDeque<H::Output>)>,
    hasher: H,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    TooFewRecipients,
    MissingSelfRecipient,
    InvalidRecipientsOrder,
    InvariantViolated,
}

impl<D: DeviceId, H: MessageHasher<D>> MessageChains<D, H> {
    pub fn new(own_device: D, hasher: H) -> Self {
        MessageChains {
            own_device,
            chains: HashMap::new(),
            hasher,
        }
    }

    fn insert_message(
        &mut self,
        message: &[u8],
        recipients: &[impl std::borrow::Borrow<D>],
    ) -> Result<(), Error> {
        use std::borrow::Borrow;

        // The message must go to at least two recipients (ourselves
        // and some other device, where it either originates from us
        // or that other device):
        if recipients.len() < 2 {
            return Err(Error::TooFewRecipients);
        }

        // Validate that the recipients list is sorted as defined by
        // the [`Ord`] trait, as well as that we've seen our own
        // device as part of the recipients.
        let (_, seen_self) = recipients
            .iter()
            .try_fold(None, |acc: Option<(D, bool)>, r| {
                if let Some((prev_recipient, seen_self)) = acc {
                    if *prev_recipient.borrow() >= *r.borrow() {
                        println!(
                            "Invalid recipients order: {:?} >= {:?}",
                            *prev_recipient.borrow(),
                            *r.borrow()
                        );
                        Err(Error::InvalidRecipientsOrder)
                    } else {
                        Ok(Some((
                            r.borrow().clone(),
                            seen_self || *r.borrow() == self.own_device,
                        )))
                    }
                } else {
                    Ok(Some((r.borrow().clone(), *r.borrow() == self.own_device)))
                }
            })?
            .unwrap();

        // Our own device ID was not found in the recipient list, this
        // is invalid:
        if !seen_self {
            return Err(Error::MissingSelfRecipient);
        }

        // Hash the message in the context of all its recipient's
        // pairwise hash-chains:
        for r in recipients
            .iter()
            .filter(|r| *Borrow::<D>::borrow(*r) != self.own_device)
        {
            let (ref recipient_chain_offset, ref mut recipient_chain) = self
                .chains
                .entry(r.borrow().clone())
                .or_insert_with(|| (0, VecDeque::new()));

            let message_hash_entry = self.hasher.hash_message(
                recipient_chain.back(),
                &mut recipients.iter().map(|r| r.borrow()),
                message,
            );

            recipient_chain.push_back(message_hash_entry);
        }

        Ok(())
    }

    fn validate_chain(
        &self,
        validation_sender: &D,
        seq: usize,
        hash: &H::Output,
    ) -> Result<(), Error> {
        log::trace!(
            "validate_chain(validation_sender: {:?}, seq: {}, hash: {:?})",
            validation_sender,
            seq,
            hash,
        );

        // If this validation payload comes from a sender we haven't interacted
        // with, an invariant has been violated:
        let (ref pairwise_chain_offset, ref pairwise_chain) =
            self.chains.get(validation_sender).ok_or_else(|| {
                log::debug!(
                    "validate_chain: invariant violated - validation payload \
		     from unknown sender ({:?})",
                    validation_sender
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
                validation_sender,
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
            hash
        );
        if pairwise_chain[seq - pairwise_chain_offset] != *hash {
            log::debug!(
                "validate_chain: invariant violated - validation payload \
		 sent by {:?} features incorrect hash for sequence number {}: \
		 expected {:?} vs. actual {:?}",
                validation_sender,
                seq,
                pairwise_chain[seq - pairwise_chain_offset],
                hash,
            );
            return Err(Error::InvariantViolated);
        }

        // All checks passed, this validation payload is valid in the context of
        // the local chain:
        Ok(())
    }

    fn validate_trim_chain(
        &mut self,
        validation_sender: &D,
        seq: usize,
        hash: &H::Output,
    ) -> Result<usize, Error> {
        // This method cannot be used for messages sent by us:
        assert!(*validation_sender != self.own_device);

        // First, validate whether this validation payload should be
        // accepted.
        self.validate_chain(validation_sender, seq, hash)?;

        let (ref mut pairwise_chain_offset, ref mut pairwise_chain) =
            self.chains.get_mut(validation_sender).unwrap();

        // All checks passed, we can trim the chain up to (but excluding) the
        // referenced sequence number:
        let mut trimmed = 0;
        while *pairwise_chain_offset < seq {
            trimmed += 1;
            *pairwise_chain_offset += 1;
            pairwise_chain.pop_front();
        }

        Ok(trimmed)
    }

    fn validation_payload(&self, recipient: &D) -> Option<(usize, H::Output)> {
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
    #[derive(Debug, Clone, PartialOrd, Ord, PartialEq, Eq, Hash)]
    struct U64DeviceId([u8; 8]);

    impl U64DeviceId {
        pub fn new(id: u64) -> Self {
            U64DeviceId(u64::to_be_bytes(id))
        }

        pub fn get(&self) -> u64 {
            u64::from_be_bytes(self.0)
        }
    }

    impl AsRef<[u8]> for U64DeviceId {
        fn as_ref(&self) -> &[u8] {
            &self.0
        }
    }

    impl super::DeviceId for U64DeviceId {}

    #[derive(Debug, Clone, PartialOrd, Ord, PartialEq, Eq, Hash)]
    struct Sha256MessageDigest(pub [u8; 32]);

    impl super::MessageDigest for Sha256MessageDigest {}

    struct Sha256MessageHasher<D: super::DeviceId>(sha2::Sha256, std::marker::PhantomData<D>);

    impl<D: super::DeviceId> Sha256MessageHasher<D> {
        pub fn new() -> Self {
            use sha2::Digest;

            Sha256MessageHasher(sha2::Sha256::new(), std::marker::PhantomData)
        }
    }

    impl<D: super::DeviceId> super::MessageHasher<D> for Sha256MessageHasher<D> {
        type Output = Sha256MessageDigest;

        fn hash_message<'a, BD: std::borrow::Borrow<D>>(
            &'a mut self,
            prev_digest: Option<&Self::Output>,
            recipients: &mut impl Iterator<Item = BD>,
            message: &[u8],
        ) -> Self::Output
        where
            D: 'a,
        {
            use sha2::Digest;

            if let Some(digest) = prev_digest {
                self.0.update(&[b'p', b'r', b'e', b'v']);
                self.0.update(&digest.0);
            } else {
                self.0.update(&[b'n', b'o', b'_', b'p', b'r', b'e', b'v']);
            }

            for (i, r) in recipients.enumerate() {
                self.0.update(&u64::to_be_bytes(i as u64));
                self.0.update(<D as AsRef<[u8]>>::as_ref(r.borrow()));
            }

            self.0.update(&[b'm', b'e', b's', b's', b'a', b'g', b'e']);
            self.0.update(message);

            let mut digest: [u8; 32] = [0; 32];
            self.0.finalize_into_reset((&mut digest).into());
            Sha256MessageDigest(digest)
        }
    }

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
        use super::MessageChains;

        let mut dev_a = TestDeviceState::new(0);
        let mut dev_b = TestDeviceState::new(1);

        // For most exchanged messages, we can use the same recipients list:
        let mut recipients_a_b = [&dev_a.id, &dev_b.id];
        recipients_a_b.sort();

        // Now, let a send a message to b. A should have no validation
        // payload to send to Bob.
        let message_a_b_0 = "Hi Bob!".as_bytes(); // message 0
        assert!(dev_a.chains.validation_payload(&dev_b.id).is_none());

        // Bob receives the message.
        //
        // TODO: Bob should validate that he doesn't know of any other messages
        // exchanged between him and Alice.
        dev_b
            .chains
            .insert_message(message_a_b_0, &recipients_a_b)
            .unwrap();

        // Alice also needs to receive her own message:
        //
        // TODO: Alice should verify that she receives her own messages in
        // order!
        dev_a
            .chains
            .insert_message(message_a_b_0, &recipients_a_b)
            .unwrap();

        // Let's have Bob reply to Alice's message. He should have a validation
        // payload ready to send along the message now:
        let message_b_a_0 = "Hey Alice, how are you?".as_bytes(); // message 1
        let message_b_a_0_vp = dev_b.chains.validation_payload(&dev_a.id).unwrap();
        assert!(message_b_a_0_vp.0 == 0); // validation payload refers to message 0

        // Bob receives his own message. TODO: validate that it was received in
        // order.
        dev_b
            .chains
            .insert_message(message_b_a_0, &recipients_a_b)
            .unwrap();

        // Alice receives Bob's reply, along with the validation
        // payload. Validate the message (must not trim anything yet) and insert
        // it:
        let trimmed = dev_a
            .chains
            .validate_trim_chain(&dev_b.id, message_b_a_0_vp.0, &message_b_a_0_vp.1)
            .unwrap();
        assert!(trimmed == 0);
        dev_a
            .chains
            .insert_message(message_b_a_0, &recipients_a_b)
            .unwrap();

        // Alice answers Bob's message:
        let message_a_b_1 = "I'm good, thanks for asking!".as_bytes(); // message 2
        let message_a_b_1_vp = dev_a.chains.validation_payload(&dev_b.id).unwrap();
        assert!(message_a_b_1_vp.0 == 1); // validation payload refers to message 1

        // Alice receives her own message:
        dev_a
            .chains
            .insert_message(message_a_b_1, &recipients_a_b)
            .unwrap();

        // Bob validates and receives Alice's message (this should trim the
        // inital message from Bob's pairwise chain with Alice):
        let trimmed = dev_b
            .chains
            .validate_trim_chain(&dev_a.id, message_a_b_1_vp.0, &message_a_b_1_vp.1)
            .unwrap();
        assert!(trimmed == 1);
        dev_b
            .chains
            .insert_message(message_a_b_1, &recipients_a_b)
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

        let message_2 = "We're no longer friends.".as_bytes(); // message 4 for Alice, 3 for Bob
        let message_2_vp = dev_a.chains.validation_payload(&dev_b.id).unwrap();
        assert!(message_1_vp.0 == 2); // validation payload refers to message 2

        // Alice receives both messages in order:
        dev_a
            .chains
            .insert_message(message_1, &recipients_a_b)
            .unwrap();
        dev_a
            .chains
            .insert_message(message_2, &recipients_a_b)
            .unwrap();

        // Bob recieves only the second message. He can't yet detect that
        // something fishy is going on, as Alice sent both messages concurrently
        // and couldn't reference message_1 in message_2's validation
        // payload. Instead, he's able to successfully trim a prior message from
        // his chain:
        assert!(
            Ok(1)
                == dev_b
                    .chains
                    .validate_trim_chain(&dev_a.id, message_2_vp.0, &message_2_vp.1)
        );
        dev_b
            .chains
            .insert_message(message_2, &recipients_a_b)
            .unwrap();

        // Now, Bob send's Alice a message (message 4 for Bob, 5 for Alice)
        let message_3 = "Hey, why don't you want to be friends any more?".as_bytes();
        let message_3_vp = dev_b.chains.validation_payload(&dev_a.id).unwrap();
        assert!(message_3_vp.0 == 3); // validation payload refers to message 3 (from Bob's perspective)

        // Bob recieves his own message back:
        dev_b
            .chains
            .insert_message(message_3, &recipients_a_b)
            .unwrap();

        // Alice recieves Bob's message and should be able to realize that
        // there's something going on: Bob's validation payload doesn't make
        // sense from Alice's point of view:
        assert!(
            dev_a
                .chains
                .validate_trim_chain(&dev_b.id, message_3_vp.0, &message_3_vp.1)
                == Err(super::Error::InvariantViolated)
        );
    }
}
