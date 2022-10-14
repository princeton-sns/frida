const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);

// CORS (Cross-Origin Resource Sharing) allows our front-end
// and back-end to share data
const cors = require("cors");
const { Server } = require("socket.io");

const io = new Server(server, {
  cors: {
    origin: "*",
    allowedHeaders: ["Access-Control-Allow-Origin"],
  },
});

// Set sequence number count to start at 0
let seqID = 0;

// List of idkeys and corresponding mailboxes
let devices = {};

// Maps that make unlinking a socketID from a idkey more efficient, 
// since it needs to determine idkey from socketID
let deviceToSocket = {};
let socketToDevice = {};

function init(port) {
  server.listen(port, () => {
    console.log("listening on *:" + port);
  });
}

function printDevices() {
  console.log();
  console.log("-- all devices...");
  console.log(devices);
  console.log("** per device...");
  for ([deviceIdkey, deviceInfo] of Object.entries(devices)) {
    console.log("**** device idkey");
    console.log(deviceIdkey);
    console.log("**** device otkeys");
    console.log(deviceInfo.otkeys);
    if (deviceInfo.mailbox.length > 0) {
      console.log("**** mailbox contents");
      deviceInfo.mailbox.forEach((x) => {
        console.log(x);
      });
      console.log("****");
    }
  }
  console.log("-- done printing");
  console.log();
}

function handleOffline(
    dstIdkey,
    eventName,
    data) {
  // check if device is online
  console.log();
  console.log("-- in handleOffline");
  console.log();
  console.log(dstIdkey);
  console.log(eventName);
  console.log(data);
  if (deviceToSocket[dstIdkey] === undefined) {
    console.log("ERROR no socket for idkey");
    console.log(deviceToSocket);
    console.log(dstIdkey);
  } else if (deviceToSocket[dstIdkey] !== -1) {
    console.log("-> forwarding immedietely");
    io.to(deviceToSocket[dstIdkey]).emit(eventName, data);
  } else {
    // otherwise atomically append to mailbox array
    console.log("-> appending to mailbox");
    devices[dstIdkey].mailbox.push({
      eventName: eventName, 
      data: data,
    });
    console.log("updated mailbox");
    printDevices();
  }
  console.log("-- done handling offline");
  console.log();
}

io.on("connection", (socket) => {

  socket.on("linkSocket", (idkey) => {
    if (devices[idkey]) {
      let socketID = socket.id;
      deviceToSocket[idkey] = socketID;
      socketToDevice[socketID] = idkey;

      console.log("linking socketIDs");
      console.log("deviceToSocket:");
      console.log(deviceToSocket);
      console.log("socketToDevice:");
      console.log(socketToDevice);

      // poll mailbox
      let mailbox = devices[idkey].mailbox;
      let mail;
      if (mailbox.length) {
        while (socketID === socket.id && (mail = mailbox.shift())) { // while the same connection is open
          io.to(deviceToSocket[idkey]).emit(mail.eventName, { ...mail.data });
          // TODO need callbacks to ensure emitted event went through
          // mailbox.unshift(mail);
        }
      }
    }
  });

  socket.on("addDevice", ({ idkey, otkeys }) => {
    devices[idkey] = { otkeys: otkeys, mailbox: [] };
    console.log("added device");
    printDevices();
  });

  socket.on("removeDevice", (idkey) => {
    delete devices[idkey];
    delete deviceToSocket[idkey];
    console.log("deleted device");
    printDevices();
  });

  socket.on("getOtkey", ({ srcIdkey, dstIdkey }) => {
    console.log("getting otkey");
    let dstOtkeys = devices[dstIdkey].otkeys;
    let numOtkeys = dstOtkeys.length;
    if (numOtkeys < 5) {
      console.log("notify client to replenish otkeys");
      console.log("client: " + dstIdkey);
      console.log("num otkeys left: " + numOtkeys);
    }
    let key;
    let dstOtkey;
    let keysArr = Object.keys(dstOtkeys);
    for (i in keysArr) {
      key = keysArr[i];
      dstOtkey = dstOtkeys[key];
      break;
    }
    delete dstOtkeys[key];
    // updated devices (needs a lock)
    devices[dstIdkey].otkeys = dstOtkeys;
    // send otkey to srcIdkey
    io.to(deviceToSocket[srcIdkey]).emit("getOtkey", {
      idkey: dstIdkey,
      otkey: dstOtkey,
    });
  });

  socket.on("unlinkSocket", (idkey) => {
    delete socketToDevice[socket.id];
    if (deviceToSocket[idkey]) {
      deviceToSocket[idkey] = -1;
    }
    console.log("unlinking socketIDs");
    console.log(deviceToSocket);
    console.log(socketToDevice);
  });

  socket.on("disconnect", () => {
    let socketID = socket.id;
    let idkey = socketToDevice[socketID];
    if (idkey) {
      delete socketToDevice[socketID];
      deviceToSocket[idkey] = -1;
      console.log("unlinking socketIDs");
      console.log(deviceToSocket);
      console.log(socketToDevice);
    }
  }); 

  socket.on("noiseMessage",
    ({
      srcIdkey,
      batch,
    }) => {
      console.log();
      console.log("RECEIVED NOISE MESSAGE");
      console.log();
      let curSeqID = seqID++;
      batch.forEach(({ dstIdkey, encPayload }) => {
        handleOffline(dstIdkey, "noiseMessage", {
          srcIdkey: srcIdkey,
          seqID: curSeqID,
          encPayload: encPayload,
        });
      });
      console.log();
    }
  );
});

module.exports.init = init;
