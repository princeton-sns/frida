const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const fs = require('fs');

var sockets = [];
var messages = [];
var num_ready = 0;

var config_path = process.argv[2];
var config = JSON.parse(fs.readFileSync(config_path, { encoding: 'utf8' }));


let num_clients = config.num_clients;
io.on('connection', (socket) => {
  sockets.push(socket);
  console.log(sockets.length);

  socket.on("barrier", (msg) => {
    num_ready += 1;
    console.log(msg);
    messages.push(msg);
    if(num_ready == num_clients){
      console.log("released");
      for(const s of sockets){
        s.emit('release', messages);
      }
      num_ready = 0;
      messages.length = 0;
    }
  });

  socket.on("config", (msg) => {
    socket.emit("config", config);
  })

  socket.on("disconnect", () => {
    sockets = sockets.filter(item => item !== socket);
    console.log(sockets.length);
  });
});



server.listen(config.coordPort, () => {
  console.log('listening on *:8085');
});



