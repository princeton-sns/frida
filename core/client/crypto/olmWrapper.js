/*
 **********
 * Crypto *
 **********
 */

import Olm from "./olm.js";
import { db } from "../index.js";
import { getOtkey, addDevice, connectDevice } from "../index.js";

// FIXME what key to use for pickling/unpickling?
const PICKLE_KEY = "secret_key";

const SLASH = "/";
/* for self */
export const IDKEY = "__idkey";
const ACCT_KEY     = "__account";
/* for others */
const OTKEY        = "__otkey";
const SESS_KEY     = "__session";

export async function init() {
  await Olm.init({
    locateFile: () => "/olm.wasm",
  });
}

/* Storage Key Helpers */

function getStorageKey(prefix, id) {
  return prefix + SLASH + id + SLASH;
}

function getSessionKey(id) {
  return getStorageKey(SESS_KEY, id);
}

function getOtkeyKey(id) {
  return getStorageKey(OTKEY, id);
}

/* Account Helpers */

function getAccount() {
  let acctLoc = new Olm.Account();
  acctLoc.unpickle(PICKLE_KEY, db.get(ACCT_KEY));
  return acctLoc;
}

function setAccount(acctLoc) {
  db.set(ACCT_KEY, acctLoc.pickle(PICKLE_KEY));
}

/* Session Helpers */

function getSession(dstIdkey) {
  // check that session exists
  let pickled = db.get(getSessionKey(dstIdkey));
  if (pickled === null) {
    return null;
  }
  // get relevant session
  let sessLoc = new Olm.Session();
  sessLoc.unpickle(PICKLE_KEY, pickled);
  return sessLoc;
}

function setSession(sessLoc, dstIdkey) {
  db.set(getSessionKey(dstIdkey), sessLoc.pickle(PICKLE_KEY));
}

/* Idkey Helpers */

export function getIdkey() {
  return db.get(IDKEY);
}

function setIdkey(idkey) {
  db.set(IDKEY, idkey);
}

/* Otkey Helpers */

function getOtkeyHelper(idkey) {
  return db.get(getOtkeyKey(idkey));
}

export function setOtkey(idkey, otkey) {
  db.set(getOtkeyKey(idkey), otkey);
}

function removeOtkey(idkey) {
  db.remove(getOtkeyKey(idkey));
}

/* Promise Helper */

function promiseDelay(delay) {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

/* Core Crypto Functions */

// every device has a set of identity keys and ten sets of one-time keys, the
// public counterparts of which should all be published to the server
export async function generateKeys(dstIdkey) {
  let acct = new Olm.Account();
  acct.create();
  acct.generate_one_time_keys(10);
  setAccount(acct);

  let idkey = db.fromString(acct.identity_keys()).curve25519;
  let otkeys = db.fromString(acct.one_time_keys()).curve25519;
  setIdkey(idkey);
  addDevice({ idkey, otkeys });
  connectDevice(idkey);

  // linking with another device; create outbound session
  if (dstIdkey !== null) {
    getOtkey({ srcIdkey: idkey, dstIdkey: dstIdkey });
    let session = new Olm.Session();

    // poll FIXME what's a better way to do this?
    let dstOtkey = getOtkeyHelper(dstIdkey);
    while (dstOtkey === null) {
      await promiseDelay(200);
      dstOtkey = getOtkeyHelper(dstIdkey);
    }

    session.create_outbound(acct, dstIdkey, dstOtkey);
    setSession(session, dstIdkey);
    removeOtkey(dstIdkey);
  }

  // TODO sign idkey and otkeys
  // keep track of number of otkeys left on the server
  return idkey;
}

export function encrypt(plaintext, dstIdkey, turnEncryptionOff) {
  if (!turnEncryptionOff) {
    return encryptHelper(plaintext, dstIdkey);
  }
  return dummyEncrypt(plaintext);
}

function encryptHelper(plaintext, dstIdkey) {
  console.log("REAL ENCRYPT -- ");
  console.log(db.fromString(plaintext));
  console.log(dstIdkey);
  let sess = getSession(dstIdkey);
  if (sess === null) {
    console.log("sess for " + dstIdkey + " is null");
    sess = new Olm.Session();
    //let acct = getAccount();
    // TODO how to get dstOtkey
    //sess.create_outbound(acct, dstIdkey, dstOtkey);
  }
  let ciphertext = sess.encrypt(plaintext);
  console.log(ciphertext);
  return {
    ciphertext: ciphertext,
  };
}

function dummyEncrypt(plaintext) {
  console.log("DUMMY ENCRYPT -- ");
  console.log(db.fromString(plaintext));
  return {
    ciphertext: plaintext,
  };
}

export function decrypt(ciphertext, srcIdkey, turnEncryptionOff) {
  if (!turnEncryptionOff) {
    return decryptHelper(ciphertext, srcIdkey);
  }
  return dummyDecrypt(ciphertext);
}

function decryptHelper(ciphertext, srcIdkey) {
  console.log("REAL DECRYPT -- ");
  console.log(ciphertext);
  let sess = getSession(srcIdkey);
  if (sess === null) {
    console.log("sess for " + srcIdkey + " is null");
    sess = new Olm.Session();
    let acct = getAccount();
    // TODO create inbound session
    sess.create_inbound(acct, ciphertext.body);
    setSession(sess, srcIdkey);
  }
  console.log(sess);
  let plaintext = sess.decrypt(ciphertext.type, ciphertext.body);
  console.log(db.fromString(plaintext));
  return db.fromString(plaintext);
}

function dummyDecrypt(ciphertext) {
  console.log("DUMMY DECRYPT -- ");
  console.log(db.fromString(ciphertext));
  return ciphertext;
}
