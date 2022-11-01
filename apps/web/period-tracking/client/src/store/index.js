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
  validateCallback: (payload) => validateFunc(payload),
  storagePrefixes: [symptomPrefix, periodPrefix],
  encrypt: false,
});

const validateFunc = (payload) => {
  let keys = payload.key.split("/");

  if (keys.includes("period")) {
    // invariant = period setting is one of the predefined values
    let i = payload.value.data.period;
    if (i != "spotting" && i != "low" && i != "medium" && i != "high") {
      return false;
    }

    // invariant = no more than one period per day
    if (
      payload.msgType == "updateData" &&
      frida.getData(keys[1].concat("/", keys[2])).length > 0
    ) {
      return false;
    }
  }

  return true;
};

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
      } else if (e.key.includes(symptomPrefix)) {
        if (e.newValue == null && e.oldValue) {
          store.commit("REMOVE_SYMPTOMS", {
            id: frida.db.fromString(e.oldValue).data.id,
            remote: true,
          });
        } else {
          store.commit("ADD_SYMPTOM", {
            timestamp: frida.db.fromString(e.newValue).data.timestamp,
            symptoms: frida.db.fromString(e.newValue).data.symptoms,
            id: frida.db.fromString(e.newValue).data.id,
            remote: true,
          });
        }
      } else if (e.key.includes(periodPrefix)) {
        if (e.newValue == null && e.oldValue) {
          store.commit("REMOVE_PERIOD", {
            id: frida.db.fromString(e.oldValue).data.id,
            remote: true,
          });
        } else {
          let newData = frida.db.fromString(e.newValue).data;
          store.commit("ADD_PERIOD", {
            timestamp: newData.timestamp,
            period: newData.period,
            id: newData.id,
            remote: true,
          });
        }
      }
    });
  };
}

const store = createStore({
  state: {
    pubkey: frida.getPubkey(),
    // TODO make these lists reactive
    // TODO show human-readable names instead of pubkeys
    // deleteLinkedDevice would then have to take in the name, not the pubkey
    devices: frida.getLinkedDevices(),
    friends: frida.getContacts(),
    pendingFriends: frida.getPendingContacts(),
    symptoms: frida.getData(symptomPrefix),
    period: frida.getData(periodPrefix),
  },
  mutations: {
    /* App-specific mutations */
    ADD_SYMPTOMS(state, { timestamp, symptoms, id, remote }) {
      let value = {
        id: id,
        timestamp: timestamp,
        symptoms: symptoms,
      };
      if (!remote) {
        frida.setData(symptomPrefix, id, value);
      }
      //state.symptoms.push(frida.db.toString({
      //  id: id,
      //  data: value,
      //}));
    },
    ADD_PERIOD(state, { timestamp, period, id, remote }) {
      if (!remote) {
        let idWithDate = String(timestamp.getDate()).concat(
          String(timestamp.getMonth()),
          String(timestamp.getYear()),
          "/",
          id
        );
        frida.setData(periodPrefix, idWithDate, {
          id: idWithDate,
          timestamp: timestamp,
          period: period,
        });
      }
      // TODO update state
    },
    SHARE_SYMPTOMS(state, { id, friendName, remote }) {
      if (!remote) {
        frida.grantReaderPrivs(symptomPrefix, id, friendName);
      }
    },
    SHARE_PERIOD(state, { id, friendName, remote }) {
      if (!remote) {
        frida.grantReaderPrivs(periodPrefix, id, friendName);
      }
    },
    UNSHARE_SYMPTOMS(state, { id, friendName, remote }) {
      if (!remote) {
        frida.revokeAllPrivs(symptomPrefix, id, friendName);
      }
    },
    UNSHARE_PERIOD(state, { id, friendName, remote }) {
      if (!remote) {
        frida.revokeAllPrivs(periodPrefix, id, friendName);
      }
    },
    REMOVE_SYMPTOMS(state, { id, remote }) {
      if (!remote) {
        frida.removeData(symptomPrefix, id);
      }
      // TODO update state
    },
    REMOVE_PERIOD(state, { id, remote }) {
      if (!remote) {
        frida.removeData(periodPrefix, id);
      }
      // TODO update state
    },
    ADD_FRIEND(state, { pubkey }) {
      frida.addContact(pubkey);
      //let friendName = frida.addContact(pubkey);
      //state.pendingFriends.push(friendName);
    },
    //CONFIRM_FRIEND(state, { name }) {
    //  if (state.friends.indexOf(name) === -1) state.friends.push(name);
    //  let idx = state.pendingFriends.indexOf(name);
    //  if (idx !== -1) {
    //    state.pendingFriends.splice(idx, 1);
    //  } else {
    //    // bug, should have been in pendingFriends list
    //    console.log("bug");
    //  }
    //},
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
  plugins: [frida.dbListenerPlugin(), createAppDBListenerPlugin()],
});

export default store;
