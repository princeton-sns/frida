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
const USED_OTKEYS  = "__usedOtkeys";

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

export function setOtkey(idkey, key, otkey) {
  console.log(key);
  db.set(getOtkeyKey(idkey), { key: key, otkey: otkey });
}

function removeOtkey(idkey) {
  db.remove(getOtkeyKey(idkey));
}

function getUsedOtkeys() {
  return db.get(USED_OTKEYS);
}

function setUsedOtkeys(obj) {
  db.set(USED_OTKEYS, obj);
}

export function addUsedOtkey(key, otkey) {
  let usedOtkeys = getUsedOtkeys();
  console.log(usedOtkeys);
  let obj = {
    ...usedOtkeys,
    [key]: otkey,
  };
  console.log(obj);
  setUsedOtkeys(obj);
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
  let otkeyData = getOtkeyHelper(dstIdkey);
  while (otkeyData === null) {
    if (getIdkey() === null) {
      return; // in case device is being deleted
    }
    console.log("~~~~~waiting for otkey");
    await promiseDelay(200);
    otkeyData = getOtkeyHelper(dstIdkey);
  }

  let sess = new Olm.Session();
  sess.create_outbound(acct, dstIdkey, otkeyData.otkey);
  setSession(sess, dstIdkey);
  removeOtkey(dstIdkey);
  return {
    sess: sess,
    key: otkeyData.key,
    otkey: otkeyData.otkey,
  };
}

export function generateOtkeys(numOtkeys) {
  let acct = getAccount();
  //if (acct === null) {
  //  acct = new Olm.Account();
  //  acct.create();
  //}
  acct.generate_one_time_keys(numOtkeys);
  let idkey = db.fromString(acct.identity_keys()).curve25519;
  let otkeys = db.fromString(acct.one_time_keys()).curve25519;
  // FIXME only need to store otkeyKeys right now
  let usedOtkeys = getUsedOtkeys();
  let usedOtkeyKeys = Object.keys(usedOtkeys);
  let otkeyKeys = Object.keys(otkeys);
  let toPublishOtkeyKeys = otkeyKeys.filter((key) => !usedOtkeyKeys.includes(key));
  let toPublishOtkeys = {};
  toPublishOtkeyKeys.forEach((otkeyKey) => {
    toPublishOtkeys[otkeyKey] = otkeys[otkeyKey];
  });
  //setAccount(acct);
  acct.free();
  // TODO mark_keys_as_published
  return {
    //acct: acct,
    idkey: idkey,
    otkeys: toPublishOtkeys,
  };
}

// every device has a set of identity keys and ten sets of one-time keys, the
// public counterparts of which should all be published to the server
export async function generateKeys(dstIdkey) {
  //let { acct, idkey, otkeys } = generateOtkeys(5);
  let acct = new Olm.Account();
  acct.create();
  acct.generate_one_time_keys(4);
  // TODO mark_keys_as_published
  setAccount(acct);

  let idkey = db.fromString(acct.identity_keys()).curve25519;
  let otkeys = db.fromString(acct.one_time_keys()).curve25519;

  setIdkey(idkey);
  addDevice({ idkey, otkeys });
  connectDevice(idkey);

  // linking with another device; create outbound session
  let outboundRes;
  if (dstIdkey !== null) {
    console.log("in generateKeys");
    console.log(dstIdkey);
    outboundRes = await createOutboundSession(idkey, dstIdkey, acct);
    //let { sess, key, otkey } = await createOutboundSession(idkey, dstIdkey, acct);
    console.log("USED OTKEY");
    console.log(outboundRes.key);
    console.log(outboundRes.otkey);
    // free in-mem session
    outboundRes.sess.free();
  }

  // free in-mem account
  acct.free();

  // TODO keep track of number of otkeys left on the server

  return {
    idkey: idkey,
    key: outboundRes?.key ?? null,
    otkey: outboundRes?.otkey ?? null,
  };
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
    let acct = getAccount();
    let { sess_, key, otkey } = await createOutboundSession(getIdkey(), dstIdkey, acct);
    sess = sess_;
    console.log("USED OTKEY");
    console.log(key);
    console.log(otkey);
    plaintext = {
      ...plaintext,
      otkeyKey: key,
      otkeyUsed: otkey,
    };
    // free in-mem account
    acct.free();
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
  // TODO remove_one_time_keys seems to remove all of them
  // client should keep track of which ones to NOT send to 
  // the server when more are generated
  // the complexity of this will increase as time goes on though
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

  let plaintext = db.fromString(sess.decrypt(ciphertext.type, ciphertext.body));
  if (plaintext.otkeyUsed !== null) {
    console.log(plaintext.otkeyKey);
    console.log(plaintext.otkeyUsed);
    addUsedOtkey(plaintext.otkeyKey, plaintext.otkeyUsed);
  }
  setSession(sess, srcIdkey);
  // free in-mem session
  sess.free();

  console.log(ciphertext);
  console.log(plaintext);
  return plaintext;
}

function dummyDecrypt(ciphertext) {
  console.log("DUMMY DECRYPT -- ");
  return ciphertext;
}
