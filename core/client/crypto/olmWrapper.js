/*
 **********
 * Crypto *
 **********
 */

import Olm from "./olm.js";

export async function init() {
  await Olm.init({
    locateFile: () => "/olm.wasm",
  });
}

// every device has a set of identity keys and one-time keys, the public
// one of each should be published to the server
export function generateKeys(numOTKeys = 1) {
  let device = new Olm.Account();
  device.create();
  device.generate_one_time_keys(numOTKeys);
  return {
    device: device,
    idkey: JSON.parse(device.identity_keys()).curve25519,
    otkeys: JSON.parse(device.one_time_keys()).curve25519,
  };
}

export function encrypt(plaintext, turnEncryptionOff) {
  if (!turnEncryptionOff) {
    return encryptHelper(plaintext);
  }
  return dummyEncrypt(plaintext);
}

function encryptHelper(plaintext) {
  console.log("REAL ENCRYPT");
  console.log("not implemented");
  console.log(plaintext);
}

function dummyEncrypt(plaintext) {
  console.log("DUMMY ENCRYPT");
  console.log(plaintext);
  return {
    ciphertext: plaintext,
    nonce: 0,
  };
}

export function decrypt(ciphertext, turnEncryptionOff) {
  if (!turnEncryptionOff) {
    return decryptHelper(ciphertext);
  }
  return dummyDecrypt(ciphertext);
}

function decryptHelper(ciphertext) {
  console.log("REAL DECRYPT");
  console.log("not implemented");
  console.log(ciphertext);
}

function dummyDecrypt(ciphertext) {
  console.log("DUMMY DECRYPT");
  console.log(ciphertext);
  return ciphertext;
}
