// const frida = "../../../core/client/index.js"

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import * as frida from "../../../core/client/index.mjs";
// const frida = require("../../../core/client/index.js");
if (typeof localStorage === "undefined" || localStorage === null) {
    var LocalStorage = require('node-localstorage').LocalStorage;
    localStorage = new LocalStorage('./scratch');
}

// frida.createDevice("a", "B");
// frida.wtf();
//   localStorage.setItem('myFirstKey', 'myFirstValue');
//   console.log(localStorage.getItem('myFirstKey'));