import * as child_process from 'child_process'

import {LocalStorage} from 'node-localstorage'
// import * as frida from "../../../core/client/index.js";
import * as cryp from "crypto";
import fetch, {Headers} from 'node-fetch'
import { Higher } from "../../../higher";

var config = {
    // serverIP: "sns26.cs.princeton.edu",
    serverIP: "localhost",
    serverPort: "8080",
    dataPrefix: "ConfigAppData",
    client_type : "passive_clients",
    num_clients: 2,
    data_size: 32,
    duration: 1,
    rate: 1
}

var wrks = new Array(config.num_clients);
var wrk_ids = new Array(config.num_clients);

var localStorage = null;
var tid = 0;

if (typeof localStorage === "undefined" || localStorage === null) {
    global.localStorage = new LocalStorage('device_' + tid);
}

if (typeof crypto === "undefined" || crypto === null) {
    global.crypto = cryp;
}

if (!globalThis.fetch) {
    globalThis.fetch = fetch
    globalThis.Headers = Headers
}

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

let frida = await Higher.create(
    {   storagePrefixes: [config.dataPrefix], 
        turnEncryptionOff: true
    },
    config.serverIP,
    config.serverPort,
);

await frida.createDevice("LinkedDevice_" + tid, "device_" + tid);

console.log("device_0: " + frida.getIdkey());


var idkey_msg_cnt = 0;


for(var i = 1; i < config.num_clients; i++) {

    wrks[i] = child_process.fork("src/" + config.client_type + ".js", [i]);	

    wrks[i].on('close', function (code) {
        console.log('exited with ' + code);
    });

    wrks[i].on('message', (msg) => {
        if(msg.type == "idkey"){
            wrk_ids[msg.wid] = msg.idKey;
            frida.addContact(msg.idKey);
            idkey_msg_cnt += 1;
        }
    });
}




var data_obj = generate_obj();
var oid = data_obj.id;

await frida.setData(config.dataPrefix, oid, data_obj);

sync(() => (idkey_msg_cnt == config.num_clients - 1) &&
           (frida.getContacts().length == config.num_clients - 1), 
           grantPrivs);

async function grantPrivs(){
    console.log("contacts of master: " + frida.getContacts());

    // Can't foreach if want sequential updates!
    for(const friend of frida.getContacts()){
        await frida.grantWriterPrivs(config.dataPrefix, oid , friend);

        // Bug occured here: if no sleep, some devices will panic with "parents are null"
        await sleep(300);
    }

    const wait_time = 5;
    console.log("*********************** Starting simulation in %d seconds ***********************", wait_time);
    await sleep(wait_time * 1000);
    for(var i = 1; i < config.num_clients; i++) {
        wrks[i].send({type: "ready_to_send", obj_id: oid});
    }
    simulate_send();
}

async function simulate_send(){
    for(var cnt = 0; cnt < config.duration * config.rate; cnt++){
        await sleep(1000/config.rate);
        update_data(oid);
    }
}