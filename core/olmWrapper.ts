/*
 **************
 * Olm Crypto *
 **************
 */

import type * as OlmT from "@matrix-org/olm";
// @ts-ignore
import Olm from "@matrix-org/olm";
import { ServerComm } from "./serverComm.js";

// TODO can eventually make data abstraction module use these basic methods
class ThinLSWrapper {
  suffix = "";

  constructor(suffix: string | undefined) {
    if (suffix) {
      this.suffix = "_" + suffix;
    }
  }

  set(key: string, value: any) {
    localStorage.setItem(
      key + this.suffix,
      JSON.stringify(value)
    );
  }

  get(key: string): any {
    return JSON.parse(localStorage.getItem(key + this.suffix));
  }

  remove(key: string) {
    localStorage.removeItem(key + this.suffix);
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

  debug: boolean = false

  private constructor(turnEncryptionOff: boolean, storageSuffix: string | undefined) {
    this.#turnEncryptionOff = turnEncryptionOff;
    this.#thinLSWrapper = new ThinLSWrapper(storageSuffix);
  }

  async #init(wasmPath: string | undefined) {
    let olmInitOpts = {};

    if (wasmPath) {
      olmInitOpts["locateFile"] = () => wasmPath;
    }

    await Olm.init(olmInitOpts);
  }

  static async create(
    turnEncryptionOff: boolean,
    wasmPath: string | undefined,
    storageSuffix: string | undefined
  ): Promise<OlmWrapper> {
    let olmWrapper = new OlmWrapper(turnEncryptionOff, storageSuffix);
    await olmWrapper.#init(wasmPath);
    return olmWrapper;
  }

  #log(...args) {
    if (this.debug) {
     console.log(...args);
    }
  }

  getIdkey(): string {
    return this.#thinLSWrapper.get(OlmWrapper.IDKEY);
  }

  #setIdkey(idkey: string) {
    this.#thinLSWrapper.set(OlmWrapper.IDKEY, idkey);
  }

  #getAccount(): OlmT.Account {
    // check that account exists
    let pickled: string = this.#thinLSWrapper.get(OlmWrapper.ACCT_KEY);
    if (pickled === null) {
      return null;
    }
    // unpickle and return account
    let acct: OlmT.Account = new Olm.Account();
    acct.unpickle(OlmWrapper.PICKLE_KEY, pickled);
    return acct;
  }

  #setAccount(acct: OlmT.Account) {
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

  #unpickleSession(pickled: string): OlmT.Session {
    if (pickled === null) return null;
    let sess: OlmT.Session = new Olm.Session();
    sess.unpickle(OlmWrapper.PICKLE_KEY, pickled);
    return sess;
  }

  #setSession(sess: OlmT.Session, idkey: string) {
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
    let acct: OlmT.Account = this.#getAccount();
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
      acct: OlmT.Account
  ): Promise<Olm.Session | number> {
    let dstOtkey: string = await serverComm.getOtkeyFromServer(dstIdkey);
    if (!dstOtkey) {
      this.#log("dest device has been deleted - no otkey");
      return -1;
    }

    let sess: OlmT.Session = new Olm.Session();
    sess.create_outbound(acct, dstIdkey, dstOtkey);
    this.#setSession(sess, dstIdkey);
    return sess;
  }

  #createInboundSession(
      srcIdkey: string,
      body: string
  ): OlmT.Session {
    let sess: OlmT.Session = new Olm.Session();
    let acct: OlmT.Account = this.#getAccount();
    if (acct === null) {
      this.#log("device is being deleted - no acct");
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
  ): Promise<Object> {
    this.#log("REAL ENCRYPT -- ");
    if (dstIdkey === this.getIdkey()) {
      this.#selfMsgQueue.push(plaintext);
      return "{}";
    }

    let sess: OlmT.Session | number = this.#unpickleSession(this.#getActiveSession(dstIdkey));

    // if sess is null (initiating communication with new device) or sess
    // does not have a received message => generate new outbound session
    if (sess === null || !sess.has_received_message()) {
      let acct: OlmT.Account = this.#getAccount();
      if (acct === null) {
        this.#log("device is being deleted - no acct");
        sess.free();
        return "{}";
      }
      sess = await this.#createOutboundSession(serverComm, dstIdkey, acct);
      acct.free();
    }

    if (sess === null) {
      this.#log("device is being deleted - no sess");
      return "{}";
    } else if (typeof sess === 'number' && -1) {
      return "{}";
    } else if (typeof sess === 'number') {
      throw "Unexpected return value of #createOutboundSession.";
    }

    let ciphertext = sess.encrypt(plaintext);
    this.#setSession(sess, dstIdkey);
    sess.free();
    this.#log(JSON.parse(plaintext));
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
    this.#log("REAL DECRYPT -- ", ciphertext);
    if (typeof ciphertext === 'string') {
      if (srcIdkey === this.getIdkey()) {
        this.#log("getting msg from queue");
        return this.#selfMsgQueue.shift();
      }
      this.#log("ciphertext is a string when it should be an object");
      return "{}";
    }

    let sessList = this.#getAllSessions(srcIdkey);

    // if receiving communication from new device or if message was encrypted
    // with a one-time key, generate new inbound session
    if (sessList === null || ciphertext.type === 0) {
      let plaintext: string = this.#useNewInbound(srcIdkey, ciphertext);
      this.#log(JSON.parse(plaintext));
      return plaintext;
    }

    // otherwise, scan existing sessions for the right one
    // TODO set an upper bound for number of sessions to check
    for (let sessElem of sessList) {
      let sess: OlmT.Session = this.#unpickleSession(sessElem.pickled);
      let plaintext: string;
      try {
        plaintext = sess.decrypt(ciphertext.type, ciphertext.body);
        this.#setSession(sess, srcIdkey);
        this.#log(JSON.parse(plaintext));
        return plaintext;
      } catch (err) {
        this.#log(err);
        continue;
      } finally {
        sess.free();
      }
    }

    this.#log("NO EXISTING SESSIONS WORKED");
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
  ): Promise<Object | string> {
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
