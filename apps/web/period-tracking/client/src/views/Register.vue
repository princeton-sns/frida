<template>
  <div class="register">
    <div>
      <div>
        <input
          v-model="topName"
          placeholder="top-level name"
        >
      </div>
      <div>
        <input
          v-model="firstDeviceName"
          placeholder="device name (optional)"
        >
      </div>
      <button @click="newDevice">
        New Device
      </button>
    </div>
    <br>
    <div>
      <div>
        <input
          v-model="idkey"
          placeholder="id key to link with"
        >
      </div>
      <div>
        <input
          v-model="nextDeviceName"
          placeholder="device name (optional)"
        >
      </div>
      <button @click="newLinkedDevice">
        New Linked Device
      </button>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      topName: null,
      firstDeviceName: null,
      nextDeviceName: null,
      idkey: null,
    };
  },
  methods: {
    newDevice(event) {
      console.log(event);
      this.$store.commit("NEW_DEVICE", {
        topName: this.topName,
        deviceName: this.firstDeviceName,
      });
      this.topName = "";
      this.firstDeviceName = "";
    },
    newLinkedDevice(event) {
      console.log(event);
      this.$store.commit("NEW_LINKED_DEVICE", {
        deviceName: this.nextDeviceName,
        idkey: this.idkey,
      });
      this.idkey = "";
      this.nextDeviceName = "";
    },
  },
};
</script>
