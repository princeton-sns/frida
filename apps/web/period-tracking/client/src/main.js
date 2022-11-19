import { createApp } from "vue";
import App from "./App.vue";
import store from "./store";
import router from "./router";
import { Higher } from "../../../../../higher";

//let serverIP = "sns26.princeton.edu";
//let serverPort = "8000";

/* eslint-disable */
(async () => {
  const app = createApp(App);
  let frida = await Higher.create(
    {
      onAuth: () => { console.log("auth") }, //router.push("/settings") },
      onUnauth: () => { console.log("unauth") }, //router.push("/register") },
      storagePrefixes: ["symptom", "period"],
      //turnEncryptionOff: true,
    }//,
    //serverIP,
    //serverPort
  );
  app.use(store(frida));
  app.use(router(frida));
  app.mount("#app");
})();
