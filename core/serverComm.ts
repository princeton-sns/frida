/*
 *************************
 * Server Communications *
 *************************
 */

import EventSourcePolyfill from "eventsource";
import { EventEmitter } from "events";
import { OlmWrapper } from "./olmWrapper.js";
import { outboundEncPayloadType, inboundEncPayloadType } from "./index.js";

export class ServerComm {
  #ip:   string;
  #port: string;
  #url:  string;
  #olmWrapper: OlmWrapper;
  #idkey: string;
  // TODO type
  #socket;

  eventEmitter: EventEmitter;

  private constructor(
      eventEmitter: EventEmitter,
      ip?: string,
      port?: string
  ) {
    this.#ip = ip ?? "localhost";
    this.#port = port ?? "8080";
    this.#url = "http://" + this.#ip + ":" + this.#port;
    this.eventEmitter = eventEmitter;
  }

  #init(olmWrapper: OlmWrapper) {
    this.#olmWrapper = olmWrapper;
    this.#idkey = this.#olmWrapper.generateInitialKeys();

    this.#socket = new EventSourcePolyfill(this.#url + "/events", {
      headers: {
        'Authorization': 'Bearer ' + this.#idkey
      }
    });

    this.#socket.addEventListener("otkey", async (e): Promise<string> => {
      console.log(e);
      let u: URL = new URL("/self/otkeys", this.#url);

      let response: Response = (await fetch(u, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.#idkey
        },
        body: JSON.stringify(this.#olmWrapper.generateMoreOtkeys(JSON.parse(e.data).needs).otkeys)
      }));
      if (response.ok) {
        return (await response.json())['otkey']
      }
    });

    this.#socket.addEventListener("msg", async (e) => {
      console.log(e);
      let msg = JSON.parse(e.data);
      console.log("Noise message", msg);
      await this.eventEmitter.emit('serverMsg', msg);
      let u: URL = new URL("/self/messages", this.#url);
      (await fetch(u, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.#idkey
        },
        body: JSON.stringify({seqID: msg.seqID})
      }));
    });
  }

  static async create(
      eventEmitter: EventEmitter,
      olmWrapper: OlmWrapper,
      ip?: string,
      port?: string
  ): Promise<ServerComm> {
    let serverComm = new ServerComm(eventEmitter, ip, port);
    serverComm.#init(olmWrapper);
    return serverComm;
  }

  async sendMessage(msg: { batch: outboundEncPayloadType[] }): Promise<{}> {
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
}
