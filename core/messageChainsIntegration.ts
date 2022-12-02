// We can only import the type definitions here. Loading the messagechains WASM
// module has to happen asynchronously through an `import()` call:
import type { Sha256StringMessageChains } from "../messagechains/pkg";

export type commonPayloadType = {
  applicationPayload: string,
  recipients: string[],
};

export type recipientPayloadType = {
  consistencyLoopback: boolean | undefined,
  validationSeq: number | undefined,
  validationDigest: string | undefined,
};

export class MessageChainsIntegration {
  ownIdkey: string;
  messageChains: Sha256StringMessageChains;

  private constructor(ownIdkey: string) {
    this.ownIdkey = ownIdkey;
  }

  async #init() {
    // The messagechains module needs to be imported asynchronously, as it
    // uses async internally to load the compiled WASM object.
    let { Sha256StringMessageChains } = await import("../messagechains/pkg/messagechains.js");

    // Check whether we have some serialized state in localStorage:
    let serialized = localStorage.getItem("__messagechains");
    if (serialized) {
      this.messageChains = Sha256StringMessageChains.from_dump(serialized);
    } else {
      this.messageChains = Sha256StringMessageChains.new(this.ownIdkey);
    }
  }

  static async create(ownIdkey: string): Promise<MessageChainsIntegration> {
    let obj = new MessageChainsIntegration(ownIdkey);
    await obj.#init();
    return obj;
  }

  #dumpState() {
    let serialized = this.messageChains.dump();
    localStorage.setItem("__messagechains", serialized);
  }

  async sendMessage(dstIdkeys: string[], applicationPayload: string): Promise<[string, {[key: string]: string}]> {
    // The Byzantine server detection protocol requires messages to be sent back
    // to the originating device. We walk the list of recipients and, if we're
    // not included in it, add ourselves to it. We add a flag to the message
    // marking that we've done that, to discard that message on reception, after
    // validation:
    let consistencyLoopback = true; for (let r of dstIdkeys) {
      if (r === this.ownIdkey) {
        consistencyLoopback = false;
        break;
      }
    }
    if (consistencyLoopback) {
      dstIdkeys.push(this.ownIdkey);
    }

    // Use a WASM call to consistently sort the destination keys across platforms:
    const sortedDstIdkeys = this.messageChains.sort_recipients(dstIdkeys);

    // With the sorted recipients list, we can compose the common application payload:
    const commonPayload = JSON.stringify({
      applicationPayload: applicationPayload,
      recipients: sortedDstIdkeys,
    });

    // Register message to be sent. This is important to be able to detect
    // violations of message send order, or tampering with the recipients list:
    this.messageChains.send_message(applicationPayload, sortedDstIdkeys);
    this.#dumpState();

    // Now, create the individual recipients payload:
    const recipientsPayload = sortedDstIdkeys.reduce((payloads, recipient) => {
      let recipientPayload = {};

      if (recipient == this.ownIdkey) {
        recipientPayload["consistencyLoopback"] = consistencyLoopback;
      }

      const validationPayload = this.messageChains
        .validation_payload(recipient) as [number, string] | undefined;

      if (validationPayload) {
        recipientPayload["validationSeq"] = validationPayload[0];
        recipientPayload["validationDigest"] = validationPayload[1];
      }

      payloads[recipient] = JSON.stringify(recipientPayload);
      return payloads;
    }, {});

    return [commonPayload, recipientsPayload];
  }

  async receiveMessage(sender: string, commonPayload: string, recipientPayload: string): Promise<[number, string] | null> {
    // Unpack the common payload. It should hold the application payload, as
    // well as a list of recipients of this message:
    let ret = null;
    try {
      const parsedCommonPayload: commonPayloadType = JSON.parse(commonPayload);

      // Use a WASM call to consistently sort the destination keys across platforms:
      const sortedRecipients =
	this.messageChains.sort_recipients(parsedCommonPayload.recipients);

      let localSeq = this.messageChains.insert_message(
        sender,
        parsedCommonPayload.applicationPayload,
        sortedRecipients,
      );
      this.#dumpState();

      ret = [localSeq, parsedCommonPayload.applicationPayload];
    } catch (e) {
      console.log(`Error while processing received common payload, discarding message: ${e}`);
    }

    // Process the validation payload. If that fails something's wrong we should
    // throw an error!
    try {
      const parsedRecipientPayload: recipientPayloadType = JSON.parse(recipientPayload);

      const trimmedChainEntries = this.messageChains.validate_trim_chain(
        sender,
        parsedRecipientPayload.validationSeq,
        parsedRecipientPayload.validationDigest
      );
      this.#dumpState();

      console.log(`Byzantine server detection validated validation payload, `
        + `trimmed ${trimmedChainEntries} entires.`);

      if (sender == this.ownIdkey && parsedRecipientPayload.consistencyLoopback) {
        // This message has been sent back to us just for the consistency
        // validation, discard it:
        ret = null;
      }
    } catch (e) {
      console.log(`Error during Byzantine server validation: ${e}`);
    }

    return ret;
  }
}
