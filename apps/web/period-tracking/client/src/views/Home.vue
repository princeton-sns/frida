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
  </div>
</template>

<script>
import Multiselect from "@vueform/multiselect";

export default {
  components: {
    Multiselect,
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
      period: null,
      periodOptions: {
        spotting: "Spotting",
        low: "Low",
        medium: "Medium",
        high: "High",
      },
    };
  },
  methods: {
    addSymptoms(event) {
      console.log(event);
      this.$store.commit("ADD_SYMPTOMS", {
        timestamp: new Date(),
        symptoms: this.symptoms,
      });
      this.symptoms = [];
    },
    addPeriod(event) {
      console.log(event);
      this.$store.commit("ADD_PERIOD", {
        timestamp: new Date(),
        period: this.period,
      });
      this.period = null;
    },
  },
};
</script>
