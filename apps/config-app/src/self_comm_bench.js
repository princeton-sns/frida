import {LocalStorage} from 'node-localstorage'
import * as cryp from "crypto";
import fetch, {Headers} from 'node-fetch'
import * as fs from 'fs';
import {Higher} from "../../../higher/index.js";
import io from "socket.io-client";

var frida;
var benchID = parseInt(process.argv[2]);
// var config_path = process.argv[3];
// var config = JSON.parse(fs.readFileSync(config_path, { encoding: 'utf8' }));
var config;
var localStorage = null;

let coordIP = "localhost";
let coordPort = "8085";

if (typeof localStorage === "undefined" || localStorage === null) {
    global.localStorage = new LocalStorage('device_' + benchID);
}

if (typeof crypto === "undefined" || crypto === null) {
    global.crypto = cryp;
}

if (!globalThis.fetch) {
    globalThis.fetch = fetch;
    globalThis.Headers = Headers;
}

function waitFor(conditionFunction, poll_time = 0) {
    const poll = resolve => {
      if(conditionFunction()) resolve();
      else setTimeout(_ => poll(resolve), poll_time);
    }
    return new Promise(poll);
}

function wait_barrier(coord, message){
    const waitfor = resolve => {
        coord.on("release", (msg) => {
            resolve(msg)
        });
        coord.emit("barrier", message);
    }
    return new Promise(waitfor);
}

function wait_config(coord){
    const waitfor = resolve => {
        coord.on("config", (msg) => {
            resolve(msg)
        });
        coord.emit("config", {});
    }
    return new Promise(waitfor);
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

function save_data(data, id, suffix){
    fs.mkdir('./'+config.output_dir, { recursive: true}, function (err) {
        if (err) console.log(err);
        fs.writeFile('./' + config.output_dir + '/device_' + id + '_' + suffix, data, (err) =>{
            if(err) console.log(err);
        });
    });
}


(async () =>{

let remote_coord = await io("http://"+ coordIP +":" + coordPort);

config = await wait_config(remote_coord);

global.benchConfig = {
    "benchOpts" : "00011000",
    "timeStampsLog" : []
}

frida = await Higher.create(
    {   storagePrefixes: [config.dataPrefix], 
        turnEncryptionOff: !config.encryption
    },
    config.serverIP,
    config.serverPort,
);

// Potential bug: await init() does not guarantee that server will setup mailbox, so message might be lost if sent immediately
await sleep(1000);

let myIdkey = await frida.createDevice("LinkedDevice_" + benchID, "device_" + benchID);

console.log("device_" + benchID + ": " + myIdkey);

global.myIdkeyForBench = myIdkey;
global.clientSeq = 0;
global.cseqSendLogs = [];
global.cseqRecvLogs = []

global.recordTime = () => {
    global.benchConfig?.timeStampsLog?.push(performance.now());
}

global.noop = () => {}

global.recordSendTime = () => {
    global.benchConfig?.timeStampsLog?.push(performance.now());
    global.cseqSendLogs?.push(global.clientSeq);
    global.clientSeq++;
}

global.recordRecvTime = (msg) => {
    if(msg.sender == global.myIdkeyForBench){
        global.benchConfig?.timeStampsLog?.push(performance.now());
        global.cseqRecvLogs?.push(msg.clientSeq);
    }
}

global.resetLog = () => {
    global.benchConfig.timeStampsLog.length = 0;
}

global.beforeHigherSetData = benchConfig?.benchOpts[0] == "1" ? recordTime : noop;
global.beforeCoreEncrypt = benchConfig?.benchOpts[1] == "1" ? recordTime : noop;
global.afterCoreEncrypt = benchConfig?.benchOpts[2] == "1" ? recordTime : noop;
global.beforeCommSend = benchConfig?.benchOpts[3] == "1" ? global.recordSendTime : noop;
global.afterCommRecv = benchConfig?.benchOpts[4] == "1" ? global.recordRecvTime : (msg) => {};
global.beforeCoreDecrypt = benchConfig?.benchOpts[5] == "1" ? recordTime : noop;
global.afterCoreDecrypt = benchConfig?.benchOpts[6] == "1" ? recordTime : noop;
global.afterHigherOnMessage = benchConfig?.benchOpts[7] == "1" ? recordTime : noop;

var data_obj = generate_obj();
var oid = data_obj.id;

await frida.setData(config.dataPrefix, oid, data_obj);

var period = 1000/config.rate; 


await wait_barrier(remote_coord, myIdkey);


simulate_send();

async function simulate_send(){
    await sleep(1000);
    resetLog();
    var start_time = performance.now();

    for(var cnt = 0; cnt < config.duration * config.rate; cnt++){
        await waitFor(() => performance.now() - start_time >= cnt * period);
        // Device sends messages asynchronously
        update_data(oid);
    }
    
    await sleep(3000);
    
    console.log("-------------------------------");
    // console.log(global.benchConfig.timeStampsLog);
    // console.log(global.cseqSendLogs);
    // console.log(global.cseqRecvLogs);

    let combined_timestamps = await wait_barrier(remote_coord, global.benchConfig.timeStampsLog);
    let combined_cseqSend = await wait_barrier(remote_coord, global.cseqSendLogs);
    let combined_cseqRecv = await wait_barrier(remote_coord, global.cseqRecvLogs);

    for(var i = 0; i < combined_timestamps.length; i++){
        save_data(combined_timestamps[i].join("\n"), i, "timestamps");
        save_data(combined_cseqSend[i].join("\n"), i, "cseqSend");
        save_data(combined_cseqRecv[i].join("\n"), i, "cseqRecv");
    }

    // The first sendMessage is not recorded --- it's used for setup data object
    // for(var cnt = 1; cnt < frida.clientSeqID.id; cnt++){
    //     console.log("client[%s],req[%s]: %s ms",tid, cnt, latencies[cnt]);
    // }    

    
    // latencies.shift();

    // save_data(latencies.join("\n"));
    
}


}
)();