import { createStore } from "vuex";
import * as noise from "../../../../../../core/client";

let serverIP = "localhost";
let serverPort = "8080";

noise.init(serverIP, serverPort);

const store = createStore({
  getters: {
    pubkey() {
      return noise.getPubkey();
    },
  },
  mutations: {
    NEW_DEVICE(state, { topName, deviceName }) {
      noise.createDevice(topName, deviceName);
    },
    NEW_LINKED_DEVICE(state, { pubkey, deviceName }) {
      noise.createLinkedDevice(pubkey, deviceName);
    },
    // LINK_DEVICE(state, { pubkey })
    DELETE_DEVICE() {
      noise.deleteDevice();
    },
    // TODO show reactive list of linked devices (and a mapping
    //   of human-readable names -> public keys)
    // DELETE_LINKED_DEVICE(state, { pubkey })
    DELETE_ALL_DEVICES() {
      noise.deleteAllLinkedDevices();
    },
    /* Simulate offline devices */
    RECONNECT_DEVICE() {
      noise.connectDevice();
    },
    DISCONNECT_DEVICE() {
      noise.disconnectDevice();
    },
  },
});

export default store;
