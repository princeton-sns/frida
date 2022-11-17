const frida_server_path = "../../core/server"
const frida = require(frida_server_path);
const port = 8000;
frida.init(port);
