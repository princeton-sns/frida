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
        <v-select @input="familyName" :options="families" />
        <input v-model="message" placeholder="send message to family" />
        <button @click="sendMessage">Send Message</button>
      </div>
    </div>
    <br />
    <p><u>Your Families</u></p>
    <div>
      <!-- Show existing data -->
      <div v-for="family in families" :key="family">
        <p>Stuff: {{ family.data.familyName }}</p>
        <!-- Logic for initiating various data sharing for this datum -->
        <br />
      </div>
    </div>
    <p><u>Recent Messages</u></p>
    <div>
      <div v-for="message in messages" :key="message">
        <p> text: {{message.data.message}}</p>
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
       console.log("hola" + event);
        this.$store.commit("ADD_MESSAGE", {
          timestamp: new Date(),
          familyName: this.familyName,
          message: this.message,
          id: crypto.randomUUID(),
      });
    },
  },
};
</script>
