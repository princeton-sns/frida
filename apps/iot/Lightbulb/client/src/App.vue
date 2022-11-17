<template>
  <div class="bulb">
    <button @click="readBulbValue">Read Bulb Value</button>
    <!-- <p>{{ pubkey }}</p>-->
  </div>
</template>

<script>
export default {
  data() {
    return {
    }
  },
  methods: {
    readBulbValue() {
      console.log(frida.getData(lightswitchPrefix, "switch_state"));
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
