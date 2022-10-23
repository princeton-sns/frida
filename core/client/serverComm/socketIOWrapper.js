/*
 ****************
 * Server comms *
 ****************
 */

import io from "socket.io-client";
import { onMessage, getIdkey, setOtkey, generateMoreOtkeys } from "../index.js";

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

  //socket.onAny((eventName, ...args) => {
  //  console.log(eventName);
  //  console.log(args);
  //});

  socket.on("getOtkey", ({ idkey, otkey }) => {
    // TODO use a listener
    setOtkey(idkey, otkey);
  });


  socket.on("addOtkeys", () => {
    socket.emit("addOtkeys", generateMoreOtkeys());
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

export function addDevice(keys) {
  socket.emit("addDevice", keys);
}

export function removeDevice(idkey) {
  socket.emit("removeDevice", idkey);
}

export function getOtkey(idkeys) {
  socket.emit("getOtkey", idkeys);
}
