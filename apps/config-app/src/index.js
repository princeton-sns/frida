import * as frida from "../../../core/client/index.js"
if (typeof localStorage === "undefined" || localStorage === null) {
    var LocalStorage = require('node-localstorage').LocalStorage;
    localStorage = new LocalStorage('./scratch');
  }
  
//   localStorage.setItem('myFirstKey', 'myFirstValue');
//   console.log(localStorage.getItem('myFirstKey'));