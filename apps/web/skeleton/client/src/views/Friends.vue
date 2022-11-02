<template>
  <div class="friends">
    <div class="add-friend">
      <div>
        <input v-model="deviceIdkey" placeholder="device identity key" />
      </div>
      <button @click="addFriend">Add Friend</button>
    </div>
    <br />
    <div class="remove-friend">
      <div>
        <input v-model="friendName" placeholder="friend name" />
      </div>
      <button @click="removeFriend">Remove Friend</button>
    </div>
    <br />
    <div class="list-friends">
      <p><u>Friends:</u></p>
      <div v-for="friend in friends" :key="friend">{{ friend }}</div>
    </div>
    <br />
    <div class="pending-friends">
      <p><u>Pending:</u></p>
      <div v-for="pending in pendingFriends" :key="pending">{{ pending }}</div>
    </div>
  </div>
</template>

<script>
import { mapState } from "vuex";

export default {
  computed: {
    ...mapState({
      friends: "friends",
      pendingFriends: "pendingFriends",
    }),
  },
  data() {
    return {
      deviceIdkey: null,
      friendName: null,
    };
  },
  methods: {
    addFriend(event) {
      console.log(event);
      this.$store.commit("ADD_FRIEND", {
        idkey: this.deviceIdkey,
      });
      this.deviceIdkey = "";
    },
    removeFriend(event) {
      console.log(event);
      this.$store.commit("REMOVE_FRIEND", {
        name: this.friendName,
      });
      this.friendName = "";
    },
  },
};
</script>
