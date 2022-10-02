/*
 ****************
 * Server comms *
 ****************
 */

import io from "socket.io-client";
import { onMessage, getIdkey } from "../index.js";

const HTTP_PREFIX = "http://";
const COLON = ":";

let socket;

export function init(ip, port) {
  let url = HTTP_PREFIX + ip + COLON + port;
  socket = io(url);

  socket.on("connect", () => {
    let idkey = getIdkey();
    if (idkey) {
      connect(idkey);
    }
  });

  socket.on("noiseMessage", (msg) => {
    onMessage(msg);
  });
}

export function connect(idkey) {
  socket.emit("linkSocket", idkey);
}

export function disconnect(idkey) {
  socket.emit("unlinkSocket", idkey);
}

export function sendMessage(msg) {
  socket.emit("noiseMessage", msg);
}

export function addDevice(idkey) {
  socket.emit("addDevice", idkey);
}

export function removeDevice(idkey) {
  socket.emit("removeDevice", idkey);
}
