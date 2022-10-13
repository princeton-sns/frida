/*
 **********
 * Crypto *
 **********
 */

import Olm from "./olm.js";
import { db } from "../index.js";

// FIXME what key to use for pickling/unpickling?
const PICKLE_KEY = "secret_key";

const SLASH = "/";
export const IDKEY = "__idkey";
const OTKEYS = "__otkeys";
const ACCT_KEY = "__account";
const SESS_KEY = "__session";

export async function init() {
  await Olm.init({
    locateFile: () => "/olm.wasm",
  });
}

function getAccount() {
  let acctLoc = new Olm.Account();
  acctLoc.unpickle(PICKLE_KEY, db.get(ACCT_KEY));
  return acctLoc;
}

function setAccount(acctLoc) {
  db.set(ACCT_KEY, acctLoc.pickle(PICKLE_KEY));
}

function getSessionKey(id) {
  return SESS_KEY + SLASH + id + SLASH;
}

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

export function getIdkey() {
  return db.get(IDKEY);
}

function setIdkey(idkey) {
  db.set(IDKEY, idkey);
}

//function getOtkeys() {
//  return db.get(OTKEYS);
//}

function setOtkeys(otkeys) {
  db.set(OTKEYS, otkeys);
}

// every device has a set of identity keys and one-time keys, the public
// one of each should be published to the server
export function generateKeys(dstIdkey, dstOtkey) {
  let acct = new Olm.Account();
  acct.create();
  acct.generate_one_time_keys(1);
  setAccount(acct);

  let idkey = db.fromString(acct.identity_keys()).curve25519;
  setIdkey(idkey);

  let otkeys = db.fromString(acct.one_time_keys()).curve25519;
  setOtkeys(otkeys);

  // linking with another device; create outbound session
  if (dstIdkey !== null && dstOtkey !== null) {
    let session = new Olm.Session();
    session.create_outbound(acct, dstIdkey, dstOtkey);
    setSession(session, dstIdkey);
    // send dstIdkey own otkey to create inbound session
  }

  // TODO sign idkey and otkeys
  // keep track of number of otkeys left on the server
  return {
    idkey: idkey,
    otkeys: otkeys,
  };
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
  //if (sess === null) {
  //  console.log("sess for " + dstIdkey + " is null");
  //  sess = new Olm.Session();
  //  let acct = getAccount();
  //  // TODO create outbound(?) session
  //  sess.create_outbound(acct, dstIdkey, dstOtkey);
  //}
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
