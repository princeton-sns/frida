import { createStore } from "vuex";
import router from "../router";
import * as frida from "../../../../../../core/client";

let serverIP = "localhost";
let serverPort = "8080";

const skeletonPrefix = "skeletonData";

frida.init(serverIP, serverPort, {
  onAuth: () => {
    router.push("/home");
  },
  onUnauth: () => {
    router.push("/register");
  },
  storagePrefixes: [skeletonPrefix],
  // toggle encryption for benchmarking
  //encrypt: false,
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
      } else if (e.key.includes(skeletonPrefix)) {
        if (e.newValue == null && e.oldValue) {
          store.commit("REMOVE_SKELETON_DATA", {
            id: frida.db.fromString(e.oldValue).data.id,
            remote: true,
          });
        } else {
          store.commit("ADD_SKELETON_DATA", {
            timestamp: frida.db.fromString(e.newValue).data.timestamp,
            stuff: frida.db.fromString(e.newValue).data.value,
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
    pubkey: frida.getPubkey(),
    // TODO make these lists reactive
    // TODO show human-readable names instead of pubkeys
    // deleteLinkedDevice would then have to take in the name, not the pubkey
    devices: frida.getLinkedDevices(),
    friends: frida.getContacts(),
    pendingFriends: frida.getPendingContacts(),
    skeletonStuff: frida.getData(skeletonPrefix),
  },
  mutations: {
    /* App-specific mutations */
    ADD_SKELETON_DATA(state, { timestamp, stuff, id, remote }) {
      let value = {
        id: id,
        timestamp: timestamp,
        stuff: stuff,
      };
      if (!remote) {
        frida.setData(skeletonPrefix, id, value);
      }
    },
    SHARE_SKELETON_DATA(state, { id, friendName, remote }) {
      if (!remote) {
        frida.shareData(skeletonPrefix, id, friendName, 0);
      }
    },
    UNSHARE_SKELETON_DATA(state, { id, friendName, remote }) {
      if (!remote) {
        frida.unshareData(skeletonPrefix, id, friendName);
      }
    },
    REMOVE_SKELETON_DATA(state, { id, remote }) {
      if (!remote) {
        frida.removeData(skeletonPrefix, id);
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
