/**
 * Notification sound synthesizer & custom audio player for MarkMoment.
 */

let activeAudio = null;

export function stopActiveSound() {
  if (!activeAudio) return;
  try {
    activeAudio.pause();
    activeAudio.currentTime = 0;
  } catch {
    // Ignore audio stop errors
  }
  activeAudio = null;
}

function scheduleBellNote(ctx, destination, startTime, freq, peakGain, duration) {
  const harmonics = [
    { ratio: 1, gain: peakGain, decay: duration },
    { ratio: 2, gain: peakGain * 0.25, decay: duration * 0.55 },
    { ratio: 3, gain: peakGain * 0.06, decay: duration * 0.32 },
  ];

  for (const h of harmonics) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * h.ratio, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(h.gain, startTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + h.decay);

    osc.connect(gain);
    gain.connect(destination);

    osc.start(startTime);
    osc.stop(startTime + h.decay + 0.02);
  }
}

export async function playReminderChime() {
  stopActiveSound();
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) return false;

  const ctx = new AudioCtx();
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.9, ctx.currentTime);
    master.connect(ctx.destination);

    const now = ctx.currentTime + 0.01;
    // Rising Perfect 5th (E5 -> B5): smooth "tình - tinh" glass bell
    scheduleBellNote(ctx, master, now, 659.25, 0.2, 0.36);
    scheduleBellNote(ctx, master, now + 0.135, 987.77, 0.22, 0.48);

    await new Promise((resolve) => {
      setTimeout(resolve, 680);
    });
    return true;
  } finally {
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 80);
  }
}

export async function playAudioFromUrl(src, volume = 0.72) {
  if (!src) return false;
  stopActiveSound();

  return new Promise((resolve) => {
    const audio = new Audio(src);
    audio.volume = volume;
    activeAudio = audio;

    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      if (activeAudio === audio) activeAudio = null;
      resolve(ok);
    };

    audio.addEventListener('ended', () => finish(true), { once: true });
    audio.addEventListener('error', () => finish(false), { once: true });

    audio.play().catch(() => finish(false));
  });
}

export async function playNotificationAudio({
  soundSource = 'chime',
  customSoundDataUrl = '',
  sampleUrl = '',
} = {}) {
  if (soundSource === 'custom') {
    if (customSoundDataUrl) {
      const ok = await playAudioFromUrl(customSoundDataUrl);
      if (ok) return true;
    }
    if (sampleUrl) {
      const ok = await playAudioFromUrl(sampleUrl);
      if (ok) return true;
    }
    return playReminderChime();
  }

  if (soundSource === 'sample' && sampleUrl) {
    const ok = await playAudioFromUrl(sampleUrl);
    if (ok) return true;
  }

  return playReminderChime();
}
