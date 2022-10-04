/*
 **********
 * Crypto *
 **********
 */

import libsodium from "libsodium-wrappers";

// FIXME 'await libsodium.ready;' never called -- why does this still work?
const sodium = libsodium;

// returns hex keypair
export function generateKeypair() {
  let keypair = sodium.crypto_box_keypair();
  return {
    pubkey: sodium.to_hex(keypair.publicKey),
    privkey: sodium.to_hex(keypair.privateKey),
  };
}

export function encrypt(
  dstPubkey,
  srcPrivkey,
  plaintext,
  turnEncryptionOff) {
  if (!turnEncryptionOff) {
    return encryptHelper(
      sodium.from_hex(dstPubkey),
      sodium.from_hex(srcPrivkey),
      sodium.from_string(plaintext)
    );
  }
  return dummyEncrypt(
    sodium.from_string(plaintext)
  );
}

function encryptHelper(
  dstPubkey,
  srcPrivkey,
  plaintext) {
  // generate one-time nonce
  let nonce = sodium.randombytes_buf(
    sodium.crypto_box_NONCEBYTES
  );
  // encrypt message
  let ciphertext = sodium.crypto_box_easy(
    plaintext,
    nonce,
    dstPubkey,
    srcPrivkey
  );
  return {
    ciphertext: sodium.to_hex(ciphertext),
    nonce: sodium.to_hex(nonce),
  };
}

function dummyEncrypt(plaintext) {
  return {
    ciphertext: sodium.to_hex(plaintext),
    nonce: sodium.to_hex(new Uint8Array(24).fill(0)),
  };
}

export function decrypt(
  ciphertext,
  nonce,
  srcPubkey,
  dstPrivkey,
  turnEncryptionOff) {
  if (!turnEncryptionOff) {
    return sodium.to_string(
      decryptHelper(
        sodium.from_hex(ciphertext),
        sodium.from_hex(nonce),
        sodium.from_hex(srcPubkey),
        sodium.from_hex(dstPrivkey)
      )
    );
  }
  return sodium.to_string(
    dummyDecrypt(
      sodium.from_hex(ciphertext)
    )
  );
}

function decryptHelper(
  ciphertext,
  nonce,
  srcPubkey,
  dstPrivkey) {
  // decrypt message
  let plaintext = sodium.crypto_box_open_easy(
    ciphertext,
    nonce,
    srcPubkey,
    dstPrivkey
  );
  return plaintext;
}

function dummyDecrypt(ciphertext) {
  return ciphertext;
}

