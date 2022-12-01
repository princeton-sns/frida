const io =  require("socket.io-client");

function wait_barrier(barrier, message){
    const waitfor = resolve => {
        barrier.on("release", (msg) => {
            resolve(msg)
        });
        barrier.emit("barrier", message);
    }
    return new Promise(waitfor);
}

(async ()=>{
    var benchID = parseInt(process.argv[2]);

    console.log("starting...");
    const socket = await io("http://localhost:8085");
    let res = await wait_barrier(socket, benchID);
    console.log(res);
    console.log("released");
})();

