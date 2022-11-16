
import {LocalStorage} from 'node-localstorage'
import * as frida from "../../../core/client/index.js";
import * as cryp from "crypto";
import fetch, {Headers} from 'node-fetch'

// import {fs} from 'fs';
// import * as child_process from 'child_process'
// import { getIdkey } from '../../../core/client/crypto/olmWrapper.js';

var localStorage = null;
var tid = process.argv[2];
// var config = process.argv[3];
var config = {
    // serverIP: "sns26.cs.princeton.edu",
    serverIP: "localhost",
    serverPort: "8080",
    dataPrefix: "ConfigAppData",
    num_clients: 2,
    data_size: 32,
    duration: 1,
    rate: 1
}

if (typeof localStorage === "undefined" || localStorage === null) {
    global.localStorage = new LocalStorage('device_' + tid);
}

if (typeof confirm === "undefined" || confirm === null) {
    global.confirm = (x) => {console.log("confirmed on device_" + tid); return true;}
}

if (typeof crypto === "undefined" || crypto === null) {
    global.crypto = cryp;
}

if (!globalThis.fetch) {
    globalThis.fetch = fetch
    globalThis.Headers = Headers
}

var data_size = config.data_size;

await frida.init(
    config.serverIP, 
    config.serverPort, 
    {   storagePrefixes: 
        [config.dataPrefix], 
        turnEncryptionOff: true
    }
);

function waitFor(conditionFunction) {
    const poll = resolve => {
      if(conditionFunction()) resolve();
      else setTimeout(_ => poll(resolve), 400);
    }
    return new Promise(poll);
}

function sync(cond, after){
    waitFor(cond).then(after);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function generate_obj(oid = null){
    if(oid === null){
        oid =  crypto.randomUUID();
    }
    var timestamp = new Date();
    var dataObj = new ArrayBuffer(config.data_size);
    return {id: oid, timestamp: new Date(), dataObj: crypto.randomBytes(config.data_size).toString('hex')};
}

async function update_data(oid){
    // await frida.setData(config.dataPrefix, oid, generate_obj(oid));
    frida.setData(config.dataPrefix, oid, generate_obj(oid));
}

await frida.createDevice("LinkedDevice " + tid, "device_" + tid);
await new Promise(r => setTimeout(r, 1000));

var idkey = frida.getIdkey();
var oid;

process.send({type: "idkey", wid: tid, idKey: idkey});



console.log("device_"+tid + ": " + idkey);

process.on('message', (msg) => {
    if(msg.type == "ready_to_send"){
        oid = msg.obj_id;
        simulate_send();
    }
});

async function simulate_send(){
    for(var cnt = 0; cnt < config.duration * config.rate; cnt++){
        await sleep(1000/config.rate);
        update_data(oid);
    }
}
