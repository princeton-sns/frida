<template>
  <div id="home">
    <h3>Add new cycle data</h3>
    <div>
      <multiselect
        v-model="symptoms"
        mode="multiple"
        :options="symptomOptions"
        :close-on-select="false"
        placeholder="Select one or more symptoms"
      />
      <!--
        label="type"
        :searchable="true"
        track-by="type"
        :createOption="true"
        :clear-on-select="false"
        :preserve-search="true"
        :preselect-first="false"
        :showOptions="true"
      -->
      <div class="output">Selected: {{ symptoms }}</div>
      <br />
      <button @click="addSymptoms">Add Symptoms</button>
    </div>
    <br />
    <div>
      <multiselect
        v-model="period"
        :options="periodOptions"
        :close-on-select="false"
        placeholder="Select flow"
      />
      <div class="output">Selected: {{ period }}</div>
      <br />
      <button @click="addPeriod">Add Period</button>
    </div>
    <br />
    <br />
    <h3>Symptom history</h3>
    <div>
      <div v-for="symptom in oldSymptoms" :key="symptom">
        <p class="remove" @click="removeSymptomDatum(symptom.id)">&#9746;</p>
        <p>Timestamp: {{ symptom.data.timestamp }}</p>
        <p>Symptoms: {{ symptom.data.symptoms }}</p>
        <p>Raw object: {{ symptom }}</p>
        <div>
          <input v-model="shareSymptomFriendName" placeholder="friend name" />
        </div>
        <button @click="shareSymptoms(symptom.id)">Share Symptoms</button>
        <div>
          <input v-model="unshareSymptomFriendName" placeholder="friend name" />
        </div>
        <button @click="unshareSymptoms(symptom.id)">Unshare Symptoms</button>
        <br />
      </div>
    </div>
    <br />
    <br />
    <h3>Period history</h3>
    <div>
      <div v-for="period in oldPeriod" :key="period">
        <p class="remove" @click="removePeriodDatum(period.id)">&#9746;</p>
        <p>Timestamp: {{ period.data.timestamp }}</p>
        <p>Period: {{ period.data.period }}</p>
        <p>Raw object: {{ period }}</p>
        <div>
          <input v-model="sharePeriodFriendName" placeholder="friend name" />
        </div>
        <button @click="sharePeriod(period.id)">Share Period</button>
        <div>
          <input v-model="unsharePeriodFriendName" placeholder="friend name" />
        </div>
        <button @click="unsharePeriod(period.id)">Unshare Period</button>
        <br />
      </div>
    </div>
  </div>
</template>

<script>
import Multiselect from "@vueform/multiselect";
import { mapState } from "vuex";

export default {
  components: {
    Multiselect,
  },
  computed: {
    ...mapState({
      oldSymptoms: "symptoms",
      oldPeriod: "period",
    }),
  },
  data() {
    return {
      symptoms: [],
      symptomOptions: {
        cramps: "Cramps",
        bloating: "Bloating",
        lowerBackPain: "Lower Back Pain",
        acne: "Acne",
        headache: "Headache",
        irritability: "Irritability",
      },
      shareSymptomFriendName: "",
      unshareSymptomFriendName: "",
      period: null,
      periodOptions: {
        spotting: "Spotting",
        low: "Low",
        medium: "Medium",
        high: "High",
      },
      sharePeriodFriendName: "",
      unsharePeriodFriendName: "",
    };
  },
  methods: {
    addSymptoms(event) {
      console.log(event);
      this.$store.commit("ADD_SYMPTOMS", {
        timestamp: new Date(),
        symptoms: this.symptoms,
        id: crypto.randomUUID(),
        remote: false,
      });
      this.symptoms = [];
    },
    addPeriod(event) {
      console.log(event);
      this.$store.commit("ADD_PERIOD", {
        timestamp: new Date(),
        period: this.period,
        id: crypto.randomUUID(),
        remote: false,
      });
      this.period = null;
    },
    shareSymptoms(id) {
      this.$store.commit("SHARE_SYMPTOMS", {
        id: id,
        friendName: this.shareSymptomFriendName,
        remote: false,
      });
      this.shareSymptomFriendName = "";
    },
    unshareSymptoms(id) {
      this.$store.commit("UNSHARE_SYMPTOMS", {
        id: id,
        friendName: this.unshareSymptomFriendName,
        remote: false,
      });
      this.unshareSymptomFriendName = "";
    },
    sharePeriod(id) {
      this.$store.commit("SHARE_PERIOD", {
        id: id,
        friendName: this.sharePeriodFriendName,
        remote: false,
      });
      this.sharePeriodFriendName = "";
    },
    unsharePeriod(id) {
      this.$store.commit("UNSHARE_PERIOD", {
        id: id,
        friendName: this.unsharePeriodFriendName,
        remote: false,
      });
      this.unsharePeriodFriendName = "";
    },
    removeSymptomDatum(id) {
      this.$store.commit("REMOVE_SYMPTOMS", {
        id: id,
        remote: false,
      });
    },
    removePeriodDatum(id) {
      this.$store.commit("REMOVE_PERIOD", {
        id: id,
        remote: false,
      });
    },
  },
};
</script>
