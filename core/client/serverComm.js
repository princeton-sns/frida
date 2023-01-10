/*
 *************************
 * Server Communications *
 *************************
 */
import EventSourcePolyfill from "eventsource";
export class ServerComm {
    #ip;
    #port;
    #url;
    #olmWrapper;
    #idkey;
    // TODO type
    #socket;
    eventEmitter;
    constructor(eventEmitter, ip, port) {
        this.#ip = ip ?? "localhost";
        this.#port = port ?? "8080";
        this.#url = "http://" + this.#ip + ":" + this.#port;
        this.eventEmitter = eventEmitter;
    }
    async #init(olmWrapper) {
        this.#olmWrapper = olmWrapper;
        this.#idkey = await this.#olmWrapper.generateInitialKeys();
        this.#socket = new EventSourcePolyfill(this.#url + "/events", {
            headers: {
                'Authorization': 'Bearer ' + this.#idkey
            }
        });
        this.#socket.addEventListener("otkey", async (e) => {
            console.log(e);
            let u = new URL("/self/otkeys", this.#url);
            let response = (await fetch(u, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + this.#idkey
                },
                body: JSON.stringify(this.#olmWrapper.generateMoreOtkeys(JSON.parse(e.data).needs).otkeys)
            }));
            if (response.ok) {
                return (await response.json())['otkey'];
            }
        });
        this.#socket.addEventListener("msg", async (e) => {
            console.log(e);
            let msg = JSON.parse(e.data);
            console.log("Noise message", msg);
            await this.eventEmitter.emit('serverMsg', msg);
            let u = new URL("/self/messages", this.#url);
            (await fetch(u, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + this.#idkey
                },
                body: JSON.stringify({ seqID: msg.seqID })
            }));
        });
    }
    static async create(eventEmitter, olmWrapper, ip, port) {
        let serverComm = new ServerComm(eventEmitter, ip, port);
        await serverComm.#init(olmWrapper);
        return serverComm;
    }
    async sendMessage(msg) {
        let u = new URL("/message", this.#url);
        const headers = new Headers();
        headers.append('Authorization', 'Bearer ' + this.#idkey);
        let response = (await fetch(u, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + this.#idkey
            },
            body: JSON.stringify(msg)
        }));
        if (response.ok) {
            return (await response.json());
        }
    }
    async getOtkeyFromServer(device_id) {
        let u = new URL("/devices/otkey", this.#url);
        let params = u.searchParams;
        console.log(device_id);
        params.set("device_id", encodeURIComponent(device_id));
        console.log(params);
        let response = (await fetch(u, {
            method: 'GET',
        }));
        if (response.ok) {
            return (await response.json())['otkey'];
        }
    }
}
