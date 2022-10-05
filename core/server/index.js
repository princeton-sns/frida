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
    //if (deviceIdkey == "groupID") continue;
    console.log("**** device idkey");
    console.log(deviceIdkey);
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
  console.log("-- in handleOffline");
  console.log(dstIdkey);
  console.log(eventName);
  console.log(data);
  if (deviceToSocket[dstIdkey] !== -1) {
    console.log("-> forwarding immedietely");
    // i think it's better to piggyback otkeys than have separate messages for
    // requesting them (which would compromise some metadata privacy)
    // TODO maybe: only generate one otkey at a time, may not even need to send
    // to server, just piggyback a new otkey with every outgoing message?
    io.to(deviceToSocket[dstIdkey]).emit(eventName, data);
    //{
    //  ...data, srcOtkeys: devices[data.srcIdkey].otkeys
    //});
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

  socket.on("addDevice", (idkey) => {
    devices[idkey] = { mailbox: [] };
    console.log("added device");
    printDevices();
  });

  socket.on("removeDevice", (idkey) => {
    delete devices[idkey];
    delete deviceToSocket[idkey];
    console.log("deleted device");
    printDevices();
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
      console.log("RECEIVED NOISE MESSAGE");
      let curSeqID = seqID++;
      batch.forEach(({ dstIdkey, encPayload, nonce }) => {
        console.log(dstIdkey);
        console.log(encPayload);
        console.log(nonce);
        handleOffline(dstIdkey, "noiseMessage", {
          srcIdkey: srcIdkey,
          seqID: curSeqID,
          encPayload: encPayload,
          nonce: nonce,
        });
      });
    }
  );
});

module.exports.init = init;
