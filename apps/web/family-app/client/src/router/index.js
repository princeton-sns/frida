import { createRouter, createWebHistory } from "vue-router";
import Home from "../views/Home.vue";
import Register from "../views/Register.vue";
import Friends from "../views/Friends.vue";
import Settings from "../views/Settings.vue";

import { getIdkey } from "../../../../../../core/client";

const routes = [
  {
    path: "/",
    component: Home,
    beforeEnter: existsCurrentDevice,
  },
  // TODO protect against overwriting current device
  {
    path: "/register",
    component: Register,
  },
  {
    path: "/friends",
    component: Friends,
    beforeEnter: existsCurrentDevice,
  },
  {
    path: "/settings",
    component: Settings,
    beforeEnter: existsCurrentDevice,
  },
  {
    path: "/:pathMatch(.*)*",
    redirect: "/",
  },
];

function existsCurrentDevice(to, from, next) {
  if (!getIdkey()) {
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
