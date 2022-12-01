import * as child_process from 'child_process'
import {LocalStorage} from 'node-localstorage'
import * as cryp from "crypto";
import fetch, {Headers} from 'node-fetch'
import * as fs from 'fs';
import {Higher} from "../../../higher/index.js";

var frida;
    
var config = JSON.parse(fs.readFileSync('./src/self_config.json', { encoding: 'utf8' }));


var wrks = new Array(config.num_clients);
var ready_wrks = 1;

var localStorage = null;
var tid = 0;


var latencies = new Array(config.duration * config.rate + 1);

if (typeof localStorage === "undefined" || localStorage === null) {
    global.localStorage = new LocalStorage('device_' + tid);
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

(async () =>{

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



// await frida.init(
//     config.serverIP,
//     config.serverPort,
//     {   storagePrefixes: [config.dataPrefix], 
//         turnEncryptionOff: true,
//         onSend: (msg) =>{
//             msg.clientSeqID = frida.clientSeqID.id;
//             latencies[frida.clientSeqID.id++] = performance.now();
//         },
//         onRecv: (msgs) => {
//             msgs.forEach(msg => {
//                 if(msg.sender == myIdkey){
//                     latencies[msg.clientSeqID] = performance.now() - latencies[msg.clientSeqID];
//                 }
//             });
//         }
//     }
// );

// Potential bug: await init() does not guarantee that server will setup mailbox, so message might be lost if sent immediately
await sleep(1000);

let myIdkey = await frida.createDevice("LinkedDevice_" + tid, "device_" + tid);

console.log("device_0: " + myIdkey);

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

global.beforeHigherSetData = benchConfig?.benchOpts[0] == "1" ? recordTime : noop;
global.beforeCoreEncrypt = benchConfig?.benchOpts[1] == "1" ? recordTime : noop;
global.afterCoreEncrypt = benchConfig?.benchOpts[2] == "1" ? recordTime : noop;
global.beforeCommSend = benchConfig?.benchOpts[3] == "1" ? global.recordSendTime : noop;
global.afterCommRecv = benchConfig?.benchOpts[4] == "1" ? global.recordRecvTime : (msg) => {};
global.beforeCoreDecrypt = benchConfig?.benchOpts[5] == "1" ? recordTime : noop;
global.afterCoreDecrypt = benchConfig?.benchOpts[6] == "1" ? recordTime : noop;
global.afterHigherOnMessage = benchConfig?.benchOpts[7] == "1" ? recordTime : noop;


for(var i = 1; i < config.num_clients; i++) {

    wrks[i] = child_process.fork("src/" + config.client_type + ".js", [i]);	

    wrks[i].on('close', function (code) {
        console.log('exited with ' + code);
    });

    wrks[i].on('message', (msg) => {
        if(msg.type == "ready"){
            ready_wrks++;
        }
    });
}




var data_obj = generate_obj();
var oid = data_obj.id;

await frida.setData(config.dataPrefix, oid, data_obj);



var period = 1000/config.rate; 

await waitFor(() => ready_wrks == config.num_clients, 300);

for(var i = 1; i < config.num_clients; i++) {
    wrks[i].send({type: "start"});
}

simulate_send();

async function simulate_send(){
    await sleep(1000);
    global.benchConfig.timeStampsLog.length = 0;
    var start_time = performance.now();

    for(var cnt = 0; cnt < config.duration * config.rate; cnt++){
        await waitFor(() => performance.now() - start_time >= cnt * period);
        // Device sends messages asynchronously
        update_data(oid);
    }
    
    await sleep(1000);
    
    console.log("-------------------------------");
    console.log(global.benchConfig.timeStampsLog);
    console.log(global.cseqSendLogs);
    console.log(global.cseqRecvLogs);

    // The first sendMessage is not recorded --- it's used for setup data object
    // for(var cnt = 1; cnt < frida.clientSeqID.id; cnt++){
    //     console.log("client[%s],req[%s]: %s ms",tid, cnt, latencies[cnt]);
    // }    

    
    // latencies.shift();

    // save_data(latencies.join("\n"));
    
}


}
)();