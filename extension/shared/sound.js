/**
 * Synthesize a soft, crystal-clear two-note "tình tinh" chime via Web Audio API.
 */

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
