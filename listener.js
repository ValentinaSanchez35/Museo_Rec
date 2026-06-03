import * as mediasoupClient from 'mediasoup-client';
import { io } from 'socket.io-client';

const socket        = io('https://192.168.56.10:3000');
const statusDisplay = document.getElementById('statusDisplay');
const qosDisplay    = document.getElementById('qosDisplay');
const remoteAudio   = document.getElementById('remoteAudio');
const remoteVideo   = document.getElementById('remoteVideo');
const videoOverlay  = document.getElementById('videoOverlay');

let device;
let transport;
let pingInterval = null;

document.getElementById('startBtn').onclick = async () => {
    statusDisplay.innerText = "📡 Estado: Conectando...";
    try {
        const rtpCapabilities = await new Promise(resolve =>
            socket.emit('getRtpCapabilities', resolve)
        );
        device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: rtpCapabilities });

        // ✅ Registrar SOLO al pulsar el botón
        socket.emit('registerListener');

        // Iniciar medición de latencia
        if (!pingInterval) {
            pingInterval = setInterval(() => {
                const t0 = Date.now();
                socket.emit('ping', () => {
                    qosDisplay.innerText = `Latencia: ${Date.now() - t0} ms`;
                });
            }, 3000);
        }

        statusDisplay.innerText = "🟢 Estado: Conectado — esperando transmisión";

        document.getElementById('startBtn').innerText        = "✅ CONECTADO";
        document.getElementById('startBtn').style.background = "#238636";
        document.getElementById('startBtn').disabled         = true;

        await startConsuming();

    } catch (err) {
        console.error('❌ Error al conectar listener:', err);
        statusDisplay.innerText = "❌ Error de conexión";
    }
};

socket.on('newProducerAvailable', ({ producerId, kind }) => {
    if (device) startConsuming(producerId, kind);
});

async function startConsuming(producerId, kind) {
    if (!transport) {
        const transportData = await new Promise(resolve =>
            socket.emit('createTransport', { side: 'consumer' }, resolve)
        );
        transport = device.createRecvTransport(transportData);
        transport.on('connect', ({ dtlsParameters }, callback) =>
            socket.emit('connectTransport', { side: 'consumer', dtlsParameters }, callback)
        );
    }

    socket.emit('consume', { rtpCapabilities: device.rtpCapabilities, producerId }, async (data) => {
        if (!data || data.error) {
            console.warn('No hay producer disponible aún:', data?.error);
            return;
        }
        const consumer = await transport.consume(data);
        const stream   = new MediaStream([consumer.track]);

        if (consumer.kind === 'video') {
            remoteVideo.srcObject      = stream;
            videoOverlay.style.display = 'none';
            remoteVideo.style.display  = 'block';
            remoteVideo.play().catch(console.warn);
            statusDisplay.innerText    = "🟢 Estado: Recibiendo video en vivo";
        } else {
            remoteAudio.srcObject   = stream;
            remoteAudio.play().catch(console.warn);
            statusDisplay.innerText = "🟢 Estado: Recibiendo audio en vivo";
        }

        socket.emit('resume', () => {
            console.log(`▶ Consumer ${consumer.kind} activo`);
        });
    });
}