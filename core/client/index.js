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
    constructor(eventEmitter) {
        this.eventEmitter = eventEmitter;
        // register listener for incoming messages
        this.eventEmitter.on('serverMsg', async (msg) => {
            await this.onMessage(msg);
        });
    }
    async #init(turnEncryptionOff, ip, port) {
        this.olmWrapper = await OlmWrapper.create(turnEncryptionOff);
        this.#serverComm = await ServerComm.create(this.eventEmitter, this.olmWrapper, ip, port);
    }
    static async create(eventEmitter, turnEncryptionOff, ip, port) {
        let core = new Core(eventEmitter);
        await core.#init(turnEncryptionOff, ip, port);
        return core;
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
        beforeCoreEncrypt();
        for (let dstIdkey of dstIdkeys) {
            let encPayload = await this.olmWrapper.encrypt(this.#serverComm, payload, dstIdkey);
            batch.push({
                deviceId: dstIdkey,
                payload: encPayload,
                clientSeq: global.clientSeq,        // For testing FOFI only!
            });
        }
        afterCoreEncrypt();
        console.log(batch);
        // send message to server
        await this.#serverComm.sendMessage({
            batch: batch,
        });
    }
    async onMessage(msg) {
        console.log("seqID: " + msg.seqID);
        beforeCoreDecrypt();
        let payload = this.olmWrapper.decrypt(msg.encPayload, msg.sender);
        afterCoreDecrypt();
        await this.eventEmitter.emit('coreMsg', {
            payload: payload,
            sender: msg.sender,
        });
    }
}
