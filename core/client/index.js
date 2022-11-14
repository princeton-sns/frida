/*
 ************
 ************
 *** Core ***
 ************
 ************
 */
import { OlmWrapper } from "./olmWrapper.js";
import { ServerComm } from "./serverComm.js";
export class Core {
    olmWrapper;
    #serverComm;
    eventEmitter;
    /**
     * Initializes client-server connection and client state.
     *
     * @param {string} ip server IP address
     * @param {string} port server port number
     * @param {{ onAuth: callback,
     *           onUnauth: callback,
     *           validateCallback: callback}} config client configuration options
     */
    constructor(eventEmitter, turnEncryptionOff, ip, port) {
        this.olmWrapper = new OlmWrapper(turnEncryptionOff);
        this.eventEmitter = eventEmitter;
        // register listener for incoming messages
        this.eventEmitter.on('serverMsg', async (msg) => {
            await this.onMessage(msg);
        });
        this.#serverComm = new ServerComm(this.eventEmitter, ip, port);
    }
    async init() {
        await this.olmWrapper.init();
        await this.#serverComm.init(this.olmWrapper);
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
    async onMessage(msg) {
        console.log("seqID: " + msg.seqID);
        let payload = JSON.parse(this.olmWrapper.decrypt(msg.encPayload, msg.sender));
        await this.eventEmitter.emit('coreMsg', {
            payload: payload,
            sender: msg.sender,
        });
        //console.log("finished upcalling to higher");
    }
    disconnect() {
        this.#serverComm.disconnect();
    }
}
