/*
 ****************
 * Server comms *
 ****************
 */

import io from "socket.io-client";
import { onMessage, getPubkey } from "../index.js";

const HTTP_PREFIX = "http://";
const COLON = ":";

let socket;

export function init(ip, port) {
  let url = HTTP_PREFIX + ip + COLON + port;
  socket = io(url);

  socket.on("connect", () => {
    let pubkey = getPubkey();
    if (pubkey) {
      connect(pubkey);
    }
  });

  socket.on("noiseMessage", (msg) => {
    onMessage(msg);
  });
}

export function connect(pubkey) {
  socket.emit("linkSocket", pubkey);
}

export function disconnect(pubkey) {
  socket.emit("unlinkSocket", pubkey);
}

export function sendMessage(msg) {
  socket.emit("noiseMessage", msg);
}

export function addDevice(pubkey) {
  socket.emit("addDevice", pubkey);
}

export function removeDevice(pubkey) {
  socket.emit("removeDevice", pubkey);
}
