/**
 * Generador de Sonido Industrial de Pistola Láser ("BEEP") — 100% Web Audio API Offline
 * Sin archivos MP3 externos para respuesta en 0ms en calle.
 */

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtxClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtxClass) return null;

  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioCtxClass();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

/**
 * Reproduce un pulso doble cristalino de pistola láser industrial:
 * - Tono 1: 1850 Hz por 85ms
 * - Tono 2: 2400 Hz por 65ms
 * + Vibración háptica [70, 30, 70]
 */
export function playScannerLaserBeep(): void {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([70, 30, 70]);
    }
  } catch {
    // Ignore on unsupported devices
  }

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Pulso 1: 1850 Hz durante 85ms
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'square';
    osc1.frequency.setValueAtTime(1850, now);

    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.exponentialRampToValueAtTime(0.22, now + 0.008);
    gain1.gain.setValueAtTime(0.22, now + 0.075);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.085);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.086);

    // Pulso 2: 2400 Hz durante 65ms (inicia a los 90ms)
    const start2 = now + 0.09;
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(2400, start2);

    gain2.gain.setValueAtTime(0.001, start2);
    gain2.gain.exponentialRampToValueAtTime(0.28, start2 + 0.008);
    gain2.gain.setValueAtTime(0.28, start2 + 0.055);
    gain2.gain.exponentialRampToValueAtTime(0.001, start2 + 0.065);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(start2);
    osc2.stop(start2 + 0.066);
  } catch {
    // Fallback silencioso si el navegador bloquea autoplay de audio
  }
}
