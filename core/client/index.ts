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

// We can only import the type definitions here. Loading the messagechains WASM
// module has to happen asynchronously through an `import()` call:
import type { Sha256StringMessageChains } from "../messagechains/pkg";

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
  messageChains: Sha256StringMessageChains;

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

    // The messagechains module needs to be imported asynchronously, as it
    // uses async internally to load the compiled WASM object.
    let { Sha256StringMessageChains } = await import("../messagechains/pkg/messagechains.js");
    this.messageChains = Sha256StringMessageChains.new(this.olmWrapper.getIdkey());
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
  async sendMessage(dstIdkeys: string[], messagePayload: string) {
    let batch: outboundEncPayloadType[] = new Array();
  
    let ownId = this.olmWrapper.getIdkey();
    let consistencyLoopback = true;
    for (let r of dstIdkeys) {
      if (r === ownId) {
        consistencyLoopback = false;
        break;
      }
    }

    if (consistencyLoopback) {
      dstIdkeys.push(ownId);
    }

    let sortedDstIdkeys = this.messageChains.sort_recipients(dstIdkeys);

    console.log("sending to...");
    console.log(sortedDstIdkeys);

    for (let dstIdkey of sortedDstIdkeys) {
      let preEncPayload = {
        message: messagePayload,
        // TODO: this should be moved outside of the encrypted payload. The
        // server is exposed to this information anyways. If a client were to
        // send an incorrect recipients list, this could invalidate the pairwise
        // hash-chains maintained with an arbitrary number of other clients in
        // the system.
        recipients: sortedDstIdkeys,
        consistencyLoopback: consistencyLoopback,
      };

      let validationPayload =
        this.messageChains.validation_payload(dstIdkey) as [number, string] | null;

      if (validationPayload) {
        preEncPayload["validationSeq"] = validationPayload[0];
        preEncPayload["validationDigest"] = validationPayload[1];
      }

      let encPayload: string = await this.olmWrapper.encrypt(
        this.#serverComm,
        JSON.stringify(preEncPayload),
        dstIdkey,
      );
      batch.push({
        deviceId: dstIdkey,
        payload: encPayload,
      });
    }
    console.log(batch);
  
    // Register message to be send. This is important to be able to detect
    // reordering of messages sent by ourselves.
    this.messageChains.send_message(messagePayload, sortedDstIdkeys);

    // send message to server
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

    let validationPayload = null;
    let messagePayload = null;
    let recipients = null;
    let consistencyLoopback = null;

    try {
      // We expect received messsages to be a JSON object containing a "message"
      // field (holding the actual string message), as well as an optional
      // validation payload encoded in the "validationSeq" and
      // "validationDigest" fields. While we are implementing some explicit
      // sanity checks, wrap the entire decoding implementation in a try block
      // to handle any (unexpected) failures gracefully.
      let payload = JSON.parse(decPayload);

      if (!("message" in payload)
          || (typeof payload["message"] !== "string"
              && !(payload["message"] instanceof String))) {
        throw "Decrypted message does not have a string payload.";
      }
      messagePayload = String(payload["message"]).valueOf();

      recipients = payload["recipients"];
      if (!Array.isArray(recipients)) {
        throw "Message recipients is not an array.";
      }
      for (let r of recipients) {
        if (typeof r !== "string" && !(r instanceof String)) {
          throw "Message recipient is not a string.";
        }
      }

      // If one of the validation payload fields is present, try to decode it as
      // a validation payload. This explicitly provokes an error when just one
      // of the required fields is provided.
      if ("validationSeq" in payload || "validationDigest" in payload) {
        let validationSeq = payload["validationSeq"];
        let validationDigest = payload["validationDigest"];

        if (typeof validationSeq !== "number" || !Number.isInteger(validationSeq) || validationSeq < 0) {
          throw `Validation sequence number is not a positive integer: ${validationSeq}`;
        }

        if (typeof validationDigest !== "string" && !(validationDigest instanceof String)) {
          throw "Validation digest is t a string.";
        }

        // Basic sanity checks passed, set the validation payload to be processed:
        validationPayload = {
          seq: validationSeq,
          digest: validationDigest,
        };

        // TODO: typecheck!
      }
      consistencyLoopback = payload["consistencyLoopback"];
    } catch (e) {
      console.log("Error decoding received message:", decPayload, e);
      return;
    }

    try {
      // Now try to validate the message and potentially trim hash chains. This
      // also implicitly handles loopback messages sent from our own device. It
      // does not detect reordering for loopback messages:
      let trimmed = this.messageChains.validate_trim_chain(
        msg.sender,
        (validationPayload) ? validationPayload.seq : null,
        (validationPayload) ? validationPayload.digest : null,
      );
      console.log(`Trimmed ${trimmed} entries from pairwise message-chain with ${msg.sender}`);

      // Finally, insert the message into the chain. This also validates
      // ordering and contents for messages looped back to us.
      this.messageChains.insert_message(msg.sender, messagePayload, recipients);
    } catch (e) {
      console.log("Error validating/inserting received message:", decPayload, e);
      return;
    }

    if (consistencyLoopback && msg.sender == this.olmWrapper.getIdkey()) {
      console.log("Discarding message looped back to ourselves for consistency check.");
      return;
    }

    await this.eventEmitter.emit('coreMsg', {
      payload: messagePayload,
      sender: msg.sender,
    });
  }
}

