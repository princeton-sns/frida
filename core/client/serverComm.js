/*
 *************************
 * Server Communications *
 *************************
 */
import io from "socket.io-client";
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
        this.#socket = io(this.#url, {
            auth: {
                deviceId: this.#idkey
            }
        });
        this.#socket.on("addOtkeys", async ({ needs }) => {
            let u = new URL("/self/otkeys", this.#url);
            let response = (await fetch(u, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + this.#idkey
                },
                body: JSON.stringify(this.#olmWrapper.generateMoreOtkeys(needs).otkeys)
            }));
            if (response.ok) {
                return (await response.json())['otkey'];
            }
        });
        this.#socket.on("noiseMessage", async (msgs) => {
            console.log("Noise message", msgs);
            for (let msg of msgs) {
                await this.eventEmitter.emit('serverMsg', msg);
                //console.log(msg);
                //console.log("finished upcalling to core for msg");
            }
            let maxId = Math.max(...msgs.map(msg => msg.seqID));
            let u = new URL("/self/messages", this.#url);
            (await fetch(u, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + this.#idkey
                },
                body: JSON.stringify({ seqID: maxId })
            }));
        });
    }
    static async create(eventEmitter, olmWrapper, ip, port) {
        let serverComm = new ServerComm(eventEmitter, ip, port);
        await serverComm.#init(olmWrapper);
        return serverComm;
    }
    async sendMessage(msg) {
        //console.log(msg);
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
    disconnect() {
        if (this.#socket) {
            this.#socket.disconnect();
        }
    }
}
