/*
 ************
 ************
 *** Core ***
 ************
 ************
 */
import { OlmWrapper } from "./crypto/olmWrapper.js";
import { ServerComm } from "./serverComm/socketIOWrapper.js";
export class Core {
    olmWrapper;
    #serverComm;
    #onMessageCallback;
    /**
     * Initializes client-server connection and client state.
     *
     * @param {string} ip server IP address
     * @param {string} port server port number
     * @param {{ onAuth: callback,
     *           onUnauth: callback,
     *           validateCallback: callback}} config client configuration options
     */
    constructor(turnEncryptionOff, onMessageCallback, ip, port) {
        // FIXME use eventEmitter for onMessageCallback
        this.olmWrapper = new OlmWrapper(turnEncryptionOff);
        this.#serverComm = new ServerComm(this.olmWrapper, this.onMessage, ip, port);
        this.#onMessageCallback = onMessageCallback;
    }
    async init() {
        await this.olmWrapper.init();
        await this.#serverComm.init();
    }
    /**
     * Called like: sendMessage(resolveIDs(id), payload) (see example in
     * deleteAllLinkedDevices()).
     *
     * @param {string[]} dstIdkeys public keys to send message to
     * @param {Object} payload message contents
     *
     * @private
     */
    async sendMessage(dstIdkeys, payload) {
        let batch = new Array();
        console.log("sending to...");
        console.log(dstIdkeys);
        for (let dstIdkey of dstIdkeys) {
            let encPayload = await this.olmWrapper.encrypt(this.#serverComm, JSON.stringify(payload), dstIdkey);
            batch.push({
                deviceId: dstIdkey,
                payload: encPayload,
            });
        }
        console.log(batch);
        // send message to server
        await this.#serverComm.sendMessage({
            batch: batch,
        });
    }
    onMessage(msg) {
        console.log("seqID: " + msg.seqID);
        let payload = JSON.parse(this.olmWrapper.decrypt(msg.encPayload, msg.sender));
        this.#onMessageCallback(payload, msg.sender);
    }
    disconnect() {
        this.#serverComm.disconnect();
    }
}
