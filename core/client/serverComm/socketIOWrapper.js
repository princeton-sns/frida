/*
 *************************
 * Server Communications *
 *************************
 */

import io from "socket.io-client";
// FIXME probably need another "class" to wrap the basic client protocol
import { onMessage } from "../index.js";

const HTTP_PREFIX = "http://";
const COLON = ":";

// constructors cannot be async, so init() is doing most of the work
export function ServerComm(olmCrypto, ip, port) {
  this.url = HTTP_PREFIX + ip + COLON + port;
  this.olmCrypto = olmCrypto;
}

// ServerComm.prototype.init = async () => { DOESN'T WORK!!!
ServerComm.prototype.init = async function() {
  this.idkey = await this.olmCrypto.generateInitialKeys();

  this.socket = io(this.url, {
    auth: {
      deviceId: this.idkey
    }
  });

  this.socket.on("addOtkeys", async ({ needs }) => {
    let u = new URL("/self/otkeys", this.url);

    let response = (await fetch(u, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.idkey
      },
      body: JSON.stringify(this.olmCrypto.generateMoreOtkeys(needs).otkeys)
    }));
    if (response.ok) {
      return (await response.json())['otkey']
    }
  });

  this.socket.on("noiseMessage", async (msgs) => {
    console.log("Noise message", msgs);
    msgs.forEach(msg => {
      onMessage(msg);
    });
    let maxId = Math.max(...msgs.map(msg => msg.seqID));
    let u = new URL("/self/messages", this.url);
    (await fetch(u, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.idkey
      },
      body: JSON.stringify({seqID: maxId})
    }));
  });
}

ServerComm.prototype.sendMessage = async function(msg) {
  console.log(msg);
  let u = new URL("/message", this.url);

  const headers = new Headers();
  headers.append('Authorization', 'Bearer ' + this.idkey)
  let response = (await fetch(u, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + this.idkey
    },
    body: JSON.stringify(msg)
  }));
  if (response.ok) {
    return (await response.json())
  }
};

ServerComm.prototype.getOtkeyFromServer = async function(device_id) {
  let u = new URL("/devices/otkey", this.url);
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
};

ServerComm.prototype.disconnect = function() {
  if (this.socket) {
    this.socket.disconnect();
  }
};
