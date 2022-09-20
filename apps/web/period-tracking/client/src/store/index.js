import { createStore } from "vuex";
import router from "../router";
import * as frida from "../../../../../../core/client";

let serverIP = "localhost";
let serverPort = "8080";

const symptomPrefix = "symptom";
const periodPrefix = "period";

frida.init(serverIP, serverPort, {
  onAuth: () => {
    router.push("/settings");
  },
  onUnauth: () => {
    router.push("/register");
  },
  storagePrefixes: [symptomPrefix, periodPrefix],
});

function createAppDBListenerPlugin() {
  return (store) => {
    // only fired for non-local events that share the same storage object
    window.addEventListener("storage", (e) => {
      if (e.key === null) {
        console.log("key is null"); // FIXME why is key null?
        store.commit("REMOVE_PUBKEY");
      } else if (e.key.includes(frida.pubkeyPrefix)) {
        console.log("updating pubkey");
        store.commit("UPDATE_PUBKEY", {
          pubkey: frida.db.fromString(e.newValue),
        });
      }
    });
  };
}

const store = createStore({
  state: {
    pubkey: frida.getPubkey(),
    // TODO make these lists reactive
    // TODO show human-readable names instead of pubkeys?
    // deleteLinkedDevice would then have to take in the name, not the pubkey
    devices: frida.getLinkedDevices(),
    friends: frida.getContacts(),
    pendingFriends: frida.getPendingContacts(),
    symptoms: frida.getData(symptomPrefix),
    period: frida.getData(periodPrefix),
  },
  mutations: {
    /* App-specific mutations */
    ADD_SYMPTOMS(state, { timestamp, symptoms, id }) {
      frida.setData(symptomPrefix, id, {
        timestamp: timestamp,
        symptoms: symptoms,
      });
    },
    ADD_PERIOD(state, { timestamp, period, id }) {
      frida.setData(periodPrefix, id, {
        timestamp: timestamp,
        period: period,
      });
    },
    SHARE_SYMPTOMS(state, { id, friendName }) {
      // FIXME API name
      frida.updateGroups(symptomPrefix, id, friendName);
    },
    SHARE_PERIOD(state, { id, friendName }) {
      // FIXME API name
      frida.updateGroups(periodPrefix, id, friendName);
    },
    ADD_FRIEND(state, { pubkey }) {
      frida.addContact(pubkey);
      //let friendName = frida.addContact(pubkey);
      //pendingFriends.push(friendName);
    },
    REMOVE_FRIEND(state, { name }) {
      frida.removeContact(name);
      let idx = state.friends.indexOf(name);
      if (idx !== -1) state.friends.splice(idx, 1);
    },
    UPDATE_PUBKEY(state, { pubkey }) {
      state.pubkey = pubkey;
      state.devices.push(pubkey);
    },
    REMOVE_PUBKEY(state) {
      state.pubkey = "";
      state.devices = [];
    },
    /* App-agnostic mutations */
    NEW_DEVICE(state, { topName, deviceName }) {
      let pubkey = frida.createDevice(topName, deviceName);
      state.pubkey = pubkey;
      state.devices.push(pubkey);
    },
    NEW_LINKED_DEVICE(state, { pubkey, deviceName }) {
      let curPubkey = frida.createLinkedDevice(pubkey, deviceName);
      state.pubkey = curPubkey;
      state.devices.push(curPubkey);
    },
    // TODO LINK_DEVICE for two pre-existing devices (how to handle group diffs?)
    DELETE_DEVICE(state) {
      frida.deleteDevice();
      state.pubkey = "";
      state.devices = [];
    },
    DELETE_LINKED_DEVICE(state, { pubkey }) {
      frida.deleteLinkedDevice(pubkey);
      let idx = state.devices.indexOf(pubkey);
      if (idx !== -1) state.devices.splice(idx, 1);
    },
    DELETE_ALL_DEVICES(state) {
      frida.deleteAllLinkedDevices();
      state.pubkey = "";
      state.devices = [];
    },
    /* Simulate offline devices */
    RECONNECT_DEVICE() {
      frida.connectDevice();
    },
    DISCONNECT_DEVICE() {
      frida.disconnectDevice();
    },
  },
  // TODO build this through frida?
  plugins: [frida.dbListenerPlugin(), createAppDBListenerPlugin()],
});

export default store;
