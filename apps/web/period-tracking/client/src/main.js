import { createApp } from "vue";
import App from "./App.vue";
import store from "./store";
import router from "./router";
import { Higher } from "../../../../../higher";

/* eslint-disable */
(async () => {
  const app = createApp(App);
  let frida = await Higher.create(
    {
      onAuth: () => { router.push("/settings") },
      onUnauth: () => { router.push("/register") },
      //turnEncryptionOff: true,
    }//,
    //"sns26.princeton.edu",
    //"8000"
  );
  app.use(store(frida));
  app.use(router(frida));
  app.mount("#app");
})();
