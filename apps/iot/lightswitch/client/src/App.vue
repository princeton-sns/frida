<script>
export default {
  data() {
    return {
      checked: false,
      count: 0,
      pubkey: null
    }
  },
  methods: {
  	foo() {
      //alert(pubkey)
		}
  } 
}
import * as frida from "../../../../../core/client";
let serverIP = "sns26.cs.princeton.edu";
let serverPort = "8000";
const skeletonPrefix = "skeletonData";
frida.init(serverIP, serverPort, {storagePrefixes: [skeletonPrefix],});
frida.createDevice("blah", "blah");
/* eslint-disable no-unused-vars */

/* eslint-enable no-unused-vars */
</script>

<template>
  <div class="Home">
    <input type="checkbox" v-model="checked" id="box" v-on:change="foo"/>
    <label for="box">{{ checked }}</label>
    <!-- <p>{{ pubkey }}</p>-->
  </div>
</template>



