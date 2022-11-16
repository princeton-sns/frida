
import {LocalStorage} from 'node-localstorage'
import * as frida from "../../../core/client/index.js";
import * as cryp from "crypto";
import fetch, {Headers} from 'node-fetch'

import * as fs from 'fs';


var localStorage = null;
var tid = process.argv[2];

var config = JSON.parse(fs.readFileSync('./src/self_config.json', { encoding: 'utf8' }));

var latencies = new Array(config.duration * config.rate + 1);

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

function waitFor(conditionFunction, poll_time = 0) {
    const poll = resolve => {
      if(conditionFunction()) resolve();
      else setTimeout(_ => poll(resolve), poll_time);
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
    await frida.setData(config.dataPrefix, oid, generate_obj(oid));
    // frida.setData(config.dataPrefix, oid, generate_obj(oid));
}

function save_data(data){
    fs.mkdir('./'+config.output_dir, { recursive: true}, function (err) {
        if (err) console.log(err);
        fs.writeFile('./' + config.output_dir + '/device_' + tid, data, (err) =>{
            if(err) console.log(err);
        });
    });
}

await frida.init(
    config.serverIP,
    config.serverPort,
    {   storagePrefixes: [config.dataPrefix], 
        turnEncryptionOff: true,
        onSend: (msg) =>{
            msg.clientSeqID = frida.clientSeqID.id;
            latencies[frida.clientSeqID.id++] = performance.now();
        },
        onRecv: (msgs) => {
            msgs.forEach(msg => {
                if(msg.sender == frida.getIdkey()){
                    latencies[msg.clientSeqID] = performance.now() - latencies[msg.clientSeqID];
                }
            });
        }
    }
);

await sleep(1000);

await frida.createDevice("LinkedDevice " + tid, "device_" + tid);


var idkey = frida.getIdkey();


console.log("device_"+tid + ": " + idkey);


var data_obj = generate_obj();
var oid = data_obj.id;

await frida.setData(config.dataPrefix, oid, data_obj);

await sleep(1000);

process.send({type: "ready"});


process.on('message', (msg) => {
    if(msg.type == "start"){
        simulate_send();
    }
});

var period = 1000/config.rate; 

async function simulate_send(){
    var start_time = performance.now();

    for(var cnt = 0; cnt < config.duration * config.rate; cnt++){
        await waitFor(() => performance.now() - start_time >= cnt * period);
        // Device sends messages asynchronously
        update_data(oid);
    }
    
    await sleep(1000);
    
    // The first sendMessage is not recorded --- it's used for setup data object
    // for(var cnt = 1; cnt < frida.clientSeqID.id; cnt++){
    //     console.log("client[%s],req[%s]: %s ms",tid, cnt, latencies[cnt]);
    // }    
    
    latencies.shift();
    
    save_data(latencies.join("\n"));
}

