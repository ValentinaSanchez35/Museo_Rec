import { io } from 'socket.io-client';

const socketUI    = io('https://192.168.56.10:3000');
const chatView    = document.getElementById('chatView');
const chatInput   = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const welcomeMsg  = document.getElementById('welcomeMessage');
const remoteAudio = document.getElementById('remoteAudio');
const remoteVideo = document.getElementById('remoteVideo');
const liveBadge   = document.getElementById('liveBadge');
const viewerCount = document.getElementById('viewerCount');

remoteVideo.addEventListener('play', () => {
    liveBadge.style.display = 'block';
});

socketUI.on('listenerCount', ({ count }) => {
    viewerCount.textContent = count;
});

socketUI.on('playPodcast', (data) => {
    remoteAudio.srcObject = null;
    remoteAudio.src = `https://192.168.56.10:3000/podcasts/${encodeURIComponent(data.archivo)}`;
    remoteAudio.play().catch(console.warn);
});

socketUI.on('pausePodcast', () => {
    remoteAudio.pause();
});

socketUI.on('stopPodcast', () => {
    remoteAudio.pause();
    remoteAudio.src = "";
});

function agregarMensaje(remitente, texto, esPropio) {
    if (welcomeMsg?.parentNode) welcomeMsg.remove();
    const div = document.createElement('div');
    div.style.cssText = 'margin-bottom:8px; word-break:break-word;';
    const color  = esPropio ? '#0078d4' : '#d83b01';
    const nombre = esPropio ? 'Tú' : remitente;
    div.innerHTML = `<strong style="color:${color};">${nombre}:</strong> <span style="color:#1c1e21;">${texto}</span>`;
    chatView.appendChild(div);
    chatView.scrollTop = chatView.scrollHeight;
}

function enviarMensaje() {
    const texto = chatInput.value.trim();
    if (!texto) return;
    agregarMensaje('Oyente', texto, true);
    socketUI.emit('chatMessage', { usuario: 'Oyente', mensaje: texto });
    chatInput.value = "";
}

sendChatBtn.addEventListener('click', enviarMensaje);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') enviarMensaje(); });

socketUI.on('chatMessage', (data) => {
    if (data.usuario === 'Oyente') return;
    agregarMensaje(data.usuario, data.mensaje, false);
});