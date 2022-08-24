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

// List of pubkeys and corresponding mailboxes
let devices = {};

// Maps that make unlinking a socketID from a pubkey more efficient, 
// since it needs to determine pubkey from socketID
let deviceToSocket = {};
let socketToDevice = {};

function init(port) {
  server.listen(port, () => {
    console.log("listening on *:" + port);
  });
}

function printDevices() {
  console.log(devices);
  for ([devicePubkey, deviceInfo] of Object.entries(devices)) {
    if (devicePubkey == "groupID") continue;
    if (deviceInfo.mailbox.length > 0) {
      console.log("*** mailbox contents...");
      deviceInfo.mailbox.forEach((x) => {
        console.log(x);
      });
      console.log("***");
    }
  }
}

function handleOffline(
    dstPubkey,
    eventName,
    data) {
  // check if device is online
  if (deviceToSocket[dstPubkey] !== -1) {
    console.log("-> forwarding immedietely");
    io.to(deviceToSocket[dstPubkey]).emit(eventName, data);
  } else {
    // otherwise atomically append to mailbox array
    console.log("-> appending to mailbox");
    devices[dstPubkey].mailbox.push({
      eventName: eventName, 
      data: data,
    });
    console.log("updated mailbox");
    printDevices();
  }
}

io.on("connection", (socket) => {

  socket.on("linkSocket", (pubkey) => {
    if (devices[pubkey]) {
      let socketID = socket.id;
      deviceToSocket[pubkey] = socketID;
      socketToDevice[socketID] = pubkey;

      console.log("linking socketIDs");
      console.log("deviceToSocket:");
      console.log(deviceToSocket);
      console.log("socketToDevice:");
      console.log(socketToDevice);

      // poll mailbox
      let mailbox = devices[pubkey].mailbox;
      let mail;
      if (mailbox.length) {
        while (socketID === socket.id && (mail = mailbox.shift())) { // while the same connection is open
          io.to(deviceToSocket[pubkey]).emit(mail.eventName, { ...mail.data });
          // TODO need callbacks to ensure emitted event went through
          // mailbox.unshift(mail);
        }
      }
    }
  });

  socket.on("addDevice", (pubkey) => {
    devices[pubkey] = { mailbox: [] };
    console.log("added device");
    printDevices();
  });

  socket.on("removeDevice", (pubkey) => {
    delete devices[pubkey];
    delete deviceToSocket[pubkey];
    console.log("deleted device");
    printDevices();
  });

  socket.on("unlinkSocket", (pubkey) => {
    delete socketToDevice[socket.id];
    if (deviceToSocket[pubkey]) {
      deviceToSocket[pubkey] = -1;
    }
    console.log("unlinking socketIDs");
    console.log(deviceToSocket);
    console.log(socketToDevice);
  });

  socket.on("disconnect", () => {
    let socketID = socket.id;
    let pubkey = socketToDevice[socketID];
    if (pubkey) {
      delete socketToDevice[socketID];
      deviceToSocket[pubkey] = -1;
      console.log("unlinking socketIDs");
      console.log(deviceToSocket);
      console.log(socketToDevice);
    }
  }); 

  socket.on("noiseMessage",
    ({
      srcPubkey,
      batch,
    }) => {
      let curSeqID = seqID++;
      batch.forEach(({ dstPubkey, encPayload, nonce }) => {
        handleOffline(dstPubkey, "noiseMessage", {
          srcPubkey: srcPubkey,
          seqID: curSeqID,
          encPayload: encPayload,
          nonce: nonce,
        });
      });
    }
  );
});

module.exports.init = init;
