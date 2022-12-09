const crypto = require("crypto");
const MessageChains = require("../../core/messagechains/pkg").Sha256StringMessageChains;

function deviceDebug(device, message) {
    console.log(`DEBUG{${device}}:`, message);
}

class NoiseDevice {
    deviceId;
    chains;
    enableDebug = false;

    constructor(deviceId, enableDebug) {
	this.enableDebug = enableDebug === true;
	this.deviceId = deviceId;
        this.chains = MessageChains.new(deviceId);

	this.debug("Creating device and message chains instance");
    }

    debug(message) {
	if (this.enableDebug) {
	    deviceDebug(this.deviceId, message);
	}
    }

    receiveMessage(senderId, message, recipientIds) {
	this.debug(`Received message "${message}" from ${senderId}`);
	this.chains.insert_message(
	    senderId,
	    message,
	    recipientIds,
	);
    }

    receiveValidationPayload(senderId, validationSeq, validationDigest) {
	this.debug(`Received validation payload from ${senderId}`);
	this.chains.validate_trim_chain(
	    senderId,
	    validationSeq,
	    validationDigest,
	);
    }

    sendMessage(remoteDevices, message) {
	let unsortedRecipientIds = [ this.deviceId ].concat(
	    remoteDevices.map(d => d.deviceId));
	const recipientIds = this.chains.sort_recipients(unsortedRecipientIds);

	this.debug(`Sending message "${message}" to ${remoteDevices.length} devices`);

	this.chains.send_message(message, recipientIds);

	for (const d of remoteDevices) {
	    d.receiveMessage(this.deviceId, message, recipientIds);
	    let validationPayload = this.chains.validation_payload(d.deviceId);
	    if (validationPayload) {
		d.receiveValidationPayload(this.deviceId, validationPayload[0], validationPayload[1]);
	    }
	}

	this.receiveMessage(this.deviceId, message, recipientIds);
    }
}

function measure(count, messageLength, unidirectional) {
    let devA = new NoiseDevice("deviceA");
    let devB = new NoiseDevice("deviceB");

    // Generate a random "message" of 1024 bytes.
    let message = crypto.randomBytes(messageLength).toString("hex");

    let startTime = Date.now();
    let exchangedMessages = 0;

    for (let i = 0; i < count; i++) {
	devA.sendMessage([devB], message);

	if (!unidirectional) {
	    devB.sendMessage([devA], message);
	    exchangedMessages += 2;
	} else {
	    exchangedMessages += 1;
	}
    }

    let endTime = Date.now();

    console.log(`Exchanging ${exchangedMessages} messages took ${endTime - startTime}ms.`);
    console.log(`Duration per message: ${(endTime - startTime) * 1000 / exchangedMessages}us.\n`);

    return [exchangedMessages, messageLength, endTime - startTime];
}

function interpretResults(result, constResult) {
    let relres = result;
    relres[2] = result[2] - constResult[2];
    console.log(`Overhead per byte: ${relres[2] * 1000000 / relres[0] / relres[1]}ns`);
}

const count = 100000;

measure(count, 1024, false);

console.log(`\n--- Warmup done ---\n\n`);

// let res0bU = measure(count, 0, true);
let res0bB = measure(count, 0, false);

// let res1kU = measure(count, 1024, true);
let res1kB = measure(count, 1024, true);
interpretResults(res1kB, res0bB);

let res2kB = measure(count, 2048, true);
interpretResults(res2kB, res0bB);

let res4kB = measure(count, 4096, true);
interpretResults(res4kB, res0bB);

let res8kB = measure(count, 8192, true);
interpretResults(res8kB, res0bB);



// let devADump = JSON.parse(devA.chains.dump());
// console.log("deviceA message chains struct:", devADump);
// console.log("deviceA message chains:", devADump.chains);

// let devBDump = JSON.parse(devB.chains.dump());
// console.log("deviceB message chains struct:", devBDump);
// console.log("deviceB message chains:", devBDump.chains);
