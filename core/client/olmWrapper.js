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
    static EMU1 = "__emu1";
    static EMU2 = "__emu2";
    static INIT_NUM_OTKEYS = 10;
    static MORE_NUM_OTKEYS = 5;
    // used to emulate two session endpoints within this single device
    // (when a device sends an encrypted message to itself)
    #selfSessionUseEmu1 = true;
    #useEmu1Queue = [];
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
        console.log(toggle);
        if (toggle !== undefined) {
            if (toggle) {
                console.log(OlmWrapper.SESS_KEY + OlmWrapper.SLASH + OlmWrapper.EMU1 + OlmWrapper.SLASH + idkey + OlmWrapper.SLASH);
                return OlmWrapper.SESS_KEY + OlmWrapper.SLASH + OlmWrapper.EMU1 + OlmWrapper.SLASH + idkey + OlmWrapper.SLASH;
            }
            console.log(OlmWrapper.SESS_KEY + OlmWrapper.SLASH + OlmWrapper.EMU2 + OlmWrapper.SLASH + idkey + OlmWrapper.SLASH);
            return OlmWrapper.SESS_KEY + OlmWrapper.SLASH + OlmWrapper.EMU2 + OlmWrapper.SLASH + idkey + OlmWrapper.SLASH;
        }
        console.log(OlmWrapper.SESS_KEY + OlmWrapper.SLASH + idkey + OlmWrapper.SLASH);
        return OlmWrapper.SESS_KEY + OlmWrapper.SLASH + idkey + OlmWrapper.SLASH;
    }
    #getSession(idkey, toggle = undefined) {
        console.log("GETTING session");
        // check that session exists
        let pickled = this.#thinLSWrapper.get(this.#getSessionKey(idkey, toggle));
        if (pickled === null) {
            return null;
        }
        // unpickle and return session
        let sess = new Olm.Session();
        sess.unpickle(OlmWrapper.PICKLE_KEY, pickled);
        return sess;
    }
    #setSession(sess, idkey, toggle = undefined) {
        console.log("SETTING session");
        this.#thinLSWrapper.set(this.#getSessionKey(idkey, toggle), sess.pickle(OlmWrapper.PICKLE_KEY));
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
        console.log("CREATING OUTBOUND SESSION");
        console.log(dstIdkey);
        let dstOtkey = await serverComm.getOtkeyFromServer(dstIdkey);
        console.log(dstOtkey);
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
        console.log("CREATING INBOUND SESSION");
        console.log(srcIdkey);
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
    async #encryptHelper(serverComm, plaintext, dstIdkey) {
        console.log("REAL ENCRYPT -- ");
        console.log(plaintext);
        let toggle = undefined;
        if (dstIdkey === this.getIdkey()) {
            toggle = this.#selfSessionUseEmu1;
            console.log(toggle);
            this.#useEmu1Queue.push(!toggle);
            console.log("pushed: " + !toggle);
        }
        let sess = this.#getSession(dstIdkey, toggle);
        // if sess is null (initiating communication with new device) or 
        // sess does not have a received message => generate new outbound 
        // session
        if (sess !== null && !sess.has_received_message()) {
            console.log("NO RECEIVED MESSAGE YET - CREATE NEW SESS");
        }
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
        else {
            console.log("using existing session");
            console.log(dstIdkey);
        }
        if (sess === null) {
            console.log("device is being deleted - no sess");
            return "{}";
        }
        else if (sess === -1) {
            return "{}";
        }
        let ciphertext = sess.encrypt(plaintext);
        console.log(sess.session_id());
        console.log(sess.describe());
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
            let val = this.#useEmu1Queue.shift();
            console.log(val);
            if (val === undefined) {
                console.log("EMU1 QUEUE IS EMPTY - using !selfSessUseEmu1");
                toggle = !this.#selfSessionUseEmu1;
                console.log(toggle);
            }
            else {
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
        let sess = this.#getSession(srcIdkey, toggle);
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
        }
        else {
            console.log("using existing session");
            console.log(srcIdkey);
        }
        let plaintext = sess.decrypt(ciphertext.type, ciphertext.body);
        console.log(sess.session_id());
        console.log(sess.describe());
        this.#setSession(sess, srcIdkey, toggle);
        sess.free();
        console.log(JSON.parse(plaintext));
        return plaintext;
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
