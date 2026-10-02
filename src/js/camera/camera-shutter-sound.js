/**
 * camera-shutter-sound.js
 * 撮影音の生成・再生だけを担当する。外部音源ファイルには依存しない。
 */

export const SHUTTER_SOUND_OPTIONS = Object.freeze([
  { value:'off', label:'無音' },
  { value:'camera1', label:'カメラ1' },
  { value:'camera2', label:'カメラ2' },
  { value:'click', label:'クリック' },
  { value:'chime', label:'チャイム' }
]);

export const SHUTTER_VOLUME_OPTIONS = Object.freeze([
  { value:'small', label:'小', gain:0.25 },
  { value:'medium', label:'中', gain:0.55 },
  { value:'large', label:'大', gain:1 }
]);

let audioContext = null;

function context() {
  if (!audioContext) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;
    audioContext = new AudioContextCtor();
  }
  return audioContext;
}

function volumeGain(volume) {
  return SHUTTER_VOLUME_OPTIONS.find((item) => item.value === volume)?.gain ?? 0.55;
}

function tone(ctx, destination, { at=0, frequency=800, duration=0.05, type='square', gain=0.18 } = {}) {
  const osc = ctx.createOscillator();
  const node = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, at);
  node.gain.setValueAtTime(Math.max(0.0001, gain), at);
  node.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(node);
  node.connect(destination);
  osc.start(at);
  osc.stop(at + duration);
}

export async function playShutterSound(sound='camera1', volume='medium') {
  if (sound === 'off') return false;
  const ctx = context();
  if (!ctx) return false;

  try {
    if (ctx.state === 'suspended') await ctx.resume();
    const master = ctx.createGain();
    master.gain.value = volumeGain(volume);
    master.connect(ctx.destination);
    const now = ctx.currentTime + 0.005;

    if (sound === 'camera2') {
      tone(ctx, master, { at:now, frequency:1200, duration:0.035, gain:0.26 });
      tone(ctx, master, { at:now + 0.045, frequency:520, duration:0.07, gain:0.20 });
    } else if (sound === 'click') {
      tone(ctx, master, { at:now, frequency:1800, duration:0.025, gain:0.25 });
    } else if (sound === 'chime') {
      tone(ctx, master, { at:now, frequency:880, duration:0.11, type:'sine', gain:0.18 });
      tone(ctx, master, { at:now + 0.08, frequency:1320, duration:0.16, type:'sine', gain:0.16 });
    } else {
      tone(ctx, master, { at:now, frequency:950, duration:0.035, gain:0.28 });
      tone(ctx, master, { at:now + 0.04, frequency:380, duration:0.075, gain:0.22 });
    }

    setTimeout(() => {
      try { master.disconnect(); } catch {}
    }, 400);
    return true;
  } catch {
    return false;
  }
}
