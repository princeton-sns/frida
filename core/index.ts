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
import { MessageChainsIntegration } from "./messageChainsIntegration.js";

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
  messageChains: MessageChainsIntegration;

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
    this.messageChains = await MessageChainsIntegration.create(this.olmWrapper.getIdkey());
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
  async sendMessage(dstIdkeys: string[], applicationPayload: string) {
    // Pass the message to the Byzantine server detection mechansim integration
    // layer. It generally produces two outputs: a generic message part sent to
    // all recipients, as well as a message part which is custom for each
    // recipient:
    const [commonPayload, recipientsPayload]: [string, {[key: string]: string}] =
          await this.messageChains.sendMessage(dstIdkeys, applicationPayload);

    // Potentially, having these two payloads seperately allows us to encrypt
    // common payload once using a symmetric key and pass that key along with
    // the custom recipient payload. However, this is not yet supported in the
    // server, so combine them into a custom, encrypted payload per recipient:
    const batch: outboundEncPayloadType[] = await Promise.all(
      Object.entries(recipientsPayload).map(async ([idkey, payload]) => ({
        deviceId: idkey,
        payload: await this.olmWrapper.encrypt(
          this.#serverComm,
          JSON.stringify([commonPayload, payload]),
          idkey,
        )
      }))
    );

    await this.#serverComm.sendMessage({
      batch: batch,
    });
  }

  async onMessage(msg: inboundEncPayloadType) {
    console.log("seqID: " + msg.seqID);

    let decPayload: string = this.olmWrapper.decrypt(
      msg.encPayload,
      msg.sender,
    );

    // The decrypted payload should consist of two parts: a common payload sent
    // to all recipients, as well as recipient-specific payload, encoded as a
    // two-element JSON array:
    let [commonPayload, recipientPayload] = JSON.parse(decPayload);

    // Throw these payloads into the Byzantine server detection integration,
    // potentially emitting an application payload to send to the server:
    let byzantineServerDetectionRes =
      await this.messageChains.receiveMessage(
        msg.sender, commonPayload, recipientPayload);

    if (byzantineServerDetectionRes) {
      let [localSeq, applicationPayload] = byzantineServerDetectionRes;
      console.log(`Byzantine server detection assigned message sequence number ${localSeq}`);

      await this.eventEmitter.emit('coreMsg', {
        payload: applicationPayload,
        sender: msg.sender,
      });
    }
  }
}


