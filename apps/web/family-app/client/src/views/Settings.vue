<template>
  <div class="settings">
    <p><u>top name:</u></p>
    <p>{{ name }}</p>
    <p><u>idkey:</u></p>
    <p>{{ idkey }}</p>
    <p><u>devices:</u></p>
    <p>{{ devices }}</p>
    <div>
      <button @click="deleteDevice">Delete This Device</button>
    </div>
    <br />
    <div>
      <div>
        <input v-model="deleteDeviceIdkey" placeholder="device public key" />
      </div>
      <button @click="deleteLinkedDevice">Delete Linked Device</button>
    </div>
    <br />
    <div>
      <button @click="deleteAllDevices">Delete All Devices</button>
    </div>
    <br />
    <div>
      <button @click="reconnectDevice">Reconnect Device</button>
    </div>
    <br />
    <div>
      <button @click="disconnectDevice">Disconnect Device</button>
    </div>
  </div>
</template>

<script>
import { mapState } from "vuex";

export default {
  data() {
    return {
      deleteDeviceIdkey: null,
    };
  },
  computed: {
    ...mapState({
      name: "name",
      idkey: "idkey",
      devices: "devices",
    }),
  },
  methods: {
    deleteDevice(event) {
      console.log(event);
      this.$store.commit("DELETE_DEVICE", {});
    },
    deleteLinkedDevice(event) {
      console.log(event);
      this.$store.commit("DELETE_LINKED_DEVICE", {
        idkey: this.deleteDeviceIdkey,
      });
      this.deleteDeviceIdkey = null;
    },
    deleteAllDevices(event) {
      console.log(event);
      this.$store.commit("DELETE_ALL_DEVICES", {});
    },
    reconnectDevice(event) {
      console.log(event);
      this.$store.commit("RECONNECT_DEVICE", {});
    },
    disconnectDevice(event) {
      console.log(event);
      this.$store.commit("DISCONNECT_DEVICE", {});
    },
  },
};
</script>
