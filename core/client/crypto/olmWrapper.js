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

const initNumOtkeys = 10;
const moreNumOtkeys = 5;

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
  // check that account exists
  let pickled = db.get(ACCT_KEY);
  if (pickled === null) {
    return null;
  }
  // unpickle and return account
  let acctLoc = new Olm.Account();
  acctLoc.unpickle(PICKLE_KEY, pickled);
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
  // unpickle and return session
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

  console.log("OTKEY FOR NEW SESSION");
  console.log(srcIdkey);
  console.log(dstIdkey);
  console.log(dstOtkey);

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
  console.log(dstIdkey);
  console.log(sess);

  // if sess is null, initiating communication with new device; create outbound session
  // if sess does not have a received message, generate a newsession
  if (sess === null || !sess.has_received_message()) {
    let acct = getAccount();
    if (acct === null) {
      console.log("device is being deleted - no acct");
      sess.free();
      return "{}";
    }
    console.log("NEW OUTBOUND SESSION CREATED");
    sess = await createOutboundSession(getIdkey(), dstIdkey, acct);
    // free in-mem account
    acct.free();
  }
  console.log(sess);
  console.log(sess.describe());
  console.log(sess.session_id());
  console.log(sess.has_received_message());

  if (sess === null) {
    console.log("device is being deleted - no sess");
    return "{}";
  }
  let ciphertext = sess.encrypt(plaintext);
  setSession(sess, dstIdkey);
  // free in-mem session
  sess.free();

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
  console.log(srcIdkey);
  console.log(sess);
  console.log(ciphertext);

  // if receiving communication from new device; create inbound session
  // if receiving communication from device that has already sent a message but have not yet replied,
  // create a new inbound session (b/c sending device has also created a new outbound session
  // from a new otkey due to no response)
  if (sess !== null) {
    console.log(sess.matches_inbound_from(srcIdkey, ciphertext));
    console.log(sess.describe());
    console.log(sess.session_id());
  }
  if (sess === null) { // || !sess.matches_inbound_from(srcIdkey, ciphertext)) { // FIXME matches_inbound
    sess = new Olm.Session();
    let acct = getAccount();
    if (acct === null) {
      console.log("device is being deleted - no acct");
      sess.free();
      return "{}";
    }
    console.log("NEW INBOUND SESSION CREATED");
    sess.create_inbound_from(acct, srcIdkey, ciphertext.body);
    console.log(sess.matches_inbound_from(srcIdkey, ciphertext));
    // free in-mem account
    acct.free();
  } //else if (!sess.matches_inbound_from(srcIdkey, ciphertext)) {}
  console.log(sess);
  console.log(sess.matches_inbound_from(srcIdkey, ciphertext));
  console.log(sess.describe());
  console.log(sess.session_id());

  if (sess === null) {
    console.log("device is being deleted - no sess");
    return "{}";
  }

  console.log(ciphertext);
  let plaintext;
  try {
    plaintext = sess.decrypt(ciphertext.type, ciphertext.body);
  } catch (err) {
    console.log(err);
    sess.free();
    sess = new Olm.Session();
    let acct = getAccount();
    if (acct === null) {
      console.log("device is being deleted");
      sess.free();
      return "{}";
    }
    console.log("NEW INBOUND SESSION IN CATCH");
    sess.create_inbound_from(acct, srcIdkey, ciphertext.body);
    console.log(sess.matches_inbound_from(srcIdkey, ciphertext));
    // free in-mem account
    acct.free();

    plaintext = sess.decrypt(ciphertext.type, ciphertext.body);
  }

  console.log(sess.has_received_message());
  setSession(sess, srcIdkey);
  // free in-mem session
  sess.free();

  console.log(db.fromString(plaintext));
  console.log(ciphertext);
  return plaintext;
}

function dummyDecrypt(ciphertext) {
  console.log("DUMMY DECRYPT -- ");
  return ciphertext;
}
