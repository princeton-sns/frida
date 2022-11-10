/*
 *************************
 * Server Communications *
 *************************
 */

import io from "socket.io-client";
import { OlmWrapper } from "../crypto/olmWrapper.js";
import { outboundEncPayloadType, inboundEncPayloadType } from "../index.js";

export class ServerComm {
  #ip:   string;
  #port: string;
  #url:  string;
  #olmWrapper: OlmWrapper;
  #onMessage: (inboundEncPayloadType) => void;
  #idkey: string;
  // TODO type
  #socket;

  constructor(
      olmWrapper: OlmWrapper,
      onMessage: (inboundEncPayloadType) => void,
      ip?: string,
      port?: string
  ) {
    this.#ip = ip ?? "localhost";
    this.#port = port ?? "8080";
    this.#url = "http://" + this.#ip + ":" + this.#port;
    this.#olmWrapper = olmWrapper;
    this.#onMessage = onMessage;
  }

  async init() {
    this.#idkey = await this.#olmWrapper.generateInitialKeys();

    this.#socket = io(this.#url, {
      auth: {
        deviceId: this.#idkey
      }
    });

    this.#socket.on("addOtkeys", async ({ needs }): Promise<string> => {
      let u: URL = new URL("/self/otkeys", this.#url);

      let response: Response = (await fetch(u, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.#idkey
        },
        body: JSON.stringify(this.#olmWrapper.generateMoreOtkeys(needs).otkeys)
      }));
      if (response.ok) {
        return (await response.json())['otkey']
      }
    });

    this.#socket.on("noiseMessage", async (msgs: inboundEncPayloadType[]) => {
      console.log("Noise message", msgs);
      msgs.forEach(msg => {
        this.#onMessage(msg);
      });
      let maxId: number = Math.max(...msgs.map(msg => msg.seqID));
      let u: URL = new URL("/self/messages", this.#url);
      (await fetch(u, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.#idkey
        },
        body: JSON.stringify({seqID: maxId})
      }));
    });
  }

  async sendMessage(msg: { batch: outboundEncPayloadType[] }): Promise<{}> {
    console.log(msg);
    let u: URL = new URL("/message", this.#url);

    const headers: Headers = new Headers();
    headers.append('Authorization', 'Bearer ' + this.#idkey)
    let response: Response = (await fetch(u, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.#idkey
      },
      body: JSON.stringify(msg)
    }));
    if (response.ok) {
      return (await response.json())
    }
  }

  async getOtkeyFromServer(device_id: string): Promise<string> {
    let u: URL = new URL("/devices/otkey", this.#url);
    let params: URLSearchParams = u.searchParams;
    console.log(device_id);
    params.set("device_id", encodeURIComponent(device_id));
    console.log(params);

    let response: Response = (await fetch(u, {
      method: 'GET',
    }));
    if (response.ok) {
      return (await response.json())['otkey']
    }
  }

  disconnect() {
    if (this.#socket) {
      this.#socket.disconnect();
    }
  }
}
