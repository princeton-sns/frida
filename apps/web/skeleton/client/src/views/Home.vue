<template>
  <div id="home">
    <br />
    <div>
      <button @click="addData">Generate Data</button>
    </div>
    <br />
    <p><u>Data</u></p>
    <div>
      <!-- Show existing data -->
      <div v-for="data in skeletonStuff" :key="data">
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
      shareName: "",
      unshareName: "",
      sharePrivs: "r",
      unsharePrivs: "r",
    };
  },
  methods: {
    addData(event) {
      console.log(event);
      this.$store.commit("ADD_SKELETON_DATA", {
        timestamp: new Date(),
        stuff: crypto.randomUUID(),
        id: crypto.randomUUID(),
        remote: false,
      });
    },
    removeData(id) {
      this.$store.commit("REMOVE_SKELETON_DATA", {
        id: id,
        remote: false,
      });
    },
    shareData(id) {
      this.$store.commit("SHARE_SKELETON_DATA", {
        id: id,
        friendName: this.shareName,
        priv: this.sharePrivs,
        remote: false,
      });
      this.shareName = "";
      this.sharePrivs = "r";
    },
    unshareData(id) {
      this.$store.commit("UNSHARE_SKELETON_DATA", {
        id: id,
        friendName: this.unshareName,
        priv: this.unsharePrivs,
        remote: false,
      });
      this.unshareName = "";
      this.unsharePrivs = "r";
    },
  },
};
</script>
