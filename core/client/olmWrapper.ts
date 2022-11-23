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
  static ENDPOINT1 : string = "__endpoint1";
  static ENDPOINT2 : string = "__endpoint2";
  static INIT_NUM_OTKEYS: number = 10;
  static MORE_NUM_OTKEYS: number = 5;

  // used when sending message through server (for seqID) to self device 
  // (to avoid unnecessary encrypting/decrypting)
  #selfMsgQueue: string[] = [];

  #turnEncryptionOff: boolean = false;
  #thinLSWrapper: ThinLSWrapper;

  private constructor(turnEncryptionOff: boolean) {
    this.#turnEncryptionOff = turnEncryptionOff;
    this.#thinLSWrapper = new ThinLSWrapper();
  }

  async #init() {
    await Olm.init({
      locateFile: () => "/olm.wasm",
    });
  }

  static async create(turnEncryptionOff: boolean): Promise<OlmWrapper> {
    let olmWrapper = new OlmWrapper(turnEncryptionOff);
    await olmWrapper.#init();
    return olmWrapper;
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

  #getSessionKey(idkey: string): string {
    return OlmWrapper.SESS_KEY + OlmWrapper.SLASH + idkey + OlmWrapper.SLASH;
  }

  #getActiveSession(idkey: string): string {
    let allSess = this.#thinLSWrapper.get(this.#getSessionKey(idkey));
    return allSess?.active?.pickled || null;
  }

  #getAllSessions(idkey: string): { id: string, pickled: string }[] {
    let allSess = this.#thinLSWrapper.get(this.#getSessionKey(idkey));
    if (allSess === null) return null;
    let sessList = allSess.inactive;
    sessList.unshift(allSess.active);
    return sessList;
  }

  #unpickleSession(pickled: string): Olm.Session {
    if (pickled === null) return null;
    let sess: Olm.Session = new Olm.Session();
    sess.unpickle(OlmWrapper.PICKLE_KEY, pickled);
    return sess;
  }

  #setSession(sess: Olm.Session, idkey: string) {
    let sessid = sess.session_id();

    let key = this.#getSessionKey(idkey);
    let allSess = this.#thinLSWrapper.get(key);

    if (allSess === null) {
      let emptyInactive: { id: string, pickled: string }[] = [];
      allSess = {
        active: {
          id: sessid,
          pickled: sess.pickle(OlmWrapper.PICKLE_KEY),
        },
        inactive: emptyInactive,
      };
      this.#thinLSWrapper.set(key, allSess);
      return;
    }

    // put current active sess at head of inactive sess list
    allSess.inactive.unshift({
      id: allSess.active.id,
      pickled: allSess.active.pickled,
    });
    // ensure only one stored sess with SESSION_ID at a time
    let spliceIdx: number;
    for (let i = 0; i < allSess.inactive.length; i++) {
      // don't need to go through whole array b/c 
      // shouldn't have duplicates in the first place
      if (sessid === allSess.inactive[i].id) {
        spliceIdx = i;
        break;
      }
    }
    // deduplicate session id
    allSess.inactive.splice(spliceIdx, 1);
    // add new active session
    allSess = {
      active: {
        id: sessid,
        pickled: sess.pickle(OlmWrapper.PICKLE_KEY),
      },
      inactive: allSess.inactive,
    };
    this.#thinLSWrapper.set(key, allSess);
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
      acct: Olm.Account
  ): Olm.Session {
    let dstOtkey: string = await serverComm.getOtkeyFromServer(dstIdkey);
    if (!dstOtkey) {
      console.log("dest device has been deleted - no otkey");
      return -1;
    }
    
    let sess: Olm.Session = new Olm.Session();
    sess.create_outbound(acct, dstIdkey, dstOtkey);
    this.#setSession(sess, dstIdkey);
    return sess;
  }

  #createInboundSession(
      srcIdkey: string,
      body: string
  ): Olm.Session {
    let sess: Olm.Session = new Olm.Session();
    let acct: Olm.Account = this.#getAccount();
    if (acct === null) {
      console.log("device is being deleted - no acct");
      sess.free();
      return null;
    }
    sess.create_inbound(acct, body);
    this.#setSession(sess, srcIdkey);
    acct.free();
    return sess;
  }

  #useNewInbound(
      srcIdkey: string,
      // i think there's ts typechecker bug that uncommenting this type annotation exercises
      ciphertext //: ciphertextType,
  ): string {
    let sess = this.#createInboundSession(srcIdkey, ciphertext.body);
    if (sess === null) {
      return "{}";
    }
    let plaintext: string = sess.decrypt(ciphertext.type, ciphertext.body);
    this.#setSession(sess, srcIdkey);
    sess.free();
    return plaintext;
  }

  async #encryptHelper(
      serverComm: ServerComm,
      plaintext: string,
      dstIdkey: string
  ): Promise<string> {
    console.log("REAL ENCRYPT -- ");
    if (dstIdkey === this.getIdkey()) {
      this.#selfMsgQueue.push(plaintext);
      return "{}";
    }

    let sess: Olm.Session = this.#unpickleSession(this.#getActiveSession(dstIdkey));

    // if sess is null (initiating communication with new device) or sess
    // does not have a received message => generate new outbound session
    if (sess === null || !sess.has_received_message()) {
      let acct: Olm.Account = this.#getAccount();
      if (acct === null) {
        console.log("device is being deleted - no acct");
        sess.free();
        return "{}";
      }
      sess = await this.#createOutboundSession(serverComm, dstIdkey, acct);
      acct.free();
    }

    if (sess === null) {
      console.log("device is being deleted - no sess");
      return "{}";
    } else if (sess === -1) {
      return "{}";
    }

    let ciphertext: string = sess.encrypt(plaintext);
    this.#setSession(sess, dstIdkey);
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
      if (srcIdkey === this.getIdkey()) {
        console.log("getting msg from queue");
        return this.#selfMsgQueue.shift();
      }
      console.log("ciphertext is a string when it should be an object");
      return "{}";
    }

    let sessList = this.#getAllSessions(srcIdkey);

    // if receiving communication from new device or if message was encrypted
    // with a one-time key, generate new inbound session
    if (sessList === null || ciphertext.type === 0) {
      let plaintext: string = this.#useNewInbound(srcIdkey, ciphertext);
      console.log(JSON.parse(plaintext));
      return plaintext;
    }

    // otherwise, scan existing sessions for the right one
    // TODO set an upper bound for number of sessions to check
    for (let sessElem of sessList) {
      let sess: Olm.Session = this.#unpickleSession(sessElem.pickled);
      let plaintext: string;
      try {
        plaintext = sess.decrypt(ciphertext.type, ciphertext.body);
        this.#setSession(sess, srcIdkey);
        console.log(JSON.parse(plaintext));
        return plaintext;
      } catch (err) {
        console.log(err);
        continue;
      } finally {
        sess.free();
      }
    }

    console.log("NO EXISTING SESSIONS WORKED");
    return "{}";
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
