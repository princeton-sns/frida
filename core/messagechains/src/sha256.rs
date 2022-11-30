use crate::DeviceId;

#[derive(Debug, Clone, PartialOrd, Ord, PartialEq, Eq, Hash)]
pub struct Sha256MessageDigest(pub [u8; 32]);

impl crate::MessageDigest for Sha256MessageDigest {}

impl Default for Sha256MessageDigest {
    fn default() -> Self {
        Sha256MessageDigest([0; 32])
    }
}

pub struct Sha256MessageHasher(sha2::Sha256);

impl Sha256MessageHasher {
    pub fn new() -> Self {
        use sha2::Digest;

        Sha256MessageHasher(sha2::Sha256::new())
    }
}

impl crate::MessageHasher for Sha256MessageHasher {
    type Output = Sha256MessageDigest;

    fn hash_message<'a, BD: std::borrow::Borrow<DeviceId>>(
        &'a mut self,
        prev_digest: Option<&Self::Output>,
        recipients: &mut impl Iterator<Item = BD>,
        message: &[u8],
    ) -> Self::Output {
        use sha2::Digest;

        if let Some(digest) = prev_digest {
            self.0.update(b"prev");
            self.0.update(&digest.0);
        } else {
            self.0.update(b"no_prev");
        }

        for (i, r) in recipients.enumerate() {
            self.0.update(&u64::to_be_bytes(i as u64));
            self.0.update(r.borrow().as_bytes());
        }

        self.0.update(b"message");
        self.0.update(message);

        let mut digest: [u8; 32] = [0; 32];
        self.0.finalize_into_reset((&mut digest).into());
        Sha256MessageDigest(digest)
    }
}
