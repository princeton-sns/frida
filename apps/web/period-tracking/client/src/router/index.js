import { createRouter, createWebHistory } from "vue-router";
import Home from "../views/Home.vue";
import Register from "../views/Register.vue";
//import Friends from "../views/Friends.vue";
import Settings from "../views/Settings.vue";
//import Shared from "../views/Shared.vue";

import { getPubkey } from "../../../../../../core/client";

const routes = [
  {
    path: "/",
    component: Home,
    beforeEnter: existsCurrentDevice,
  },
  {
    path: "/register",
    component: Register,
  },
  //{
  //  path: "/friends",
  //  component: Friends,
  //  beforeEnter: existsCurrentDevice,
  //},
  {
    path: "/settings",
    component: Settings,
    beforeEnter: existsCurrentDevice,
  },
  //{
  //  path: "/shared",
  //  component: Shared,
  //  beforeEnter: existsCurrentDevice,
  //},
  {
    path: "/:pathMatch(.*)*",
    redirect: "/",
  },
];

function existsCurrentDevice(to, from, next) {
  if (!getPubkey()) {
    next("/register");
  } else {
    next();
  }
}

const router = createRouter({
  history: createWebHistory(process.env.BASE_URL),
  routes,
});

export default router;
