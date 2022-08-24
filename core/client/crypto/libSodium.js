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

export function signAndEncrypt(
  dstPubkey,
  srcPrivkey,
  plaintext) {
  return _signAndEncrypt(
    sodium.from_hex(dstPubkey),
    sodium.from_hex(srcPrivkey),
    sodium.from_string(plaintext)
  );
}

function _signAndEncrypt(
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

export function decryptAndVerify(
  ciphertext,
  nonce,
  srcPubkey,
  dstPrivkey) {
  return sodium.to_string(
    _decryptAndVerify(
      sodium.from_hex(ciphertext),
      sodium.from_hex(nonce),
      sodium.from_hex(srcPubkey),
      sodium.from_hex(dstPrivkey)
    )
  );
}

function _decryptAndVerify(
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

