/*
 **************
 * Olm Crypto *
 **************
 */

import Olm from "./olm.js";
import { LocalStorageWrapper } from "../db/localStorageWrapper.js"
import { ServerComm } from "../serverComm/socketIOWrapper.js";

type ciphertextType = string | {
  type: number,
  body: string
};

type otkeysType = {
  string: string
};

type retKeysType = {
  idkey: string,
  otkeys: otkeysType
};

export class OlmWrapper {
  // FIXME what key to use for pickling/unpickling?
  static PICKLE_KEY: string = "secret_key";
  static SLASH     : string = "/";
  static IDKEY     : string = "__idkey";
  static ACCT_KEY  : string = "__account";
  static SESS_KEY  : string = "__session";
  static OUTBOUND  : string = "__outbound";
  static INBOUND   : string = "__inbound";
  static INIT_NUM_OTKEYS: number = 10;
  static MORE_NUM_OTKEYS: number = 5;
  // used by encryptHelper and decryptHelper
  static #selfSessionUseOutbound  : boolean = false;

  #turnEncryptionOff: boolean = false;
  #localStorageWrapper: LocalStorageWrapper;

  constructor(turnEncryptionOff: boolean) {
    this.#turnEncryptionOff = turnEncryptionOff;
    this.#localStorageWrapper = new LocalStorageWrapper();
  }

  async init() {
    await Olm.init({
      locateFile: () => "/olm.wasm",
    });
  }

  getIdkey(): string {
    return this.#localStorageWrapper.get(OlmWrapper.IDKEY);
  }

  #setIdkey(idkey: string) {
    this.#localStorageWrapper.set(OlmWrapper.IDKEY, idkey);
  }

  #getAccount(): Olm.Account {
    // check that account exists
    let pickled: string = this.#localStorageWrapper.get(OlmWrapper.ACCT_KEY);
    if (pickled === null) {
      return null;
    }
    // unpickle and return account
    let acct: Olm.Account = new Olm.Account();
    acct.unpickle(OlmWrapper.PICKLE_KEY, pickled);
    return acct;
  }

  #setAccount(acct: Olm.Account) {
    this.#localStorageWrapper.set(OlmWrapper.ACCT_KEY, acct.pickle(OlmWrapper.PICKLE_KEY));
  }

  #getSessionKey(idkey: string, toggle: boolean = undefined): string {
    if (toggle !== undefined) {
      if (toggle) {
        return OlmWrapper.SESS_KEY + OlmWrapper.SLASH + OlmWrapper.OUTBOUND + OlmWrapper.SLASH + idkey + OlmWrapper.SLASH;
      }
      return OlmWrapper.SESS_KEY + OlmWrapper.SLASH + OlmWrapper.INBOUND + OlmWrapper.SLASH + idkey + OlmWrapper.SLASH;
    }
    return OlmWrapper.SESS_KEY + OlmWrapper.SLASH + idkey + OlmWrapper.SLASH;
  }

  #getSession(idkey: string, toggle: boolean = undefined): Olm.Session {
    // check that session exists
    let pickled: string = this.#localStorageWrapper.get(this.#getSessionKey(idkey, toggle));
    if (pickled === null) {
      return null;
    }
    // unpickle and return session
    let sess: Olm.Session = new Olm.Session();
    sess.unpickle(OlmWrapper.PICKLE_KEY, pickled);
    return sess;
  }

  #setSession(sess: Olm.Session, idkey: string, toggle: boolean = undefined) {
    this.#localStorageWrapper.set(this.#getSessionKey(idkey, toggle), sess.pickle(OlmWrapper.PICKLE_KEY));
  }

  #generateOtkeys(numOtkeys: number): retKeysType {
    let acct: Olm.Account = this.#getAccount();
    if (acct === null) {
      acct = new Olm.Account();
      acct.create();
    }
    acct.generate_one_time_keys(numOtkeys);
    let idkey: string = JSON.parse(acct.identity_keys()).curve25519;
    let otkeys: otkeysType = JSON.parse(acct.one_time_keys()).curve25519;
    acct.mark_keys_as_published();
    this.#setAccount(acct);
    acct.free();
    return {
      idkey: idkey,
      otkeys: otkeys,
    };
  }

  async #createOutboundSession(
      serverComm: ServerComm,
      dstIdkey: string,
      acct: Olm.Account,
      toggle: boolean = undefined
  ): Olm.Session {
    let dstOtkey: string = await serverComm.getOtkeyFromServer(dstIdkey);
    if (!dstOtkey) {
      console.log("dest device has been deleted - no otkey");
      return -1;
    }
    
    let sess: Olm.Session = new Olm.Session();
    sess.create_outbound(acct, dstIdkey, dstOtkey);
    this.#setSession(sess, dstIdkey, toggle);
    return sess;
  }

  #createInboundSession(
      srcIdkey: string,
      body: string,
      toggle: boolean = undefined
  ): Olm.Session {
    let sess: Olm.Session = new Olm.Session();
    let acct: Olm.Account = this.#getAccount();
    if (acct === null) {
      console.log("device is being deleted - no acct");
      sess.free();
      return null;
    }
    sess.create_inbound(acct, body);
    this.#setSession(sess, srcIdkey, toggle);
    acct.free();
    return sess;
  }

  async #encryptHelper(
      serverComm: ServerComm,
      plaintext: string,
      dstIdkey: string
  ): Promise<string> {
    console.log("REAL ENCRYPT -- ");
    console.log(plaintext);
    let toggle = undefined;
    if (dstIdkey === this.getIdkey()) {
      // toggle which session to use (inbound vs outbound) when 
      // encrypting to avoid continuously generating new sessions
      OlmWrapper.#selfSessionUseOutbound = !OlmWrapper.#selfSessionUseOutbound;
      toggle = OlmWrapper.#selfSessionUseOutbound;
    }
    let sess: Olm.Session = this.#getSession(dstIdkey, toggle);
    
    // if sess is null (initiating communication with new device) or 
    // sess does not have a received message => generate new outbound 
    // session
    if (sess === null || !sess.has_received_message()) {
      let acct: Olm.Account = this.#getAccount();
      if (acct === null) {
        console.log("device is being deleted - no acct");
        sess.free();
        return "{}";
      }
      sess = await this.#createOutboundSession(serverComm, dstIdkey, acct, toggle);
      acct.free();
    }

    if (sess === null) {
      console.log("device is being deleted - no sess");
      return "{}";
    } else if (sess === -1) {
      return "{}";
    }
    
    let ciphertext: string = sess.encrypt(plaintext);
    this.#setSession(sess, dstIdkey, toggle);
    sess.free();
    console.log(JSON.parse(plaintext));
    return ciphertext;
  }

  #dummyEncrypt(plaintext: string): string {
    console.log("DUMMY ENCRYPT -- ");
    return plaintext;
  }

  #decryptHelper(
      ciphertext: ciphertextType,
      srcIdkey: string
  ): string {
    console.log("REAL DECRYPT -- ");
    if (typeof ciphertext === 'string') {
      console.log("ciphertext is a string when it should be an object");
      return "";
    }
    let toggle = undefined;
    if (srcIdkey === this.getIdkey()) {
      toggle = !OlmWrapper.#selfSessionUseOutbound;
    }
    let sess: Olm.Session = this.#getSession(srcIdkey, toggle);
    
    // if receiving communication from new device or message was encrypted
    // with a one-time key, generate new inbound session
    if (sess === null || ciphertext.type === 0) {
      sess = this.#createInboundSession(srcIdkey, ciphertext.body, toggle);
      if (sess === null) {
        return "{}";
      }
    }
    
    let plaintext: string = sess.decrypt(ciphertext.type, ciphertext.body);
    this.#setSession(sess, srcIdkey, toggle);
    sess.free();
    console.log(JSON.parse(plaintext));
    return plaintext;
  }

  #dummyDecrypt(ciphertext: string): string {
    console.log("DUMMY DECRYPT -- ");
    return ciphertext;
  }

  async generateInitialKeys(): Promise<string> {
    let { idkey } = this.#generateOtkeys(OlmWrapper.INIT_NUM_OTKEYS);
    this.#setIdkey(idkey);
    return idkey;
  }

  generateMoreOtkeys(needs: number = OlmWrapper.MORE_NUM_OTKEYS): retKeysType {
    return this.#generateOtkeys(needs);
  }

  async encrypt(
      serverComm: ServerComm,
      plaintext: string,
      dstIdkey: string
  ): Promise<string> {
    if (this.#turnEncryptionOff) {
      return this.#dummyEncrypt(plaintext);
    }
    return await this.#encryptHelper(serverComm, plaintext, dstIdkey);
  }

  decrypt(
      ciphertext: ciphertextType,
      srcIdkey: string
  ): string {
    if (this.#turnEncryptionOff && typeof ciphertext === 'string') {
      return this.#dummyDecrypt(ciphertext);
    }
    return this.#decryptHelper(ciphertext, srcIdkey);
  };
}
