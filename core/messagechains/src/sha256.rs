#[derive(Debug, Clone, PartialOrd, Ord, PartialEq, Eq, Hash)]
pub struct Sha256MessageDigest(pub [u8; 32]);

impl crate::MessageDigest for Sha256MessageDigest {}

pub struct Sha256MessageHasher<D: crate::DeviceId>(sha2::Sha256, std::marker::PhantomData<D>);

impl<D: crate::DeviceId> Sha256MessageHasher<D> {
    pub fn new() -> Self {
        use sha2::Digest;

        Sha256MessageHasher(sha2::Sha256::new(), std::marker::PhantomData)
    }
}

impl<D: crate::DeviceId> crate::MessageHasher<D> for Sha256MessageHasher<D> {
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
