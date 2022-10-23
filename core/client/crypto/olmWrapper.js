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

const initNumOtkeys = 4;
const moreNumOtkeys = 2;

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
  let pickledAcct = db.get(ACCT_KEY);
  if (pickledAcct !== null) {
    let acctLoc = new Olm.Account();
    acctLoc.unpickle(PICKLE_KEY, pickledAcct);
    return acctLoc;
  }
  return null;
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

  // polling FIXME use listener
  let dstOtkey = getOtkeyHelper(dstIdkey);
  while (dstOtkey === null) {
    console.log("~~~~~waiting for otkey");
    await promiseDelay(200);
    // in case device is being deleted
    if (getIdkey() === null) {
      return;
    }
    dstOtkey = getOtkeyHelper(dstIdkey);
  }

  let sess = new Olm.Session();
  sess.create_outbound(acct, dstIdkey, dstOtkey);
  setSession(sess, dstIdkey);
  removeOtkey(dstIdkey);
  return sess;
}

function generateOtkeys(numOtkeys) {
  let acct = getAccount();
  if (acct === null) {
    acct = new Olm.Account();
    acct.create();
  }
  acct.generate_one_time_keys(numOtkeys);
  let idkey = db.fromString(acct.identity_keys()).curve25519;
  let otkeys = db.fromString(acct.one_time_keys()).curve25519;
  acct.mark_keys_as_published();
  setAccount(acct);

  // free in-mem acct
  acct.free();
  return {
    idkey: idkey,
    otkeys: otkeys,
  };
}

// every device has one set of identity keys and several sets of one-time keys, the
// public counterparts of which should all be published to the server
export async function generateKeys() {
  let { idkey, otkeys } = generateOtkeys(initNumOtkeys);
  setIdkey(idkey);
  addDevice({ idkey, otkeys });
  connectDevice(idkey);
  // TODO keep track of number of otkeys left on the server?
  // server currently notifies but want to trust it?
  return idkey;
}

export function generateMoreOtkeys() {
  return generateOtkeys(moreNumOtkeys);
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

  // if sess is null, initiating communication with new device; create outbound session
  // if sess does not have a received message, generate a newsession
  if (sess === null || !sess.has_received_message()) {
    let acct = getAccount();
    sess = await createOutboundSession(getIdkey(), dstIdkey, acct);
    // free in-mem account
    acct.free();
  }

  let ciphertext = sess.encrypt(plaintext);
  setSession(sess, dstIdkey);
  // free in-mem session
  sess.free();

  console.log(db.fromString(plaintext));
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
    let acct = getAccount();
    sess.create_inbound(acct, ciphertext.body);
    // free in-mem account
    acct.free();
    setSession(sess, srcIdkey);
  }

  let plaintext = sess.decrypt(ciphertext.type, ciphertext.body);
  setSession(sess, srcIdkey);
  // free in-mem session
  sess.free();

  console.log(db.fromString(plaintext));
  return plaintext;
}

function dummyDecrypt(ciphertext) {
  console.log("DUMMY DECRYPT -- ");
  return ciphertext;
}
