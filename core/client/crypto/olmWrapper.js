/*
 **********
 * Crypto *
 **********
 */

import Olm from "./olm.js";
import { db } from "../index.js";
import { getOtkeyFromServer, addDevice, connectDevice } from "../index.js";

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

function getOtkey(idkey) {
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
  getOtkeyFromServer({ srcIdkey: srcIdkey, dstIdkey: dstIdkey });

  // polling FIXME use listener
  let dstOtkey = getOtkey(dstIdkey);
  while (dstOtkey === null) {
    console.log("~~~~~waiting for otkey");
    await promiseDelay(200);
    // in case device is being deleted
    if (getIdkey() === null) {
      console.log("device is being deleted - no idkey");
      return;
    }
    dstOtkey = getOtkey(dstIdkey);
  }
  if (dstOtkey === "") {
    console.log("dest device has been deleted - no otkey");
    return -1;
  }

  let sess = new Olm.Session();
  sess.create_outbound(acct, dstIdkey, dstOtkey);
  setSession(sess, dstIdkey);
  removeOtkey(dstIdkey);
  return sess;
}

function createInboundSession(srcIdkey, ciphertextBody) {
  let sess = new Olm.Session();
  let acct = getAccount();
  if (acct === null) {
    console.log("device is being deleted - no acct");
    sess.free();
    return null;
  }
  sess.create_inbound_from(acct, srcIdkey, ciphertextBody);
  acct.free();
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
  acct.free();
  return {
    idkey: idkey,
    otkeys: otkeys,
  };
}

// every device has one set of identity keys and several sets of one-time keys,
// the public counterparts of which should all be published to the server
export async function generateKeys() {
  let { idkey, otkeys } = generateOtkeys(initNumOtkeys);
  setIdkey(idkey);
  addDevice({ idkey, otkeys });
  connectDevice(idkey);
  // TODO keep track of number of otkeys left on the server?
  // server currently notifies but may not want to trust it to do that
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
  console.log(plaintext);
  let sess = getSession(dstIdkey);

  // if sess is null (initiating communication with new device) or sess does not
  // have a received message => generate new outbound session
  if (sess === null || !sess.has_received_message()) {
    let acct = getAccount();
    if (acct === null) {
      console.log("device is being deleted - no acct");
      sess.free();
      return "{}";
    }
    sess = await createOutboundSession(getIdkey(), dstIdkey, acct);
    acct.free();
  }

  if (sess === null) {
    console.log("device is being deleted - no sess");
    return "{}";
  } else if (sess === -1) {
    return "{}";
  }

  let ciphertext = sess.encrypt(plaintext);
  setSession(sess, dstIdkey);
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

  // if receiving communication from new device or message was encrypted with
  // a one-time key, generate new inbound session
  if (sess === null || ciphertext.type === 0) {
    sess = createInboundSession(srcIdkey, ciphertext.body);
    if (sess === null) {
      return "{}";
    }
  }

  let plaintext = sess.decrypt(ciphertext.type, ciphertext.body);
  setSession(sess, srcIdkey);
  sess.free();
  console.log(db.fromString(plaintext));
  return plaintext;
}

function dummyDecrypt(ciphertext) {
  console.log("DUMMY DECRYPT -- ");
  return ciphertext;
}
