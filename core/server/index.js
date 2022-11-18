const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);

app.use(express.json());

// CORS (Cross-Origin Resource Sharing) allows our front-end
// and back-end to share data
const cors = require("cors");
const { Server } = require("socket.io");

app.use(cors());

// Set sequence number count to start at 0
let seqID = 0;

// List of idkeys and corresponding mailboxes
let devices = {};

app.get('/devices/otkey', (req, res) => {
  let deviceId = decodeURIComponent(req.query.device_id);
  let device = devices[deviceId];

  if (!device) {
    res.sendStatus(404);
    return;
  }

  let key = Object.keys(device.otkeys)[0];
  if (!key) {
    res.sendStatus(404);
    return;
  }

  otkey = device.otkeys[key];
  res.send({
    otkey: otkey,
  });


  delete device.otkeys[key];
  if (Object.keys(device.otkeys).length < 6 && device.socket);
    device.socket.emit('addOtkeys', { needs: 12 - Object.keys(device.otkeys).length });
  }
);

app.post('/self/otkeys', (req, res) => {
  const deviceId = req.headers.authorization.split(' ')[1];
  let device = devices[deviceId] ||= { otkeys: {}, mailbox: [] };
  device.otkeys = {
     ...device.otkeys,
     ...req.body
  };
  res.json(req.body);
});

app.post('/message', (req, res) => {
  const senderDeviceId = req.headers.authorization.split(' ')[1];
  let curSeqID = seqID++;
  let batch = req.body.batch;
  batch.forEach(({ deviceId, payload }) => {
    let device = devices[deviceId];
    if (device?.mailbox) {
      device.mailbox.push({
        seqID: curSeqID,
        sender: senderDeviceId,
        encPayload: payload,
      });
    }
  });

  batch.forEach(({ deviceId, payload }) => {
    let device = devices[deviceId];
    if (device?.socket && device?.mailbox) {
      device.socket.emit('noiseMessage', [device.mailbox.at(-1)]);
    }
  });
  res.send({});
});

app.get('/self/messages', (req, res) => {
  const deviceId = req.headers.authorization.split(' ')[1];
  let device = devices[deviceId] ||= { otkeys: {}, mailbox: [] };
  res.send(device.mailbox);
});

app.delete('/self/messages', (req, res) => {
  const deviceId = req.headers.authorization.split(' ')[1];
  let device = devices[deviceId] ||= { otkeys: {}, mailbox: [] };
  let ackSeqId = decodeURIComponent(req.query.seqId);
  device.mailbox = device.mailbox.filter(message => message.seqID > ackSeqId);
  res.send({});
});

const io = new Server(server, {
  cors: {
    origin: "*",
    allowedHeaders: ["Access-Control-Allow-Origin"],
  },
});

function init(port) {
  server.listen(port, () => {
    console.log("listening on *:" + port);
  });
}

io.on("connection", (socket) => {

  let device = devices[socket.handshake.auth.deviceId] ||= { otkeys: {}, mailbox: [] };
  device.socket = socket;

  if (device.mailbox.length > 0) {
    socket.emit('noiseMessage', device.mailbox);
  }

  if (Object.keys(device.otkeys).length < 6) {
    socket.emit('addOtkeys', { needs: 12 - Object.keys(device.otkeys).length });
  }

  socket.on("disconnect", () => {
    device.socket = undefined;
  });

});

module.exports.init = init;
