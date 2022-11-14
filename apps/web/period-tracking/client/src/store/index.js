import { createStore } from "vuex";
import router from "../router";
import { Higher } from "../../../../../../higher";

let serverIP = "localhost";
let serverPort = "8080";

const symptomPrefix = "symptom";
const periodPrefix = "period";

export let frida = new Higher(
  {
    onAuth: () => {
      router.push("/settings");
    },
    onUnauth: () => {
      router.push("/register");
    },
    storagePrefixes: [symptomPrefix, periodPrefix],
    //turnEncryptionOff: true,
  },
  serverIP,
  serverPort
);

// FIXME should be awaited on but need to restructure this file
frida.init();

function createAppDBListenerPlugin() {
  return (store) => {
    // only fired for non-local events that share the same storage object
    window.addEventListener("storage", (e) => {
      if (e.key === null) {
        console.log("key is null"); // FIXME why is key null?
      } else if (e.key.includes(symptomPrefix)) {
        if (e.newValue == null && e.oldValue) {
          store.commit("REMOVE_SYMPTOMS", {
            id: JSON.parse(e.oldValue).data.id,
            remote: true,
          });
        } else {
          store.commit("ADD_SYMPTOM", {
            timestamp: JSON.parse(e.newValue).data.timestamp,
            symptoms: JSON.parse(e.newValue).data.symptoms,
            id: JSON.parse(e.newValue).data.id,
            remote: true,
          });
        }
      } else if (e.key.includes(periodPrefix)) {
        if (e.newValue == null && e.oldValue) {
          store.commit("REMOVE_PERIOD", {
            id: JSON.parse(e.oldValue).data.id,
            remote: true,
          });
        } else {
          store.commit("ADD_PERIOD", {
            timestamp: JSON.parse(e.newValue).data.timestamp,
            period: JSON.parse(e.newValue).data.period,
            id: JSON.parse(e.newValue).data.id,
            remote: true,
          });
        }
      }
    });
  };
}

const store = createStore({
  state: {
    name: frida.getLinkedName(),
    // TODO make these lists reactive
    // TODO show human-readable names instead of idkeys
    // deleteLinkedDevice would then have to take in the name, not the idkey
    devices: frida.getLinkedDevices(),
    friends: frida.getContacts(),
    pendingFriends: frida.getPendingContacts(),
    existingSymptoms: frida.getDataByPrefix(symptomPrefix),
    existingPeriods: frida.getDataByPrefix(periodPrefix),
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
      //state.existingSymptoms.push(JSON.stringify({
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
    /* App-agnostic mutations */
    NEW_DEVICE(state, { topName, deviceName }) {
      // FIXME should await...?
      let idkey = frida.createDevice(topName, deviceName);
      state.name = topName;
      state.devices.push(idkey);
    },
    NEW_LINKED_DEVICE(state, { idkey, deviceName }) {
      // FIXME should await...?
      let curIdkey = frida.createLinkedDevice(idkey, deviceName);
      state.devices.push(curIdkey);
    },
    // TODO LINK_DEVICE for two pre-existing devices (how to handle group diffs?)
    DELETE_DEVICE(state) {
      frida.deleteThisDevice();
      state.name = "";
      state.devices = [];
    },
    DELETE_LINKED_DEVICE(state, { idkey }) {
      frida.deleteLinkedDevice(idkey);
      let idx = state.devices.indexOf(idkey);
      if (idx !== -1) state.devices.splice(idx, 1);
    },
    DELETE_ALL_DEVICES(state) {
      frida.deleteAllLinkedDevices();
      state.name = "";
      state.devices = [];
    },
  },
  plugins: [createAppDBListenerPlugin()],
});

export default store;
