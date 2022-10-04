<template>
  <div class="main">
    <p>
      <router-link to="/home">Home</router-link>
    </p>
    <!--<p>
      <router-link to="/shared">Shared with Me</router-link>
    </p>-->
    <p>
      <router-link to="/register">Register</router-link>
    </p>
    <p>
      <router-link to="/friends">Friends</router-link>
    </p>
    <p>
      <router-link to="/settings">Settings</router-link>
    </p>
    <router-view></router-view>
  </div>
</template>
