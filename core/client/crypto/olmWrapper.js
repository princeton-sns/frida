/*
 **************
 * Olm Crypto *
 **************
 */

import Olm from "./olm.js";
import { db } from "../index.js";

function Internal() {
  // FIXME what key to use for pickling/unpickling?
  this.PICKLE_KEY    = "secret_key";
  this.SLASH         = "/";
  this.IDKEY         = "__idkey";
  this.ACCT_KEY      = "__account";
  this.SESS_KEY      = "__session";
}

Internal.prototype.getSessionKey = function(idkey) {
  return this.SESS_KEY + this.SLASH + idkey + this.SLASH;
};

Internal.prototype.getIdkey = function() {
  return db.get(this.IDKEY);
};

Internal.prototype.setIdkey = function(idkey) {
  db.set(this.IDKEY, idkey);
};

Internal.prototype.getAccount = function() {
  // check that account exists
  let pickled = db.get(this.ACCT_KEY);
  if (pickled === null) {
    return null;
  }
  // unpickle and return account
  let acct = new Olm.Account();
  acct.unpickle(this.PICKLE_KEY, pickled);
  return acct;
};

Internal.prototype.setAccount = function(acct) {
  db.set(this.ACCT_KEY, acct.pickle(this.PICKLE_KEY));
};

Internal.prototype.getSession = function(idkey) {
  // check that session exists
  let pickled = db.get(this.getSessionKey(idkey));
  if (pickled === null) {
    return null;
  }
  // unpickle and return session
  let sess = new Olm.Session();
  sess.unpickle(this.PICKLE_KEY, pickled);
  return sess;
};

Internal.prototype.setSession = function(sess, idkey) {
  db.set(this.getSessionKey(idkey), sess.pickle(this.PICKLE_KEY));
};

Internal.prototype.generateOtkeys = function(numOtkeys) {
  let acct = this.getAccount();
  if (acct === null) {
    acct = new Olm.Account();
    acct.create();
  }
  acct.generate_one_time_keys(numOtkeys);
  let idkey = db.fromString(acct.identity_keys()).curve25519;
  let otkeys = db.fromString(acct.one_time_keys()).curve25519;
  acct.mark_keys_as_published();
  this.setAccount(acct);
  acct.free();
  return {
    idkey: idkey,
    otkeys: otkeys,
  };
};

Internal.prototype.createOutboundSession = async function(serverComm, dstIdkey, acct) {
  let dstOtkey = await serverComm.getOtkeyFromServer(dstIdkey);
  if (!dstOtkey) {
    console.log("dest device has been deleted - no otkey");
    return -1;
  }
  
  let sess = new Olm.Session();
  sess.create_outbound(acct, dstIdkey, dstOtkey);
  this.setSession(sess, dstIdkey);
  return sess;
};

Internal.prototype.createInboundSession = function(srcIdkey, body) {
  let sess = new Olm.Session();
  let acct = this.getAccount();
  if (acct === null) {
    console.log("device is being deleted - no acct");
    sess.free();
    return null;
  }
  sess.create_inbound(acct, body);
  acct.free();
  return sess;
};

Internal.prototype.encryptHelper = async function(serverComm, plaintext, dstIdkey) {
  console.log("REAL ENCRYPT -- ");
  console.log(plaintext);
  let sess = this.getSession(dstIdkey);
  
  // if sess is null (initiating communication with new device) or 
  // sess does not have a received message => generate new outbound 
  // session
  if (sess === null || !sess.has_received_message()) {
    let acct = this.getAccount();
    if (acct === null) {
      console.log("device is being deleted - no acct");
      sess.free();
      return "{}";
    }
    sess = await this.createOutboundSession(serverComm, dstIdkey, acct);
    acct.free();
  }
  
  if (sess === null) {
    console.log("device is being deleted - no sess");
    return "{}";
  } else if (sess === -1) {
    return "{}";
  }
  
  let ciphertext = sess.encrypt(plaintext);
  this.setSession(sess, dstIdkey);
  sess.free();
  console.log(db.fromString(plaintext));
  return ciphertext;
};

Internal.prototype.dummyEncrypt = function(plaintext) {
  console.log("DUMMY ENCRYPT -- ");
  return plaintext;
};
  
Internal.prototype.decryptHelper = function(ciphertext, srcIdkey) {
  console.log("REAL DECRYPT -- ");
  let sess = this.getSession(srcIdkey);
  
  // if receiving communication from new device or message was encrypted
  // with a one-time key, generate new inbound session
  if (sess === null || ciphertext.type === 0) {
    sess = this.createInboundSession(srcIdkey, ciphertext.body);
    if (sess === null) {
      return "{}";
    }
  }
  
  let plaintext = sess.decrypt(ciphertext.type, ciphertext.body);
  this.setSession(sess, srcIdkey);
  sess.free();
  console.log(db.fromString(plaintext));
  return plaintext;
};
  
Internal.prototype.dummyDecrypt = function(ciphertext) {
  console.log("DUMMY DECRYPT -- ");
  return ciphertext;
};
  
export function OlmCrypto() {
  const initNumOtkeys = 10;
  const moreNumOtkeys = 5;

  let internal = new Internal();

  this.getIdkey = () => internal.getIdkey();

  this.generateInitialKeys = async function() {
    let { idkey } = internal.generateOtkeys(initNumOtkeys);
    internal.setIdkey(idkey);
    return idkey;
  };

  this.generateMoreOtkeys = function(needs = moreNumOtkeys) {
    return internal.generateOtkeys(needs);
  };

  this.encrypt = async function(serverComm, plaintext, dstIdkey, turnEncryptionOff) {
    if (!turnEncryptionOff) {
      return await internal.encryptHelper(serverComm, plaintext, dstIdkey);
    }
    return internal.dummyEncrypt(plaintext);
  };

  this.decrypt = function(ciphertext, srcIdkey, turnEncryptionOff) {
    if (!turnEncryptionOff) {
      return internal.decryptHelper(ciphertext, srcIdkey);
    }
    return internal.dummyDecrypt(ciphertext);
  };
}

OlmCrypto.prototype.init = async function() {
  await Olm.init({
    locateFile: () => "/olm.wasm",
  });
}
