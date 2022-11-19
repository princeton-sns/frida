/*
 ************
 ************
 *** Core ***
 ************
 ************
 */

import { EventEmitter } from "events";
import { OlmWrapper } from  "./olmWrapper.js";
import { ServerComm } from "./serverComm.js";

export type outboundEncPayloadType = {
  deviceId: string,
  payload: string
};

export type inboundEncPayloadType = {
  seqID: number,
  sender: string,
  encPayload: string,
};

export class Core {
  olmWrapper: OlmWrapper;
  #serverComm: ServerComm;
  eventEmitter: EventEmitter;

  /**
   * Initializes client-server connection and client state.
   *
   * @param {string} ip server IP address
   * @param {string} port server port number
   * @param {{ onAuth: callback,
   *           onUnauth: callback, 
   *           validateCallback: callback}} config client configuration options
   */
  private constructor(
      eventEmitter: EventEmitter
  ) {
    this.eventEmitter = eventEmitter;
    // register listener for incoming messages
    this.eventEmitter.on('serverMsg', async (msg: inboundEncPayloadType) => {
      await this.onMessage(msg);
    });
  }

  async #init(
      turnEncryptionOff: boolean,
      ip?: string,
      port?: string
  ) {
    this.olmWrapper = await OlmWrapper.create(turnEncryptionOff);
    this.#serverComm = await ServerComm.create(this.eventEmitter, this.olmWrapper, ip, port);
  }

  static async create(
      eventEmitter: EventEmitter,
      turnEncryptionOff: boolean,
      ip?: string,
      port?: string
  ): Promise<Core> {
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
  async sendMessage(dstIdkeys: string[], payload: string) {
    let batch: outboundEncPayloadType[] = new Array();
  
    console.log("sending to...");
    console.log(dstIdkeys);
  
    for (let dstIdkey of dstIdkeys) {
      let encPayload: string = await this.olmWrapper.encrypt(
        this.#serverComm,
        payload,
        dstIdkey,
      );
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
  
  async onMessage(msg: inboundEncPayloadType) {
    console.log("seqID: " + msg.seqID);
    let payload: string = this.olmWrapper.decrypt(
        msg.encPayload,
        msg.sender,
    );
    await this.eventEmitter.emit('coreMsg', {
      payload: payload,
      sender: msg.sender,
    });
  }

  disconnect() {
    this.#serverComm.disconnect();
  }
}

