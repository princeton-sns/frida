import { createStore } from "vuex";
import router from "../router";
import * as frida from "../../../../../../core/client";

let serverIP = "sns26.cs.princeton.edu";
let serverPort = "8000";

// value will be stores under the following scheme
// family info: /family/familyId
// update within family: /family/familyId/message/messageId
// image within family: /family/familyId/image/imageId
// reactions to an update: /family/familyId/message/messageId/reaction/reactionId
// comments to an update: /family/familyId/message/messageId/comment/commentId

const familyPrefix = "family";
const messagePrefix = "message";
const imagePrefix = "photo";
const reactPrefix = "reaction";
const commentPrefix = "comment";

frida.init(serverIP, serverPort, {
  onAuth: () => {
    router.push("/home");
  },
  onUnauth: () => {
    router.push("/register");
  },
  storagePrefixes: [
    familyPrefix,
    messagePrefix,
    imagePrefix,
    reactPrefix,
    commentPrefix,
  ],
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
      } else if (
        e.key.includes(familyPrefix) &&
        !e.key.includes(messagePrefix) &&
        !e.key.includes(imagePrefix)
      ) {
        if (e.newValue == null && e.oldValue) {
          store.commit("REMOVE_FAMILY", {
            id: frida.db.fromString(e.oldValue).data.id,
            remote: true,
          });
        } else {
          store.commit("ADD_FAMILY", {
            timestamp: frida.db.fromString(e.newValue).data.timestamp,
            familyName: frida.db.fromString(e.newValue).data.familyName,
            id: frida.db.fromString(e.newValue).data.id,
            remote: true,
          });
        }
      } else if (
        e.key.includes(messagePrefix) &&
        !e.key.includes(reactPrefix) &&
        !e.key.includes(commentPrefix)
      ) {
        if (e.newValue == null && e.oldValue) {
          store.commit("REMOVE_MESSAGE", {
            familyId: frida.db.fromString(e.oldValue).data.familyId,
            id: frida.db.fromString(e.oldValue).data.id,
            remote: true,
          });
        } else {
          let val = frida.db.fromString(e.newValue).data;
          console.log(val);
          store.commit("ADD_MESSAGE", {
            timestamp: val.timestamp,
            familyId: val.familyId,
            id: val.id,
            message: val.message,
            remote: true,
          });
        }
      } else if (
        e.key.includes(imagePrefix) &&
        !e.key.includes(reactPrefix) &&
        !e.key.includes(commentPrefix)
      ) {
        if (e.newValue == null && e.oldValue) {
          store.commit("REMOVE_IMAGE", {
            familyId: frida.db.fromString(e.oldValue).data.familyId,
            id: frida.db.fromString(e.oldValue).data.id,
            remote: true,
          });
        } else {
          let val = frida.db.fromString(e.newValue).data;
          store.commit("ADD_IMAGE", {
            timestamp: val.timestamp,
            familyId: val.familyId,
            image: val.image,
            id: val.id,
            remote: true,
          });
        }
      } else if (e.key.includes(messagePrefix) && e.key.includes(reactPrefix)) {
        if (e.newValue == null && e.oldValue) {
          store.commit("REMOVE_REACT", {
            familyId: frida.db.fromString(e.oldValue).data.familyId,
            objectPrefix: frida.db.FromString(e.oldValue).data.objectType,
            objectId: frida.db.fromString(e.oldValue).data.objectId,
            id: frida.db.fromString(e.oldValue).data.id,
            remote: true,
          });
        } else {
          let val = frida.db.fromString(e.newValue).data;
          store.commit("ADD_REACT", {
            timestamp: val.timestamp,
            familyId: val.familyId,
            objectPrefix: val.objectType,
            objectId: val.objectId,
            id: val.id,
            react: val.react,
            remote: true,
          });
        }
      } else if (
        e.key.includes(messagePrefix) &&
        e.key.includes(commentPrefix)
      ) {
        if (e.newValue == null && e.oldValue) {
          store.commit("REMOVE_COMMENT", {
            familyId: frida.db.fromString(e.oldValue).data.familyId,
            objectPrefix: frida.db.fromString(e.oldValue).objectType,
            objectId: frida.db.fromString(e.oldValue).data.objectId,
            id: frida.db.fromString(e.oldValue).data.id,
            remote: true,
          });
        } else {
          let val = frida.db.fromString(e.newValue).data;
          store.commit("ADD_COMMENT", {
            timestamp: val.timestamp,
            familyId: val.familyId,
            objectPrefix: val.objectType,
            objectId: val.objectId,
            comment: val.comment,
            id: val.id,
            remote: true,
          });
        }
      }
    });
  };
}

// return only list of families
function getFamilies() {
  let all_keys = frida.getDataKeys(familyPrefix);
  let family_keys = [];
  for (let i = 0; i < all_keys.length; i++) {
    let key = all_keys[i];
    if (!key.includes(messagePrefix) && !key.includes(imagePrefix)) {
      family_keys.push(key);
    }
  }

  let results = [];
  for (let i = 0; i < family_keys.length; i++) {
    results.push(frida.getDataByKey(family_keys[i]).data);
  }
  return results;
}

// returns all the messages
function getMessages() {
  let all_items = frida.getData(messagePrefix);
  console.log(all_items);
  let messages = [];
  for (let i = 0; i < all_items.length; i++) {
    //let key = all_items[i].key;
    //if (key.includes(messagePrefix) && !key.includes(commentPrefix) && !key.includes(reactPrefix)) {
    messages.push(all_items[i].data);
    //}
  }
  console.log(messages);
  return messages;
}

function concatDataPrefix() {
  let args = Array.prototype.slice.call(arguments);
  console.log("args:" + args);
  return args.join("/");
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
    media: frida.getData(familyPrefix),
    families: getFamilies(),
    messages: getMessages(),
  },
  mutations: {
    /* App-specific mutations */
    ADD_FAMILY(state, { timestamp, familyName, id, remote }) {
      if (!remote) {
        frida.setData(familyPrefix, id, {
          id: id,
          timestamp: timestamp,
          familyName: familyName,
        });
      }
      // TODO update state
    },
    REMOVE_FAMILY(state, { id, remote }) {
      if (!remote) {
        frida.removeData(familyPrefix, id);
      }
      // TODO update state
    },
    ADD_MESSAGE(state, { timestamp, familyId, id, message, remote }) {
      if (!remote) {
        frida.setData(
          concatDataPrefix(familyPrefix, familyId, messagePrefix),
          id,
          {
            id: id,
            familyId: familyId,
            timestamp: timestamp,
            message: message,
          }
        );
      }
    },
    REMOVE_MESSAGE(state, { familyId, id, remote }) {
      if (!remote) {
        frida.removeData(
          concatDataPrefix(familyPrefix, familyId, messagePrefix),
          id
        );
      }
    },
    ADD_IMAGE(state, { timestamp, familyId, id, image, remote }) {
      if (!remote) {
        frida.setData(
          concatDataPrefix(familyPrefix, familyId, imagePrefix),
          id,
          {
            id: id,
            familyId: familyId,
            timestamp: timestamp,
            image: image,
          }
        );
      }
    },
    REMOVE_IMAGE(state, { familyId, id, remote }) {
      if (!remote) {
        frida.removeData(
          concatDataPrefix(familyPrefix, familyId, imagePrefix),
          id
        );
      }
    },
    ADD_COMMENT(
      state,
      { timestamp, familyId, objectPrefix, objectId, id, comment, remote }
    ) {
      if (!remote) {
        frida.setData(
          concatDataPrefix(
            familyPrefix,
            familyId,
            objectPrefix,
            objectId,
            commentPrefix
          ),
          id,
          {
            id: id,
            familyId: familyId,
            objectType: objectPrefix,
            objectId: objectId,
            timestamp: timestamp,
            comment: comment,
          }
        );
      }
    },
    REMOVE_COMMENT(state, { familyId, objectPrefix, objectId, id, remote }) {
      if (!remote) {
        frida.removeData(
          concatDataPrefix(
            familyPrefix,
            familyId,
            objectPrefix,
            objectId,
            commentPrefix
          ),
          id
        );
      }
    },
    ADD_REACT(
      state,
      { timestamp, familyId, objectPrefix, objectId, id, react, remote }
    ) {
      if (!remote) {
        frida.setData(
          concatDataPrefix(
            familyPrefix,
            familyId,
            objectPrefix,
            objectId,
            reactPrefix
          ),
          id,
          {
            id: id,
            familyId: familyId,
            objectType: objectPrefix,
            objectId: objectId,
            timestamp: timestamp,
            react: react,
          }
        );
      }
    },
    REMOVE_REACT(state, { familyId, objectPrefix, objectId, id, remote }) {
      if (!remote) {
        frida.removeData(
          concatDataPrefix(
            familyPrefix,
            familyId,
            objectPrefix,
            objectId,
            reactPrefix
          ),
          id
        );
      }
    },
    SHARE_FAMILY(state, { id, friendName, priv, remote }) {
      if (!remote) {
        switch (priv) {
          case "r":
            frida.grantReaderPrivs(familyPrefix, id, friendName);
            break;
          case "w":
            frida.grantWriterPrivs(familyPrefix, id, friendName);
            break;
          case "a":
            frida.grantAdminPrivs(familyPrefix, id, friendName);
            break;
          default:
            console.log(
              "invalid radio value encountered while trying to share data: " +
                priv
            );
        }
      }
    },
    /*UNSHARE_FAMILY(state, { id, friendName, priv, remote }) {
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
    },*/
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
