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
        <input v-model="message" placeholder="send message to family" />
      </div>
      <button @click="sendMessage">Send Message</button>
    </div>
    <br />
    <p><u>Data</u></p>
    <div>
      <!-- Show existing data -->
      <div v-for="data in media" :key="data">
        <p class="remove" @click="removeData(data.id)">&#9746;</p>
        <p>Timestamp: {{ data.data.timestamp }}</p>
        <p>Stuff: {{ data.data.stuff }}</p>
        <p>Admins: {{ data.admins }}</p>
        <p>Writers: {{ data.writers }}</p>
        <p>Readers: {{ data.readers }}</p>
        <!-- Logic for initiating various data sharing for this datum -->
        <br />
        <div>
          <p>Grant access to this data:</p>
          <div>
            <input v-model="shareName" placeholder="friend name" />
          </div>
          <div>
            <input type="radio" v-model="sharePrivs" id="r" value="r" />
            <label for="r">Reader</label>
          </div>
          <div>
            <input type="radio" v-model="sharePrivs" id="w" value="w" />
            <label for="w">Writer</label>
          </div>
          <div>
            <input type="radio" v-model="sharePrivs" id="a" value="a" />
            <label for="a">Admin</label>
          </div>
          <button @click="shareData(data.id)">Share Data</button>
        </div>
        <br />
        <!-- Logic for initiating various data unsharing for this datum-->
        <div>
          <p>Revoke access from this data:</p>
          <div>
            <input v-model="unshareName" placeholder="friend name" />
          </div>
          <div>
            <input type="radio" v-model="unsharePrivs" id="a" value="a" />
            <label for="a">Admin</label>
          </div>
          <div>
            <input type="radio" v-model="unsharePrivs" id="w" value="w" />
            <label for="w">Writer</label>
          </div>
          <div>
            <input type="radio" v-model="unsharePrivs" id="r" value="r" />
            <label for="r">Reader (all)</label>
          </div>
          <button @click="unshareData(data.id)">Unshare Data</button>
          <br />
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { mapState } from "vuex";

export default {
  computed: {
    ...mapState({
      skeletonStuff: "skeletonStuff",
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
    newMessage(event) {
       console.log(event);
        this.$store.commit("ADD_MESSAGE", {
          timestamp: new Date(),
          familyName: this.familyId,
          message: this.message,
          id: crypto.randomUUID(),
      });
    },
  },
};
</script>
