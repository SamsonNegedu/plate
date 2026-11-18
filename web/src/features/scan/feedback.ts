let ctx: AudioContext | null = null;

/** A short beep. Browsers only allow audio after a user gesture, so any failure is silent. */
export function beep(): void {
  try {
    ctx ??= new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.09);
  } catch {
    // No audio is fine.
  }
}

export function haptic(ms = 40): void {
  if ("vibrate" in navigator) navigator.vibrate(ms);
}
