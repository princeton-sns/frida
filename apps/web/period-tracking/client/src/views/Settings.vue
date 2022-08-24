<template>
  <div class="settings">
    <!--<div>
      <div>
        <input v-model="linkDevicePublicKey" placeholder="device public key" />
      </div>
      <button @click="linkDevice">Link Device</button>
    </div>
    <br />-->
    <div>
      <button @click="deleteDevice">Delete This Device</button>
    </div>
    <!--<br />
    <div>
      <div>
        <input
          v-model="deleteDevicePublicKey"
          placeholder="device public key"
        />
      </div>
      <button @click="deleteLinkedDevice">Delete Linked Device</button>
    </div>-->
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
export default {
  data() {
    return {
      linkDevicePublicKey: null,
      deleteDevicePublicKey: null,
    };
  },
  methods: {
    linkDevice(event) {
      console.log(event);
      this.$store.commit("LINK_DEVICE", {
        devicePublicKey: this.linkDevicePublicKey,
      });
      this.linkDevicePublicKey = null;
    },
    deleteDevice(event) {
      console.log(event);
      this.$store.commit("DELETE_DEVICE", {});
    },
    deleteLinkedDevice(event) {
      console.log(event);
      this.$store.commit("DELETE_LINKED_DEVICE", {
        devicePublicKey: this.deleteDevicePublicKey,
      });
      this.deleteDevicePublicKey = null;
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
