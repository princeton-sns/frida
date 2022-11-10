
import {LocalStorage} from 'node-localstorage'
import * as frida from "../../../core/client/index.js";
import * as cryp from "crypto";

// import {fs} from 'fs';
import * as child_process from 'child_process'
import { getIdkey } from '../../../core/client/crypto/olmWrapper.js';

var localStorage = null;
var tid = process.argv[2];
// var config = process.argv[3];
var config = {
    // serverIP: "sns26.cs.princeton.edu",
    serverIP: "localhost",
    serverPort: "8080",
    dataPrefix: "ConfigAppData",
    num_clients: 7,
    data_size: 32
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


var data_size = config.data_size;

await frida.init(
    config.serverIP, 
    config.serverPort, 
    {   storagePrefixes: 
        [config.dataPrefix], 
        turnEncryptionOff: true
    }
);

// await frida.deleteThisDevice();
await frida.createDevice("LinkedDevice " + tid, "device_" + tid);
await new Promise(r => setTimeout(r, 1000));

var idkey = frida.getIdkey();
// console.log("device_" )
process.send({wid: tid, idKey: idkey});



console.log("device_"+tid + ": " + idkey);

// console.log("contacts of client: " + frida.getContacts())

// console.log("linked name:", frida.getLinkedName());
// console.log("linked devices:", frida.getLinkedDevices());


// var timestamp = new Date();
// var dataObj = new ArrayBuffer(data_size);
// var id =  crypto.randomUUID();

// await frida.setData(configPrefix, id, {
//     id: id,
//     timestamp: timestamp,
//     dataObj: dataObj,
// });

// console.log("data:", frida.getData(configPrefix));

