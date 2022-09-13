import { createStore } from "vuex";
import router from "../router";
import * as noise from "../../../../../../core/client";

let serverIP = "localhost";
let serverPort = "8080";

noise.init(serverIP, serverPort, {
  onAuth: () => {
    router.push("/home");
  },
  onUnauth: () => {
    router.push("/register");
  },
});

function createLocalStorageListenerPlugin() {
  return (store) => {
    // only fired for non-local events that share the same storage object
    window.addEventListener("storage", (e) => {
      // FIXME localStorage specific
      if (e.key.includes(noise.groupPrefix)) {
        // FIXME how to distinguish groups
        console.log(e.newValue);
        console.log(e.oldValue);
        store.commit("UPDATE_DEVICES", e);
      }
    });
  };
}

const store = createStore({
  state: {
    pubkey: noise.getPubkey(),
    // TODO make this list reactive
    // TODO show human-readable names instead of pubkeys?
    //   deleteLinkedDevice would then have to take in the name, not the pubkey
    devices: noise.getLinkedDevices(),
  },
  mutations: {
    UPDATE_DEVICES(state, thing) {
      console.log(state);
      console.log(thing);
    },
    NEW_DEVICE(state, { topName, deviceName }) {
      let pubkey = noise.createDevice(topName, deviceName);
      state.pubkey = pubkey;
      state.devices.push(pubkey);
    },
    NEW_LINKED_DEVICE(state, { pubkey, deviceName }) {
      let curPubkey = noise.createLinkedDevice(pubkey, deviceName);
      state.pubkey = curPubkey;
      state.devices.push(curPubkey);
    },
    // TODO LINK_DEVICE for two pre-existing devices (how to handle group diffs?)
    DELETE_DEVICE(state) {
      noise.deleteDevice();
      state.pubkey = "";
      state.devices = [];
    },
    DELETE_LINKED_DEVICE(state, { pubkey }) {
      noise.deleteLinkedDevice(pubkey);
      let idx = state.devices.indexOf(pubkey);
      if (idx !== -1) state.devices.splice(idx, 1);
    },
    DELETE_ALL_DEVICES(state) {
      noise.deleteAllLinkedDevices();
      state.pubkey = "";
      state.devices = [];
    },
    ADD_FRIEND(state, { pubkey }) {
      noise.addContact(pubkey);
    },
    //REMOVE_FRIEND(state, { name }) {
    //  noise.removeContact();
    //},
    /* Simulate offline devices */
    RECONNECT_DEVICE() {
      noise.connectDevice();
    },
    DISCONNECT_DEVICE() {
      noise.disconnectDevice();
    },
  },
  // TODO build this through noise
  plugins: [createLocalStorageListenerPlugin()],
});

export default store;
