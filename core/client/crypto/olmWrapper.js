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

/* Promise Helpers */

function promiseDelay(delay) {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

/* Core Crypto Functions */

async function createOutboundSession(srcIdkey, dstIdkey, acct) {
  getOtkey({ srcIdkey: srcIdkey, dstIdkey: dstIdkey });

  // poll FIXME what's a better way to do this?
  let dstOtkey = getOtkeyHelper(dstIdkey);
  while (dstOtkey === null) {
    if (getIdkey() === null) {
      return; // in case device is being deleted
    }
    console.log("~~~~~waiting for otkey");
    await promiseDelay(200);
    dstOtkey = getOtkeyHelper(dstIdkey);
  }

  let sess = new Olm.Session();
  sess.create_outbound(acct, dstIdkey, dstOtkey);
  setSession(sess, dstIdkey);
  removeOtkey(dstIdkey);
  return sess;
}

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
    console.log("in generateKeys");
    console.log(dstIdkey);
    await createOutboundSession(idkey, dstIdkey, acct);
  }

  // TODO sign idkey and otkeys
  // keep track of number of otkeys left on the server
  return idkey;
}

export async function encrypt(plaintext, dstIdkey, turnEncryptionOff) {
  if (!turnEncryptionOff) {
    return await encryptHelper(plaintext, dstIdkey);
  }
  return dummyEncrypt(plaintext);
}

async function encryptHelper(plaintext, dstIdkey) {
  console.log("REAL ENCRYPT -- ");
  let sess = getSession(dstIdkey);

  // initiating communication with new device; create outbound session
  if (sess === null) {
    console.log("in encryptHelper");
    console.log(dstIdkey);
    sess = await createOutboundSession(getIdkey(), dstIdkey, getAccount());
  }
  let ciphertext = sess.encrypt(plaintext);
  console.log(db.fromString(plaintext));
  console.log(ciphertext);
  return ciphertext;
}

function dummyEncrypt(plaintext) {
  console.log("DUMMY ENCRYPT -- ");
  return plaintext;
}

export function decrypt(ciphertext, srcIdkey, turnEncryptionOff) {
  if (!turnEncryptionOff) {
    return decryptHelper(ciphertext, srcIdkey);
  }
  return dummyDecrypt(ciphertext);
}

function decryptHelper(ciphertext, srcIdkey) {
  console.log("REAL DECRYPT -- ");
  let sess = getSession(srcIdkey);
  // receiving communication from new device; create inbound session
  if (sess === null) {
    sess = new Olm.Session();
    sess.create_inbound(getAccount(), ciphertext.body);
    setSession(sess, srcIdkey);
  }
  let plaintext = sess.decrypt(ciphertext.type, ciphertext.body);
  console.log(ciphertext);
  console.log(db.fromString(plaintext));
  return db.fromString(plaintext);
}

function dummyDecrypt(ciphertext) {
  console.log("DUMMY DECRYPT -- ");
  return ciphertext;
}
