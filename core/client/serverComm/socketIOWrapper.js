/*
 ****************
 * Server comms *
 ****************
 */

import io from "socket.io-client";
import { generateKeys, generateMoreOtkeys } from "../crypto/olmWrapper.js";
import { onMessage } from "../index.js";

const HTTP_PREFIX = "http://";
const COLON = ":";

let url;
let socket;
let idkey;

export async function init(ip, port) {
  url = HTTP_PREFIX + ip + COLON + port;
  idkey = await generateKeys();

  socket = io(url, {
    auth: {
      deviceId: idkey
    }
  });

  socket.on("addOtkeys", async () => {
    let u = new URL("/self/otkeys", url);

    let response = (await fetch(u, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + idkey
      },
      body: JSON.stringify(generateMoreOtkeys().otkeys)
    }));
    if (response.ok) {
      return (await response.json())['otkey']
    }
  });

  socket.on("noiseMessage", async (msgs) => {
    console.log("Noise message", msgs);
    msgs.forEach(msg => {
      onMessage(msg);
    });
    let maxId = Math.max(...msgs.map(msg => msg.seqID));
    let u = new URL("/self/messages", url);
    (await fetch(u, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + idkey
      },
      body: JSON.stringify({seqID: maxId})
    }));
  });
}

export async function sendMessage(msg) {
  console.log(msg);
  let u = new URL("/message", url);

  const headers = new Headers();
  headers.append('Authorization', 'Bearer ' + idkey)
  let response = (await fetch(u, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + idkey
    },
    body: JSON.stringify(msg)
  }));
  if (response.ok) {
    return (await response.json())
  }
}

export async function getOtkeyFromServer(device_id) {
  let u = new URL("/devices/otkey", url);
  let params = u.searchParams;
  console.log(device_id);
  params.set("device_id", encodeURIComponent(device_id));
  console.log(params);

  let response = (await fetch(u, {
    method: 'GET',

  }));
  if (response.ok) {
    return (await response.json())['otkey']
  }
}

export function disconnect() {
  if (socket) {
    socket.disconnect();
  }
}
