<template>
  <div id="home">
    <br />
    <div>
      <div>
        <input v-model="familyName" placeholder="family name" />
      </div>
      <button @click="newFamily">New Family</button>
    </div>
    <div>
      <div>
        <v-select
          v-model="family"
          :options="families"
          :value="family"
          label="familyName"
          track-by="id"
        />
        <input v-model="message" placeholder="send message to family" />
        <button @click="sendMessage">Send Message</button>
      </div>
    </div>
    <br />
    <p><u>Your Families</u></p>
    <div>
      <div v-for="family in families" :key="family">
        <p>{{ family.familyName }}</p>
        <!-- Logic for initiating various data sharing for this datum -->
        <br />
      </div>
    </div>
    <p><u>Recent Messages</u></p>
    <div>
      <div v-for="message in messages" :key="message">
        <p>In {{ message.familyId }}: {{ message.message }}</p>
      </div>
    </div>
  </div>
</template>

<script>
import { mapState } from "vuex";

export default {
  computed: {
    ...mapState({
      families: "families",
      messages: "messages",
    }),
  },
  data() {
    return {
      familyName: null,
      message: null,
      family: null,
      shareName: "",
      unshareName: "",
      sharePrivs: "r",
      unsharePrivs: "r",
    };
  },
  methods: {
    newFamily(event) {
      console.log(event);
      this.$store.commit("ADD_FAMILY", {
        timestamp: new Date(),
        familyName: this.familyName,
        id: crypto.randomUUID(),
        remote: false,
      });
    },
    sendMessage(event) {
      console.log(event);
      this.$store.commit("ADD_MESSAGE", {
        timestamp: new Date(),
        familyId: this.family.id,
        message: this.message,
        id: crypto.randomUUID(),
      });
    },
  },
};
</script>
