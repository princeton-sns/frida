<template>
  <div id="home">
    <h4>pubkey: {{ pubkey }}</h4>
  </div>
</template>

<script>
import { mapGetters } from "vuex";

export default {
  computed: {
    ...mapGetters({
      pubkey: "pubkey",
    }),
  },
};
</script>
