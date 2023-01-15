import "localstorage-polyfill";
import { OlmWrapper } from "../../core/olmWrapper.js";
import crypto from "crypto";

class DummyServerComm {
    clients = {};

    registerClient(idkey, clientObject) {
	console.log("Registered client with identity", idkey);
	this.clients[idkey] = clientObject;
    }

    getOtkeyFromServer(dstIdkey) {
	return this.clients[dstIdkey].getOtkey()[1];
    }
}

class Client {
    olmWrapper;
    idkey;
    serverComm;

    // private not supported in Node 16.x
    constructor() {}

    async #init(serverComm, clientLabel) {
	this.olmWrapper = await OlmWrapper.create(false, undefined, clientLabel);
	this.olmWrapper.debug = false;
	this.idkey = await this.olmWrapper.generateInitialKeys();
	this.serverComm = serverComm;

	serverComm.registerClient(this.idkey, this);
    }

    static async create(serverComm, clientLabel) {
	let client = new Client();
	await client.#init(serverComm, clientLabel);
	return client;
    }

    getOtkey() {
	return Object.entries(this.olmWrapper.generateMoreOtkeys(1).otkeys)[0];
    }

    async encryptMessage(message, destination) {
	let enc = await this.olmWrapper.encrypt(
	    this.serverComm,
	    JSON.stringify({message: message}),
	    destination.idkey
	);
	return enc;
    }

    async decryptMessage(ciphertext, source) {
	let dec = await this.olmWrapper.decrypt(ciphertext, source.idkey);
	return JSON.parse(dec).message;
    }
}

async function measure(count, messageLength, encryptOnly) {
    let dummyServerComm = new DummyServerComm();

    let clientA = await Client.create(dummyServerComm, "a");
    let clientB = await Client.create(dummyServerComm, "b");

    // Generate a random "message" of 1024 bytes.
    let message = crypto.randomBytes(messageLength / 2).toString("hex");

    // Perform a bidirectional message exchange to ensure we're not
    // generating and using otkeys on every message exchange:
    if (encryptOnly) {
	let fencAB = await clientA.encryptMessage(message, clientB);
	let fdecAB = await clientB.decryptMessage(fencAB, clientA);

	let fencBA = await clientB.encryptMessage(message, clientA);
	let fdecBA = await clientA.decryptMessage(fencBA, clientB);
    }

    let startTime = Date.now();
    let exchangedMessages = 0;

    for (let i = 0; i < count; i++) {
	let encAB = await clientA.encryptMessage(message, clientB);
	let decAB = undefined;
	if (!encryptOnly) {
	    decAB = await clientB.decryptMessage(encAB, clientA);
	}

	let encBA = await clientB.encryptMessage(message, clientA);
	let decBA = undefined;
	if (!encryptOnly) {
	    decBA = await clientA.decryptMessage(encBA, clientB);
	}
	
	if ((!encryptOnly && (decAB !== message || decBA !== message)) || encAB === encBA) {
	    console.log(encryptOnly);
	    console.log(message);
	    console.log(decAB);
	    console.log(decBA);
	    console.log(encAB);
	    console.log(encBA);
            throw "Messages do not match or encrypted message identical";
	}

	exchangedMessages += 2;
    }

    let endTime = Date.now();

    console.log(`Encrypting ${!encryptOnly ? "& decrypting " : ""}${exchangedMessages} (${messageLength} bytes) messages took ${endTime - startTime}ms.`);
    console.log(`Duration per message: ${(endTime - startTime) * 1000 / exchangedMessages}us.`);
    console.log();

    localStorage.clear();

    return [exchangedMessages, messageLength, endTime - startTime];
}

function interpretResults(sendOnly, sendReceive, constantOverheadSend, constantOverheadReceive) {
    let sendTime = (constantOverheadSend) ? sendOnly[2] - constantOverheadSend : sendOnly[2];
    let sendReceiveTime = (constantOverheadSend) ? sendReceive[2] - constantOverheadReceive : sendReceive[2];
    let proportionEncryption = sendTime / sendReceiveTime;
    console.log(`Proportion of time spent on encryption ${(proportionEncryption * 100).toFixed(2)}%\n\n`)
    console.log(`Approx encryption time per byte: ${sendReceiveTime * 1000000 / sendOnly[0] / sendOnly[1] * proportionEncryption}ns`)
    console.log(`Approx decryption time per byte: ${sendReceiveTime * 1000000 / sendOnly[0] / sendOnly[1] * (1 - proportionEncryption)}ns`)
}

await measure(5000, 1024, false);

console.log("\n--- Warmup done ---\n\n");

let res0bS = await measure(10000, 0, true);
let res0bSR = await measure(10000, 0, false);

let res1kS = await measure(10000, 1024, true);
let res1kSR = await measure(10000, 1024, false);
interpretResults(res1kS, res1kSR, res0bS[2], res0bSR[2]);

let res2kS = await measure(10000, 2048, true);
let res2kSR = await measure(10000, 2048, false);
interpretResults(res2kS, res2kSR, res0bS[2], res0bSR[2]);

let res4kS = await measure(10000, 4096, true);
let res4kSR = await measure(10000, 4096, false);
interpretResults(res4kS, res4kSR, res0bS[2], res0bSR[2]);

let res8kS = await measure(10000, 8192, true);
let res8kSR = await measure(10000, 8192, false);
interpretResults(res8kS, res8kSR, res0bS[2], res0bSR[2]);

