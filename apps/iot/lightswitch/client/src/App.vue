/* eslint-disable no-unused-vars */
/* eslint-enable no-unused-vars */
<template>
  <div class="add-friend">
      <div>
        <input v-model="friend" placeholder="device id key" />
      </div>
      <button @click="addFriend">Add Friend</button>
  </div>
  <div class="Home">
    <input type="checkbox" v-model="checked" id="box" v-on:change="foo"/>
    <label for="box">{{ checked }}</label>
    <!-- <p>{{ pubkey }}</p>-->
  </div>
</template>

<script>
export default {
  data() {
    return {
      checked: false,
      count: 0,
      pubkey: null,
      friend: null
    }
  },
  methods: {
  	foo() {
      //alert(pubkey)
		},
  
    addFriend(event) {
      console.log(event);
      (async () => {
      await frida.addContact(this.friend);
      })();
      }
    }
}
import * as frida from "../../../../../core/client";
let serverIP = "sns26.cs.princeton.edu";
let serverPort = "8000";
const skeletonPrefix = "skeletonData";
(async () => {
  await frida.init(serverIP, serverPort, {storagePrefixes: [skeletonPrefix],});
  frida.createDevice(null, null);
  console.log(frida.getIdkey());
  //await frida.setData(skeletonPrefix, "key", "value2");
  console.log(await frida.getData(skeletonPrefix, "key"));

})();
</script>
