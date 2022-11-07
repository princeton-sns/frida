/*
 **************
 * Olm Crypto *
 **************
 */

import Olm from "./olm.js";
import { db } from "../index.js";
//import { getOtkeyFromServer } from "../serverComm/socketIOWrapper.js";

export function OlmCrypto() {
  // FIXME what key to use for pickling/unpickling?
  const PICKLE_KEY    = "secret_key";
  const SLASH         = "/";
  const IDKEY         = "__idkey";
  const ACCT_KEY      = "__account";
  const OTKEY_KEY     = "__otkey";
  const SESS_KEY      = "__session";
  const initNumOtkeys = 10;
  const moreNumOtkeys = 5;

  /* Storage Key Helpers */

  let getStorageKey = (prefix, id) => prefix + SLASH + id + SLASH;
  let getSessionKey = (id) => getStorageKey(SESS_KEY, id);
  let getOtkeyKey = (id) => getStorageKey(OTKEY_KEY, id);

  /* Idkey Helpers */

  this.getIdkey = function() {
    return db.get(IDKEY);
  };

  let setIdkey = (value) => db.set(IDKEY, value);

  /* Otkey Helpers */
  
  //let setOtkey = (idkey, otkey) => db.set(getOtkeyKey(idkey), otkey);
  let removeOtkey = (idkey) => db.remove(getOtkeyKey(idkey));

  /* Account Helpers */
  
  let getAccount = () => {
    // check that account exists
    let pickled = db.get(ACCT_KEY);
    if (pickled === null) {
      return null;
    }
    // unpickle and return account
    let acctLoc = new Olm.Account();
    acctLoc.unpickle(PICKLE_KEY, pickled);
    return acctLoc;
  };
  
  let setAccount = (acctLoc) => db.set(ACCT_KEY, acctLoc.pickle(PICKLE_KEY));

  /* Session Helpers */
  
  let getSession = (dstIdkey) => {
    // check that session exists
    let pickled = db.get(getSessionKey(dstIdkey));
    if (pickled === null) {
      return null;
    }
    // unpickle and return session
    let sessLoc = new Olm.Session();
    sessLoc.unpickle(PICKLE_KEY, pickled);
    return sessLoc;
  };
  
  let setSession = (sessLoc, dstIdkey) => db.set(getSessionKey(dstIdkey), sessLoc.pickle(PICKLE_KEY));

  /* Core OlmCrypto Functions */

  // every device has one set of identity keys and several sets of 
  // one-time keys, the public counterparts of which should all be 
  // published to the server
  this.generateInitialKeys = async function() {
    let { idkey } = generateOtkeys(initNumOtkeys);
    setIdkey(idkey);
    return idkey;
  };

  let createOutboundSession = async (serverComm, dstIdkey, acct) => {
    console.log(serverComm);
    let dstOtkey = await serverComm.getOtkeyFromServer(dstIdkey);
    if (!dstOtkey) {
      console.log("dest device has been deleted - no otkey");
      return -1;
    }
  
    let sess = new Olm.Session();
    sess.create_outbound(acct, dstIdkey, dstOtkey);
    setSession(sess, dstIdkey);
    removeOtkey(dstIdkey);
    return sess;
  };

  let createInboundSession = (srcIdkey, ciphertextBody) => {
    let sess = new Olm.Session();
    let acct = getAccount();
    if (acct === null) {
      console.log("device is being deleted - no acct");
      sess.free();
      return null;
    }
    sess.create_inbound(acct, ciphertextBody);
    acct.free();
    return sess;
  };

  let generateOtkeys = (numOtkeys) => {
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
  };

  this.generateMoreOtkeys = function(needs = moreNumOtkeys) {
    return generateOtkeys(needs);
  };

  this.encrypt = async function(serverComm, plaintext, dstIdkey, turnEncryptionOff) {
    if (!turnEncryptionOff) {
      return await encryptHelper(serverComm, plaintext, dstIdkey);
    }
    return dummyEncrypt(plaintext);
  };

  let encryptHelper = async (serverComm, plaintext, dstIdkey) => {
    console.log("REAL ENCRYPT -- ");
    console.log(plaintext);
    let sess = getSession(dstIdkey);
  
    // if sess is null (initiating communication with new device) or 
    // sess does not have a received message => generate new outbound 
    // session
    if (sess === null || !sess.has_received_message()) {
      let acct = getAccount();
      if (acct === null) {
        console.log("device is being deleted - no acct");
        sess.free();
        return "{}";
      }
      sess = await createOutboundSession(serverComm, dstIdkey, acct);
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
  };

  let dummyEncrypt = (plaintext) => {
    console.log("DUMMY ENCRYPT -- ");
    return plaintext;
  };
  
  this.decrypt = function(ciphertext, srcIdkey, turnEncryptionOff) {
    if (!turnEncryptionOff) {
      return decryptHelper(ciphertext, srcIdkey);
    }
    return dummyDecrypt(ciphertext);
  };
  
  let decryptHelper = (ciphertext, srcIdkey) => {
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
  };
  
  let dummyDecrypt = (ciphertext) => {
    console.log("DUMMY DECRYPT -- ");
    return ciphertext;
  };
}

OlmCrypto.prototype.init = async function() {
  await Olm.init({
    locateFile: () => "/olm.wasm",
  });
}

