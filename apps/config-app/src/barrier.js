const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

let num_clients = parseInt(process.argv[2]);
var sockets = [];
var messages = [];
var num_ready = 0;


io.on('connection', (socket) => {
  sockets.push(socket);
  console.log(sockets.length);

  socket.on("barrier", (msg) => {
    num_ready += 1;
    console.log(msg);
    messages.push(msg);
    console.log("released");
    if(num_ready == num_clients){
      for(const s of sockets){
        s.emit('release', messages);
      }
      num_ready = 0;
      messages.length = 0;
    }
  });

  socket.on("disconnect", () => {
    sockets = sockets.filter(item => item !== socket);
    console.log(sockets.length);
  });
});



server.listen(8085, () => {
  console.log('listening on *:8085');
});



