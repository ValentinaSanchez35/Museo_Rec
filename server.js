import express from 'express';
import https from 'https';
import { Server } from 'socket.io';
import mediasoup from 'mediasoup';
import fs from 'fs';

const app = express();

const httpsServer = https.createServer({
  key:  fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem'),
}, app);

const io = new Server(httpsServer, {
  cors: { origin: '*' }
});

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.use(express.static('.'));
app.use('/podcasts', express.static('./public'));

let worker, router;
const transports = new Map();
const producers  = new Map();
const consumers  = new Map();
const listeners  = new Set(); // solo los que pulsaron CONECTARSE

(async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 40000,
    rtcMaxPort: 49999
  });
  router = await worker.createRouter({
    mediaCodecs: [
      { kind: 'audio', mimeType: 'audio/opus',  clockRate: 48000, channels: 2 },
      { kind: 'video', mimeType: 'video/VP8',   clockRate: 90000, parameters: {} }
    ]
  });
  console.log('✅ Infraestructura Mediasoup SFU lista');
})();

function emitirConteo() {
  // Solo al broadcaster, no a todos
  io.emit('listenerCount', { count: listeners.size });
}

io.on('connection', socket => {
  console.log('Cliente conectado:', socket.id);

  // Solo se registra cuando el usuario pulsa el botón
  socket.on('registerListener', () => {
    listeners.add(socket.id);
    emitirConteo();
  });

  socket.on('getPodcastFiles', (callback) => {
    const dir = './public';
    fs.readdir(dir, (err, archivos) => {
      if (err) return callback([]);
      const mp3s = archivos
        .filter(a => a.endsWith('.mp3'))
        .map((a, i) => ({ id: i + 1, archivo: a }));
      callback(mp3s);
    });
  });

  socket.on('playPodcast',  (data) => { io.emit('playPodcast', data); });
  socket.on('pausePodcast', ()     => { io.emit('pausePodcast'); });
  socket.on('stopPodcast',  ()     => { io.emit('stopPodcast'); });
  socket.on('chatMessage',  (data) => { io.emit('chatMessage', data); });

  socket.on('ping', (callback) => {
    if (typeof callback === 'function') callback();
  });

  socket.on('getRtpCapabilities', callback => {
    callback(router.rtpCapabilities);
  });

  socket.on('createTransport', async ({ side }, callback) => {
    const transport = await router.createWebRtcTransport({
      listenIps: [{ ip: '0.0.0.0', announcedIp: '192.168.56.10' }],
      enableUdp: true, enableTcp: true, preferUdp: true
    });
    transports.set(socket.id + side, transport);
    transport.on('dtlsstatechange', state => {
      if (state === 'closed') transport.close();
    });
    callback({
      id:             transport.id,
      iceParameters:  transport.iceParameters,
      iceCandidates:  transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    });
  });

  socket.on('connectTransport', async ({ side, dtlsParameters }, callback) => {
    const transport = transports.get(socket.id + side);
    if (transport) await transport.connect({ dtlsParameters });
    callback();
  });

  socket.on('produce', async ({ kind, rtpParameters }, callback) => {
    const transport = transports.get(socket.id + 'producer');
    const producer  = await transport.produce({ kind, rtpParameters });
    producers.set(socket.id + kind, producer);
    socket.broadcast.emit('newProducerAvailable', { producerId: producer.id, kind: producer.kind });
    callback({ id: producer.id });
  });

  socket.on('consume', async ({ rtpCapabilities, producerId }, callback) => {
    try {
      const targetProducer = Array.from(producers.values()).find(p => p.id === producerId)
        || producers.values().next().value;
      if (!targetProducer || !router.canConsume({ producerId: targetProducer.id, rtpCapabilities })) {
        return callback({ error: 'No se puede consumir el medio' });
      }
      const transport = transports.get(socket.id + 'consumer');
      const consumer  = await transport.consume({
        producerId: targetProducer.id, rtpCapabilities, paused: true
      });
      consumers.set(socket.id + consumer.kind, consumer);
      callback({
        id: consumer.id, producerId: targetProducer.id,
        kind: consumer.kind, rtpParameters: consumer.rtpParameters
      });
    } catch (error) {
      callback({ error: error.message });
    }
  });

  socket.on('resume', async (callback) => {
    ['audio', 'video'].forEach(async kind => {
      const consumer = consumers.get(socket.id + kind);
      if (consumer) await consumer.resume();
    });
    callback();
  });

  socket.on('disconnect', () => {
    // Solo descuenta si era un listener registrado
    if (listeners.has(socket.id)) {
      listeners.delete(socket.id);
      emitirConteo();
    }
    ['producer', 'consumer'].forEach(side => {
      const t = transports.get(socket.id + side);
      if (t) t.close();
      transports.delete(socket.id + side);
    });
    ['audio', 'video'].forEach(kind => {
      producers.delete(socket.id + kind);
      consumers.delete(socket.id + kind);
    });
  });
});

httpsServer.listen(3000, () => {
  console.log('🚀 UC Solution Server corriendo en https://192.168.56.10:3000');
});