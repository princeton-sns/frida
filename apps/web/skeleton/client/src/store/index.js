import { createStore } from "vuex";
import router from "../router";
import * as frida from "../../../../../../core/client";

//let serverIP = "sns26.cs.princeton.edu";
//let serverPort = "8000";
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
    name: frida.getLinkedName(),
    idkey: frida.getIdkey(),
    // TODO make these lists reactive
    // TODO show human-readable names instead of idkeys
    // deleteLinkedDevice would then have to take in the name, not the idkey
    devices: frida.getLinkedDevices(),
    friends: frida.getContacts(),
    pendingFriends: frida.getPendingContacts(),
    skeletonStuff: frida.getData(skeletonPrefix),
  },
  mutations: {
    /* App-specific mutations */
    ADD_SKELETON_DATA(state, { timestamp, stuff, id, remote }) {
      if (!remote) {
        frida.setData(skeletonPrefix, id, {
          id: id,
          timestamp: timestamp,
          stuff: stuff,
        });
      }
      // TODO update state
    },
    REMOVE_SKELETON_DATA(state, { id, remote }) {
      if (!remote) {
        frida.removeData(skeletonPrefix, id);
      }
      // TODO update state
    },
    SHARE_SKELETON_DATA(state, { id, friendName, priv, remote }) {
      if (!remote) {
        switch (priv) {
          case "r":
            frida.grantReaderPrivs(skeletonPrefix, id, friendName);
            break;
          case "w":
            frida.grantWriterPrivs(skeletonPrefix, id, friendName);
            break;
          case "a":
            frida.grantAdminPrivs(skeletonPrefix, id, friendName);
            break;
          default:
            console.log(
              "invalid radio value encountered while trying to share data: " +
                priv
            );
        }
      }
    },
    UNSHARE_SKELETON_DATA(state, { id, friendName, priv, remote }) {
      if (!remote) {
        switch (priv) {
          case "a":
            frida.revokeAdminPrivs(skeletonPrefix, id, friendName);
            break;
          case "w":
            frida.revokeWriterPrivs(skeletonPrefix, id, friendName);
            break;
          case "r":
            frida.revokeAllPrivs(skeletonPrefix, id, friendName);
            break;
          default:
            console.log(
              "invalid radio value encountered while trying to unshare data: " +
                priv
            );
        }
      }
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
      let idkey = frida.createDevice(topName, deviceName);
      state.idkey = idkey;
      state.devices.push(idkey);
    },
    NEW_LINKED_DEVICE(state, { idkey, deviceName }) {
      let curIdkey = frida.createLinkedDevice(idkey, deviceName);
      state.idkey = curIdkey;
      state.devices.push(curIdkey);
    },
    // TODO LINK_DEVICE for two pre-existing devices (how to handle group diffs?)
    DELETE_DEVICE(state) {
      frida.deleteThisDevice();
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
  },
  plugins: [frida.dbListenerPlugin(), createAppDBListenerPlugin()],
});

export default store;
