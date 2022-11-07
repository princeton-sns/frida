import { createApp } from "vue";
import App from "./App.vue";
import store from "./store";
import router from "./router";
import vSelect from "vue-select";

/* eslint-disable */
const app = createApp(App);
app.use(store);
app.use(router);
app.mount("#app");
app.component("v-select", vSelect);
