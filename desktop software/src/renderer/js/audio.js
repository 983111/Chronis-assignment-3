'use strict';

// ── Audio capture ─────────────────────────────────────────────────────────────
// Records from microphone into RAM (MediaRecorder + Blob).
// Never writes to disk. After transcription the blob is discarded.

const Audio = (() => {
  let mediaRecorder = null;
  let audioChunks = [];
  let stream = null;
  let analyser = null;
  let animFrame = null;
  let timerInterval = null;
  let startTime = null;

  const bars = () => document.querySelectorAll('.vis-bar');
  const btnRecord = () => document.getElementById('btn-record');
  const recTimer = () => document.getElementById('rec-timer');
  const recStatus = () => document.getElementById('rec-status');

  function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function animateVisualiser() {
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const b = bars();
    b.forEach((bar, i) => {
      const idx = Math.floor((i / b.length) * data.length * 0.6);
      const val = data[idx] / 255;
      const h = Math.max(4, Math.round(val * 28));
      bar.style.height = h + 'px';
      bar.classList.toggle('active', val > 0.05);
    });
    animFrame = requestAnimationFrame(animateVisualiser);
  }

  function resetVisualiser() {
    cancelAnimationFrame(animFrame);
    bars().forEach(b => { b.style.height = '6px'; b.classList.remove('active'); });
  }

  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
      recStatus().textContent = 'Microphone access denied.';
      return false;
    }

    const ctx = new AudioContext();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    const src = ctx.createMediaStreamSource(stream);
    src.connect(analyser);

    audioChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.start(250);

    startTime = Date.now();
    timerInterval = setInterval(() => {
      recTimer().textContent = formatTime(Date.now() - startTime);
    }, 500);

    recTimer().style.display = 'inline';
    recStatus().textContent = 'Recording...';
    btnRecord().innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12"/></svg> Stop recording`;
    btnRecord().classList.remove('btn-primary');
    btnRecord().style.background = '#993556';
    btnRecord().style.borderColor = '#993556';
    btnRecord().style.color = '#fff';

    animateVisualiser();
    return true;
  }

  function stop() {
    return new Promise(resolve => {
      if (!mediaRecorder || mediaRecorder.state === 'inactive') { resolve(null); return; }

      clearInterval(timerInterval);
      recTimer().style.display = 'none';
      recStatus().textContent = 'Processing...';
      resetVisualiser();

      btnRecord().innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg> Start recording`;
      btnRecord().classList.add('btn-primary');
      btnRecord().style.background = '';
      btnRecord().style.borderColor = '';
      btnRecord().style.color = '';

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
        audioChunks = [];
        mediaRecorder = null;
        stream = null;
        analyser = null;
        resolve(blob);
      };

      mediaRecorder.stop();
    });
  }

  function isRecording() {
    return mediaRecorder && mediaRecorder.state === 'recording';
  }

  async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  return { start, stop, isRecording, blobToBase64 };
})();

window.AudioCapture = Audio;
