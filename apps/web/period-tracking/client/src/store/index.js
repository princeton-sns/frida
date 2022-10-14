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
  //turnEncryptionOff: true,
});

function createAppDBListenerPlugin() {
  return (store) => {
    // only fired for non-local events that share the same storage object
    window.addEventListener("storage", (e) => {
      if (e.key === null) {
        console.log("key is null"); // FIXME why is key null?
        store.commit("REMOVE_IDKEY");
      } else if (e.key.includes(frida.idkeyPrefix)) {
        console.log("updating idkey");
        store.commit("UPDATE_IDKEY", {
          idkey: frida.db.fromString(e.newValue),
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
          store.commit("ADD_PERIOD", {
            timestamp: frida.db.fromString(e.newValue).data.timestamp,
            period: frida.db.fromString(e.newValue).data.period,
            id: frida.db.fromString(e.newValue).data.id,
            remote: true,
          });
        }
      }
    });
  };
}

const store = createStore({
  state: {
    idkey: frida.getIdkey(),
    // TODO make these lists reactive
    // TODO show human-readable names instead of idkeys
    // deleteLinkedDevice would then have to take in the name, not the idkey
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
        frida.setData(periodPrefix, id, {
          id: id,
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
    ADD_FRIEND(state, { idkey }) {
      frida.addContact(idkey);
      //let friendName = frida.addContact(idkey);
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
    UPDATE_IDKEY(state, { idkey }) {
      state.idkey = idkey;
      state.devices.push(idkey);
    },
    REMOVE_IDKEY(state) {
      state.idkey = "";
      state.devices = [];
    },
    /* App-agnostic mutations */
    NEW_DEVICE(state, { topName, deviceName }) {
      // FIXME should await...?
      let idkey = frida.createDevice(topName, deviceName);
      state.idkey = idkey;
      state.devices.push(idkey);
    },
    // TODO bootstrap otkey
    NEW_LINKED_DEVICE(state, { idkey, otkey, deviceName }) {
      // FIXME should await...?
      let curIdkey = frida.createLinkedDevice(idkey, otkey, deviceName);
      state.idkey = curIdkey;
      state.devices.push(curIdkey);
    },
    // TODO LINK_DEVICE for two pre-existing devices (how to handle group diffs?)
    DELETE_DEVICE(state) {
      frida.deleteDevice();
      state.idkey = "";
      state.devices = [];
    },
    DELETE_LINKED_DEVICE(state, { idkey }) {
      frida.deleteLinkedDevice(idkey);
      let idx = state.devices.indexOf(idkey);
      if (idx !== -1) state.devices.splice(idx, 1);
    },
    DELETE_ALL_DEVICES(state) {
      frida.deleteAllLinkedDevices();
      state.idkey = "";
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
