import { createStore } from "vuex";

export const symptomPrefix = "symptom";
export const periodPrefix = "period";

// if defined and initiated like above, is  run for every change
const validateFunc = (payload) => {
  // not something dev should test for in real life
  if (payload.key == null) {
    return false;
  }
  return true;
};

const periodValidate = (payload) => {
  let keys = payload.key.split("/");

  // invariant = period setting is one of the predefined values
  let i = payload.value.data.period;
  if (i != "spotting" && i != "low" && i != "medium" && i != "high") {
    return false;
  }

  // invariant = no more than one period per day
  if (frida.getData(keys[1].concat("/", keys[2])).length > 0) {
    return false;
  }

  return true;
};

const symptomValidate = (payload) => {
  //invariant = number of symptoms is no longer than 6
  //TODO: change invariant if we expand app
  if (payload.value.data.symptoms.length > 6) {
    return false;
  }
  return true;
};

frida.setValidateCallbackForPrefix(periodPrefix, periodValidate);
frida.setValidateCallbackForPrefix(symptomPrefix, symptomValidate);

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
          let newData = JSON.parse(e.newValue).data;
          store.commit("ADD_SYMPTOM", {
            timestamp: newData.timestamp,
            symptoms: newData.symptoms,
            id: newData.id,
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
          let newData = JSON.parse(e.newValue).data;
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

const store = (frida) => {
  return createStore({
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
}

export default store;
