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

// List of pubkeys and corresponding mailboxes
let devices = {};

// Maps that make unlinking a socket_id from a pubkey more efficient, 
// since it needs to determine pubkey from socket_id
let device_to_socket = {};
let socket_to_device = {};

function init(port) {
  server.listen(port, () => {
    console.log("listening on *:" + port);
  });
}

function print_devices() {
  console.log(devices);
  for ([pubkey, server_obj] of Object.entries(devices)) {
    if (pubkey == "groupID") continue;
    if (server_obj.mailbox.length > 0) {
      console.log("*** mailbox contents...");
      server_obj.mailbox.forEach((x) => {
        console.log(x);
      });
      console.log("***");
    }
  }
}

function handle_offline(
    dst_pubkey,
    src_pubkey,
    event_name,
    data) {
  console.log("event_name: " + event_name);
  // check if device is online
  if (device_to_socket[dst_pubkey] !== -1) {
    console.log("-> forwarding immedietely");
    io.to(device_to_socket[dst_pubkey]).emit(event_name, data);
  } else {
    // otherwise atomically append to mailbox array
    console.log("-> appending to mailbox");
    devices[dst_pubkey].mailbox.push({
      src_pubkey: src_pubkey,
      event_name: event_name, 
      data: data,
    });
    console.log("updated mailbox");
    print_devices();
  }
}

io.on("connection", (socket) => {

  socket.on("link_socket", ({ pubkey }) => {
    if (devices[pubkey]) {
      let socket_id = socket.id;
      device_to_socket[pubkey] = socket_id;
      socket_to_device[socket_id] = pubkey;
      console.log("linking socket_ids");
      console.log(device_to_socket);
      console.log(socket_to_device);
      // poll mailbox
      let mailbox = devices[pubkey].mailbox;
      let mail;
      if (mailbox.length) {
        while (socket_id === socket.id && (mail = mailbox.shift())) { // while the same connection is open
          io.to(device_to_socket[pubkey]).emit(mail.event_name, { ...mail.data });
          // TODO need callbacks to ensure emitted event went through
          // mailbox.unshift(mail);
        }
      }
    }
  });

  socket.on("server_add_device", ({ pubkey, contents }) => {
    devices[pubkey] = contents;
    console.log("added device");
    print_devices();
  });

  socket.on("server_delete_device", ({ pubkey }) => {
    delete devices[pubkey];
    delete device_to_socket[pubkey];
    console.log("deleted device");
    print_devices();
  });

  socket.on("unlink_socket", ({ pubkey }) => {
    delete socket_to_device[socket.id];
    if (device_to_socket[pubkey]) {
      device_to_socket[pubkey] = -1;
    }
    console.log("unlinking socket_ids");
    console.log(device_to_socket);
    console.log(socket_to_device);
  });

  socket.on("disconnect", () => {
    let socket_id = socket.id;
    let pubkey = socket_to_device[socket_id];
    if (pubkey) {
      delete socket_to_device[socket_id];
      device_to_socket[pubkey] = -1;
      console.log("unlinking socket_ids");
      console.log(device_to_socket);
      console.log(socket_to_device);
    }
  }); 

  socket.on("noise_message",
    ({
      dst_pubkey,
      src_pubkey,
      nonce,
      enc_payload,
    }) => {
      handle_offline(dst_pubkey, src_pubkey, "noise_message", {
        src_pubkey: src_pubkey,
        enc_payload: enc_payload,
        nonce: nonce,
      });
    }
  );
});

module.exports.init = init;
