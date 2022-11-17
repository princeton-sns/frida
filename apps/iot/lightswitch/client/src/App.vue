<template>
  <div class="add-bulb">
      <div>
        <input v-model="bulb_id" placeholder="Bulb ID Key" />
      </div>
      <button @click="addBulb">Add Bulb</button>
  </div>
  <div class="radio">
    <input type="radio" id="On" value="On" v-model="switch_value" @change=toggleSwitch(switch_value)>
    <label for="On">On</label>
    <br>
    <input type="radio" id="Off" value="Off" v-model="switch_value" @change=toggleSwitch(switch_value)>
    <label for="Off">Off</label>
    <br>
    <span>Light: {{ switch_value }}</span>
  </div>
</template>

<script>
export default {
  data() {
    return {
      checked: null,
      bulb_id: null,
      key_shared: false,
      switch_value: "Off"
    }
  },
  methods: {
    foo() {
      console.log("foo");
    },

    addBulb() {
      (async () => { 
      await frida.addContact(this.bulb_id);
      await frida.setData(lightswitchPrefix, "switch_state", this.switch_value);
      //console.log(frida.getData(lightswitchPrefix, "switch_state"));
      })();
      this.bulb_id = null;
    },

    toggleSwitch(value) {
      //frida.setData(lightswitchPrefix, "switch_state", this.checked);
      (async () => {
        if (!this.key_shared) {
          await frida.grantReaderPrivs(lightswitchPrefix, "switch_state", frida.getContacts()[0]);
          this.key_shared = true;
      }
      await frida.setData(lightswitchPrefix, "switch_state", value);
      })();
    }
  }
}

import * as frida from "../../../../../core/client";
//let serverIP = "sns26.cs.princeton.edu";
let serverIP = "localhost";
let serverPort = "8000";
const lightswitchPrefix = "lightswitch";
(async () => {
  await frida.init(serverIP, serverPort, {storagePrefixes: [lightswitchPrefix],});
  frida.createDevice();
})();
</script>
