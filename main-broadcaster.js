import * as mediasoupClient from 'mediasoup-client';
import { io } from 'socket.io-client';

const socket          = io('https://192.168.56.10:3000');
const socket2         = io('https://192.168.56.10:3000');

const startBtn        = document.getElementById('startBtn');
const bitrateDisplay1 = document.getElementById('bitrateDisplay1');
const bitrateDisplay2 = document.getElementById('bitrateDisplay2');
const statusDisplay   = document.getElementById('statusDisplay');
const localVideo      = document.getElementById('localVideo');
const startCamBtn     = document.getElementById('startCamBtn');
const camStatus       = document.getElementById('camStatus');
const tablaBody       = document.getElementById('podcastTableBody');
const btnAgregar      = document.getElementById('addAudioBtn');
const chatDisplay     = document.getElementById('chatDisplay');
const chatInput       = document.getElementById('chatInput');
const sendChatBtn     = document.getElementById('sendChatBtn');
const welcomeMsg      = document.getElementById('welcomeMessage');
const viewerCount     = document.getElementById('viewerCount');

let device, transport;
let audioProducer  = null;
let videoProducer  = null;
let listaAudios    = [];
let audioActual    = null;
let conectado      = false;
let camaraActiva   = false;
let podcastActivo  = null; // id del podcast en reproducción

// ─── CONTADOR DE VIEWERS ──────────────────────────────────────────────────────
socket2.on('listenerCount', ({ count }) => {
  viewerCount.textContent = count;
});

// ─── BOTÓN INICIAR STREAMING ──────────────────────────────────────────────────
startBtn.onclick = async () => {
  if (conectado) return;
  try {
    statusDisplay.innerText   = "Conectando...";
    statusDisplay.style.color = "#8b949e";

    if (!device)    await initDevice();
    if (!transport) await crearTransporteEnvio();

    conectado                 = true;
    statusDisplay.innerText   = "🟢 EN VIVO — listo para emitir";
    statusDisplay.style.color = "#3fb950";
    startBtn.innerText        = "✅ STREAMING ACTIVO";
    startBtn.style.background = "#1f6feb";
    startBtn.disabled         = true;
    startCamBtn.disabled      = false;

  } catch (err) {
    console.error('❌ Error al conectar:', err);
    statusDisplay.innerText   = "❌ Error de Conexión";
    statusDisplay.style.color = "#f85149";
  }
};

// ─── BOTÓN CÁMARA ─────────────────────────────────────────────────────────────
startCamBtn.onclick = async () => {
  if (!camaraActiva) {
    try {
      camStatus.innerText   = "📷 Solicitando dispositivos...";
      camStatus.style.color = "#8b949e";

      const [camStream, micStream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ video: true,  audio: false }),
        navigator.mediaDevices.getUserMedia({ audio: true,  video: false })
      ]);

      localVideo.srcObject     = camStream;
      localVideo.style.display = 'block';
      document.getElementById('camPlaceholder').style.display = 'none';
      localVideo.play();

      videoProducer = await transport.produce({
        track: camStream.getVideoTracks()[0],
        encodings: [{ maxBitrate: 500000 }, { maxBitrate: 1000000 }],
        codecOptions: { videoGoogleStartBitrate: 1000 },
        appData: { source: 'Webcam' }
      });

      audioProducer = await transport.produce({
        track: micStream.getAudioTracks()[0],
        appData: { source: 'Microphone' }
      });

      camaraActiva                 = true;
      camStatus.innerText          = "🔴 CÁMARA + MIC EN VIVO";
      camStatus.style.color        = "#f85149";
      statusDisplay.innerText      = "🟢 EN VIVO (Cámara + Mic activos)";
      startCamBtn.innerText        = "⏹ DETENER CÁMARA Y MIC";
      startCamBtn.style.background = "#da3633";
      document.getElementById('liveDot').style.display = 'flex';

      setInterval(async () => {
        if (!audioProducer) return;
        const stats = await audioProducer.getStats();
        stats.forEach(stat => {
          if (stat.type === 'outbound-rtp') {
            bitrateDisplay1.innerText = `Packet Loss: ${stat.packetsLost || 0} pkt`;
            bitrateDisplay2.innerText = `Throughput: ${Math.round((stat.bitrate || 0) / 1000)} kbps`;
          }
        });
      }, 2000);

    } catch (err) {
      const mensajes = {
        'NotAllowedError':  '⛔ Permiso denegado',
        'NotFoundError':    '🔌 No se encontró cámara o micrófono',
        'NotReadableError': '🔒 Dispositivo ocupado por otra app',
        'SecurityError':    '🔐 Requiere HTTPS o localhost',
      };
      camStatus.innerText   = mensajes[err.name] || `❌ ${err.name}: ${err.message}`;
      camStatus.style.color = "#f85149";
    }
  } else {
    detenerCamara();
  }
};

function detenerCamara() {
  if (videoProducer) { videoProducer.close(); videoProducer = null; }
  if (audioProducer) { audioProducer.close(); audioProducer = null; }
  if (localVideo.srcObject) {
    localVideo.srcObject.getTracks().forEach(t => t.stop());
    localVideo.srcObject = null;
  }
  camaraActiva                 = false;
  localVideo.style.display     = 'none';
  document.getElementById('camPlaceholder').style.display = 'flex';
  document.getElementById('liveDot').style.display        = 'none';
  camStatus.innerText          = "Sin transmisión de video";
  camStatus.style.color        = "#8b949e";
  statusDisplay.innerText      = "🟢 EN VIVO — listo para emitir";
  statusDisplay.style.color    = "#3fb950";
  bitrateDisplay1.innerText    = "Packet Loss: 0 pkt";
  bitrateDisplay2.innerText    = "Throughput: 0 kbps";
  startCamBtn.innerText        = "📷 ACTIVAR CÁMARA EN VIVO";
  startCamBtn.style.background = "";
}

// ─── MEDIASOUP HELPERS ────────────────────────────────────────────────────────
async function initDevice() {
  const rtpCapabilities = await new Promise(resolve =>
    socket.emit('getRtpCapabilities', resolve)
  );
  device = new mediasoupClient.Device();
  await device.load({ routerRtpCapabilities: rtpCapabilities });
}

async function crearTransporteEnvio() {
  const transportData = await new Promise(resolve =>
    socket.emit('createTransport', { side: 'producer' }, resolve)
  );
  transport = device.createSendTransport(transportData);
  transport.on('connect', ({ dtlsParameters }, callback) =>
    socket.emit('connectTransport', { side: 'producer', dtlsParameters }, callback)
  );
  transport.on('produce', ({ kind, rtpParameters }, callback) =>
    socket.emit('produce', { kind, rtpParameters }, ({ id }) => callback({ id }))
  );
}

// ─── PODCASTS ─────────────────────────────────────────────────────────────────
function renderizarTabla() {
  tablaBody.innerHTML = "";
  if (listaAudios.length === 0) {
    tablaBody.innerHTML = `<tr><td colspan="2" style="text-align:center;padding:12px;color:#8b949e;">No hay archivos .mp3</td></tr>`;
    return;
  }
  listaAudios.forEach(audio => {
    const fila = document.createElement('tr');
    fila.className = 'table-row';
    const esActivo = podcastActivo === audio.id;
    fila.innerHTML = `
      <td style="color:#e6edf3;">${audio.archivo}</td>
      <td style="text-align:center;white-space:nowrap;">
        <button class="btn-small btn-play ${esActivo ? 'btn-pause-state' : ''}"
                data-id="${audio.id}"
                style="${esActivo ? 'background:#e3b341;color:#000;' : ''}">
          ${esActivo ? '⏸' : '▶'}
        </button>
        <button class="btn-small btn-del" data-id="${audio.id}">Eliminar</button>
      </td>`;
    tablaBody.appendChild(fila);
  });

  document.querySelectorAll('.btn-play').forEach(btn =>
    btn.addEventListener('click', e => {
      const id  = parseInt(e.currentTarget.dataset.id);
      const sel = listaAudios.find(a => a.id === id);
      if (!sel) return;

      if (podcastActivo === id) {
        // Pausar
        podcastActivo = null;
        socket2.emit('pausePodcast');
      } else {
        // Reproducir
        podcastActivo = id;
        socket2.emit('playPodcast', { archivo: sel.archivo });
      }
      renderizarTabla();
    })
  );

  document.querySelectorAll('.btn-del').forEach(btn =>
    btn.addEventListener('click', e => {
      const id = parseInt(e.currentTarget.dataset.id);
      if (podcastActivo === id) {
        podcastActivo = null;
        socket2.emit('pausePodcast');
      }
      listaAudios = listaAudios.filter(a => a.id !== id);
      renderizarTabla();
    })
  );
}

// Sincronizar estado si el audio termina solo
socket2.on('playPodcast', data => {
  if (audioActual) { audioActual.pause(); audioActual = null; }
  audioActual = new Audio(`https://192.168.56.10:3000/podcasts/${encodeURIComponent(data.archivo)}`);
  audioActual.addEventListener('ended', () => {
    podcastActivo = null;
    renderizarTabla();
  });
  audioActual.play().catch(console.error);
});

socket2.on('pausePodcast', () => {
  if (audioActual) { audioActual.pause(); }
});

btnAgregar.addEventListener('click', () => {
  const nombre = prompt("Nombre del archivo de audio:");
  if (nombre?.trim()) {
    const nuevoId = listaAudios.length > 0 ? Math.max(...listaAudios.map(a => a.id)) + 1 : 1;
    listaAudios.push({ id: nuevoId, archivo: nombre.trim() });
    renderizarTabla();
  }
});

socket2.on('connect', () => {
  socket2.emit('getPodcastFiles', archivos => {
    listaAudios = archivos;
    renderizarTabla();
  });
});

// ─── CHAT ─────────────────────────────────────────────────────────────────────
function agregarMensaje(remitente, texto, esPropio) {
  if (welcomeMsg?.parentNode) welcomeMsg.remove();
  const div = document.createElement('div');
  div.style.cssText = 'margin-bottom:8px;word-break:break-word;';
  const color  = esPropio ? '#58a6ff' : '#ff7b72';
  const nombre = esPropio ? 'Tú' : remitente;
  div.innerHTML = `<strong style="color:${color};">${nombre}:</strong> <span style="color:#e6edf3;">${texto}</span>`;
  chatDisplay.appendChild(div);
  chatDisplay.scrollTop = chatDisplay.scrollHeight;
}

function enviarMensaje() {
  const texto = chatInput.value.trim();
  if (!texto) return;
  agregarMensaje('Broadcaster', texto, true);
  socket2.emit('chatMessage', { usuario: 'Broadcaster', mensaje: texto });
  chatInput.value = "";
}

sendChatBtn.addEventListener('click', enviarMensaje);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') enviarMensaje(); });
socket2.on('chatMessage', data => {
  if (data.usuario === 'Broadcaster') return;
  agregarMensaje(data.usuario, data.mensaje, false);
});