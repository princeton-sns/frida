/*
 **************
 * Olm Crypto *
 **************
 */

import Olm from "./olm.js";
import { ServerComm } from "./serverComm.js";

// TODO can eventually make data abstraction module use these basic methods
class ThinLSWrapper {
  constructor() {}

  set(key: string, value: any) {
    localStorage.setItem(
      key,
      JSON.stringify(value)
    );
  }

  get(key: string): any {
    return JSON.parse(localStorage.getItem(key));
  }

  remove(key: string) {
    localStorage.removeItem(key);
  }

  clear() {
    localStorage.clear();
  }
}

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
  static EMU1      : string = "__emu1";
  static EMU2      : string = "__emu2";
  static INIT_NUM_OTKEYS: number = 10;
  static MORE_NUM_OTKEYS: number = 5;

  // used to emulate two session endpoints within this single device
  // (when a device sends an encrypted message to itself)
  #selfSessionUseEmu1 : boolean = true;
  #useEmu1Queue: boolean[] = [];
  #selfFirstDecrypt: boolean = false;

  #turnEncryptionOff: boolean = false;
  #thinLSWrapper: ThinLSWrapper;

  constructor(turnEncryptionOff: boolean) {
    this.#turnEncryptionOff = turnEncryptionOff;
    this.#thinLSWrapper = new ThinLSWrapper();
  }

  async init() {
    await Olm.init({
      locateFile: () => "/olm.wasm",
    });
  }

  getIdkey(): string {
    return this.#thinLSWrapper.get(OlmWrapper.IDKEY);
  }

  #setIdkey(idkey: string) {
    this.#thinLSWrapper.set(OlmWrapper.IDKEY, idkey);
  }

  #getAccount(): Olm.Account {
    // check that account exists
    let pickled: string = this.#thinLSWrapper.get(OlmWrapper.ACCT_KEY);
    if (pickled === null) {
      return null;
    }
    // unpickle and return account
    let acct: Olm.Account = new Olm.Account();
    acct.unpickle(OlmWrapper.PICKLE_KEY, pickled);
    return acct;
  }

  #setAccount(acct: Olm.Account) {
    this.#thinLSWrapper.set(OlmWrapper.ACCT_KEY, acct.pickle(OlmWrapper.PICKLE_KEY));
  }

  #getSessionKey(idkey: string, toggle: boolean = undefined): string {
    console.log(toggle);
    if (toggle !== undefined) {
      if (toggle) {
        console.log(OlmWrapper.SESS_KEY + OlmWrapper.SLASH + OlmWrapper.EMU1 + OlmWrapper.SLASH + idkey + OlmWrapper.SLASH);
        return OlmWrapper.SESS_KEY + OlmWrapper.SLASH + OlmWrapper.EMU1 + OlmWrapper.SLASH + idkey + OlmWrapper.SLASH;
      }
      console.log(OlmWrapper.SESS_KEY + OlmWrapper.SLASH + OlmWrapper.EMU2 + OlmWrapper.SLASH + idkey +  OlmWrapper.SLASH);
      return OlmWrapper.SESS_KEY + OlmWrapper.SLASH + OlmWrapper.EMU2 + OlmWrapper.SLASH + idkey + OlmWrapper.SLASH;
    }
    console.log(OlmWrapper.SESS_KEY + OlmWrapper.SLASH + idkey + OlmWrapper.SLASH);
    return OlmWrapper.SESS_KEY + OlmWrapper.SLASH + idkey + OlmWrapper.SLASH;
  }

  #getSession(idkey: string, toggle: boolean = undefined): Olm.Session {
    console.log("GETTING session");
    // check that session exists
    let pickled: string = this.#thinLSWrapper.get(this.#getSessionKey(idkey, toggle));
    if (pickled === null) {
      return null;
    }
    // unpickle and return session
    let sess: Olm.Session = new Olm.Session();
    sess.unpickle(OlmWrapper.PICKLE_KEY, pickled);
    return sess;
  }

  #setSession(sess: Olm.Session, idkey: string, toggle: boolean = undefined) {
    console.log("SETTING session");
    this.#thinLSWrapper.set(this.#getSessionKey(idkey, toggle), sess.pickle(OlmWrapper.PICKLE_KEY));
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
    console.log("CREATING OUTBOUND SESSION");
    console.log(dstIdkey);
    let dstOtkey: string = await serverComm.getOtkeyFromServer(dstIdkey);
    console.log(dstOtkey);
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
    console.log("CREATING INBOUND SESSION");
    console.log(srcIdkey);
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
      toggle = this.#selfSessionUseEmu1;
      console.log(toggle);
      this.#useEmu1Queue.push(!toggle);
      console.log("pushed: " + !toggle);
    }
    let sess: Olm.Session = this.#getSession(dstIdkey, toggle);
    
    // if sess is null (initiating communication with new device) or 
    // sess does not have a received message => generate new outbound 
    // session
    if (sess !== null && !sess.has_received_message()) {
      console.log("NO RECEIVED MESSAGE YET - CREATE NEW SESS");
    }
    if (sess === null || !sess.has_received_message()) {
      let acct: Olm.Account = this.#getAccount();
      if (acct === null) {
        console.log("device is being deleted - no acct");
        sess.free();
        return "{}";
      }
      sess = await this.#createOutboundSession(serverComm, dstIdkey, acct, toggle);
      acct.free();
    } else {
      console.log("using existing session");
      console.log(dstIdkey);
    }

    if (sess === null) {
      console.log("device is being deleted - no sess");
      return "{}";
    } else if (sess === -1) {
      return "{}";
    }
    
    let ciphertext: string = sess.encrypt(plaintext);
    console.log(sess.session_id());
    console.log(sess.describe());
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
      let val = this.#useEmu1Queue.shift();
      console.log(val);
      if (val === undefined) {
        console.log("EMU1 QUEUE IS EMPTY - using !selfSessUseEmu1");
        toggle = !this.#selfSessionUseEmu1;
        console.log(toggle);
      } else {
        console.log("EMU1 QUEUE IS _NOT_ EMPTY - using val");
        toggle = val;
        console.log(toggle);
      }

      // when queue is empty, all outgoing messages have been received and 
      // can toggle which session to use (emu1 vs emu2) when encrypting to 
      // avoid continuously generating new sessions
      if (!this.#selfFirstDecrypt) {
        console.log("TOGGLING");
        console.log(this.#selfSessionUseEmu1);
        this.#selfSessionUseEmu1 = !this.#selfSessionUseEmu1;
        console.log(this.#selfSessionUseEmu1);
        console.log(this.#selfFirstDecrypt);
        this.#selfFirstDecrypt = true;
        console.log(this.#selfFirstDecrypt);
      }
    }

    let sess: Olm.Session = this.#getSession(srcIdkey, toggle);
    
    // if receiving communication from new device or message was encrypted
    // with a one-time key, generate new inbound session
    if (sess !== null && ciphertext.type === 0) {
      console.log("RECEIVED INIT MSG");
    }
    if (sess === null || ciphertext.type === 0) {
      sess = this.#createInboundSession(srcIdkey, ciphertext.body, toggle);
      if (sess === null) {
        return "{}";
      }
    } else {
      console.log("using existing session");
      console.log(srcIdkey);
    }
    
    let plaintext: string = sess.decrypt(ciphertext.type, ciphertext.body);
    console.log(sess.session_id());
    console.log(sess.describe());
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
