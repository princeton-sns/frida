/*
 **************
 * Olm Crypto *
 **************
 */
import Olm from "./olm.js";
// TODO can eventually make data abstraction module use these basic methods
class ThinLSWrapper {
    constructor() { }
    set(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }
    get(key) {
        return JSON.parse(localStorage.getItem(key));
    }
    remove(key) {
        localStorage.removeItem(key);
    }
    clear() {
        localStorage.clear();
    }
}
export class OlmWrapper {
    // FIXME what key to use for pickling/unpickling?
    static PICKLE_KEY = "secret_key";
    static SLASH = "/";
    static IDKEY = "__idkey";
    static ACCT_KEY = "__account";
    static SESS_KEY = "__session";
    static ENDPOINT1 = "__endpoint1";
    static ENDPOINT2 = "__endpoint2";
    static INIT_NUM_OTKEYS = 10;
    static MORE_NUM_OTKEYS = 5;
    // used to emulate two session endpoints within this single device
    // (when a device sends an encrypted message to itself)
    #selfSessionUseEndpoint1 = true;
    #useEndpoint1Queue = [];
    #selfFirstDecrypt = false;
    #turnEncryptionOff = false;
    #thinLSWrapper;
    constructor(turnEncryptionOff) {
        this.#turnEncryptionOff = turnEncryptionOff;
        this.#thinLSWrapper = new ThinLSWrapper();
    }
    async init() {
        await Olm.init({
            locateFile: () => "/olm.wasm",
        });
    }
    getIdkey() {
        return this.#thinLSWrapper.get(OlmWrapper.IDKEY);
    }
    #setIdkey(idkey) {
        this.#thinLSWrapper.set(OlmWrapper.IDKEY, idkey);
    }
    #getAccount() {
        // check that account exists
        let pickled = this.#thinLSWrapper.get(OlmWrapper.ACCT_KEY);
        if (pickled === null) {
            return null;
        }
        // unpickle and return account
        let acct = new Olm.Account();
        acct.unpickle(OlmWrapper.PICKLE_KEY, pickled);
        return acct;
    }
    #setAccount(acct) {
        this.#thinLSWrapper.set(OlmWrapper.ACCT_KEY, acct.pickle(OlmWrapper.PICKLE_KEY));
    }
    #getSessionKey(idkey, toggle = undefined) {
        if (toggle !== undefined) {
            if (toggle) {
                return OlmWrapper.SESS_KEY + OlmWrapper.SLASH + OlmWrapper.ENDPOINT1 + OlmWrapper.SLASH + idkey + OlmWrapper.SLASH;
            }
            return OlmWrapper.SESS_KEY + OlmWrapper.SLASH + OlmWrapper.ENDPOINT2 + OlmWrapper.SLASH + idkey + OlmWrapper.SLASH;
        }
        return OlmWrapper.SESS_KEY + OlmWrapper.SLASH + idkey + OlmWrapper.SLASH;
    }
    #getActiveSession(idkey, toggle = undefined) {
        let allSess = this.#thinLSWrapper.get(this.#getSessionKey(idkey, toggle));
        return allSess?.active?.pickled || null;
    }
    #getAllSessions(idkey, toggle = undefined) {
        let allSess = this.#thinLSWrapper.get(this.#getSessionKey(idkey, toggle));
        if (allSess === null)
            return null;
        let sessList = allSess.inactive;
        sessList.unshift(allSess.active);
        return sessList;
    }
    #unpickleSession(pickled) {
        if (pickled === null)
            return null;
        let sess = new Olm.Session();
        sess.unpickle(OlmWrapper.PICKLE_KEY, pickled);
        return sess;
    }
    #setSession(sess, idkey, toggle = undefined) {
        let sessid = sess.session_id();
        let key = this.#getSessionKey(idkey, toggle);
        let allSess = this.#thinLSWrapper.get(key);
        if (allSess === null) {
            let emptyInactive = [];
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
        let spliceIdx;
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
    #generateOtkeys(numOtkeys) {
        let acct = this.#getAccount();
        if (acct === null) {
            acct = new Olm.Account();
            acct.create();
        }
        acct.generate_one_time_keys(numOtkeys);
        let idkey = JSON.parse(acct.identity_keys()).curve25519;
        let otkeys = JSON.parse(acct.one_time_keys()).curve25519;
        acct.mark_keys_as_published();
        this.#setAccount(acct);
        acct.free();
        return {
            idkey: idkey,
            otkeys: otkeys,
        };
    }
    async #createOutboundSession(serverComm, dstIdkey, acct, toggle = undefined) {
        let dstOtkey = await serverComm.getOtkeyFromServer(dstIdkey);
        if (!dstOtkey) {
            console.log("dest device has been deleted - no otkey");
            return -1;
        }
        let sess = new Olm.Session();
        sess.create_outbound(acct, dstIdkey, dstOtkey);
        this.#setSession(sess, dstIdkey, toggle);
        return sess;
    }
    #createInboundSession(srcIdkey, body, toggle = undefined) {
        let sess = new Olm.Session();
        let acct = this.#getAccount();
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
    #useNewInbound(srcIdkey, 
    // i think there's ts typechecker bug that uncommenting this type annotation exercises
    ciphertext, //: ciphertextType,
    toggle = undefined) {
        let sess = this.#createInboundSession(srcIdkey, ciphertext.body, toggle);
        if (sess === null) {
            return "{}";
        }
        let plaintext = sess.decrypt(ciphertext.type, ciphertext.body);
        this.#setSession(sess, srcIdkey, toggle);
        sess.free();
        return plaintext;
    }
    async #encryptHelper(serverComm, plaintext, dstIdkey) {
        console.log("REAL ENCRYPT -- ");
        let toggle = undefined;
        if (dstIdkey === this.getIdkey()) {
            toggle = this.#selfSessionUseEndpoint1;
            this.#useEndpoint1Queue.push(!toggle);
        }
        let sess = this.#unpickleSession(this.#getActiveSession(dstIdkey, toggle));
        // if sess is null (initiating communication with new device) or sess
        // does not have a received message => generate new outbound session
        if (sess === null || !sess.has_received_message()) {
            let acct = this.#getAccount();
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
        }
        else if (sess === -1) {
            return "{}";
        }
        let ciphertext = sess.encrypt(plaintext);
        this.#setSession(sess, dstIdkey, toggle);
        sess.free();
        console.log(JSON.parse(plaintext));
        return ciphertext;
    }
    #dummyEncrypt(plaintext) {
        console.log("DUMMY ENCRYPT -- ");
        return plaintext;
    }
    #decryptHelper(ciphertext, srcIdkey) {
        console.log("REAL DECRYPT -- ");
        if (typeof ciphertext === 'string') {
            console.log("ciphertext is a string when it should be an object");
            return "";
        }
        let toggle = undefined;
        if (srcIdkey === this.getIdkey()) {
            let val = this.#useEndpoint1Queue.shift();
            if (val === undefined) {
                toggle = !this.#selfSessionUseEndpoint1;
            }
            else {
                toggle = val;
            }
        }
        let sessList = this.#getAllSessions(srcIdkey, toggle);
        // if receiving communication from new device or if message was encrypted
        // with a one-time key, generate new inbound session
        if (sessList === null || ciphertext.type === 0) {
            let plaintext = this.#useNewInbound(srcIdkey, ciphertext, toggle);
            console.log(JSON.parse(plaintext));
            // when queue is empty, all outgoing messages have been received and 
            // can toggle which session to use (endpoint1 vs endpoint2) when 
            // encrypting to avoid continuously generating new sessions
            if (!this.#selfFirstDecrypt && srcIdkey === this.getIdkey()) {
                this.#selfSessionUseEndpoint1 = !this.#selfSessionUseEndpoint1;
                this.#selfFirstDecrypt = true;
            }
            return plaintext;
        }
        // otherwise, scan existing sessions for the right one
        // TODO set an upper bound for number of sessions to check
        for (let sessElem of sessList) {
            let sess = this.#unpickleSession(sessElem.pickled);
            let plaintext;
            try {
                plaintext = sess.decrypt(ciphertext.type, ciphertext.body);
                this.#setSession(sess, srcIdkey, toggle);
                // when queue is empty, all outgoing messages have been received and 
                // can toggle which session to use (endpoint1 vs endpoint2) when 
                // encrypting to avoid continuously generating new sessions
                if (!this.#selfFirstDecrypt && srcIdkey === this.getIdkey()) {
                    this.#selfSessionUseEndpoint1 = !this.#selfSessionUseEndpoint1;
                    this.#selfFirstDecrypt = true;
                }
                console.log(JSON.parse(plaintext));
                return plaintext;
            }
            catch (err) {
                console.log(err);
                continue;
            }
            finally {
                sess.free();
            }
        }
        // when queue is empty, all outgoing messages have been received and 
        // can toggle which session to use (endpoint1 vs endpoint2) when 
        // encrypting to avoid continuously generating new sessions
        if (!this.#selfFirstDecrypt && srcIdkey === this.getIdkey()) {
            this.#selfSessionUseEndpoint1 = !this.#selfSessionUseEndpoint1;
            this.#selfFirstDecrypt = true;
        }
        console.log("NO EXISTING SESSIONS WORKED");
        return "{}";
    }
    #dummyDecrypt(ciphertext) {
        console.log("DUMMY DECRYPT -- ");
        return ciphertext;
    }
    async generateInitialKeys() {
        let { idkey } = this.#generateOtkeys(OlmWrapper.INIT_NUM_OTKEYS);
        this.#setIdkey(idkey);
        return idkey;
    }
    generateMoreOtkeys(needs = OlmWrapper.MORE_NUM_OTKEYS) {
        return this.#generateOtkeys(needs);
    }
    async encrypt(serverComm, plaintext, dstIdkey) {
        if (this.#turnEncryptionOff) {
            return this.#dummyEncrypt(plaintext);
        }
        return await this.#encryptHelper(serverComm, plaintext, dstIdkey);
    }
    decrypt(ciphertext, srcIdkey) {
        if (this.#turnEncryptionOff && typeof ciphertext === 'string') {
            return this.#dummyDecrypt(ciphertext);
        }
        return this.#decryptHelper(ciphertext, srcIdkey);
    }
    ;
}
