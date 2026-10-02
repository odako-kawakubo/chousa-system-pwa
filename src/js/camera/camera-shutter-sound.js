/**
 * camera-shutter-sound.js
 * 撮影音の選択・再生だけを担当する。
 * OtoLogicのMP3原音をgzipでPWA内へ同梱し、Web Audio APIのGainNodeで音量を制御する。
 * 再生失敗時も撮影処理は止めない。
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

const SOUND_ASSETS = Object.freeze({
  camera1: new URL('../../assets/audio/camera1.mp3.gz', import.meta.url).href,
  camera2: new URL('../../assets/audio/camera2.mp3.gz', import.meta.url).href,
  click: new URL('../../assets/audio/click.mp3.gz', import.meta.url).href,
  chime: new URL('../../assets/audio/chime.mp3.gz', import.meta.url).href
});

const soundBuffers = new Map();
let audioContext = null;

function volumeGain(volume) {
  return SHUTTER_VOLUME_OPTIONS.find((item) => item.value === volume)?.gain ?? 0.55;
}

function getAudioContext() {
  if (audioContext) return audioContext;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('この端末では撮影音の音量調整に対応していません。');
  }

  audioContext = new AudioContextClass();
  return audioContext;
}

async function ensureAudioContextRunning() {
  const context = getAudioContext();
  if (context.state === 'suspended') {
    await context.resume();
  }
  return context;
}

async function loadSoundBuffer(sound, context) {
  if (soundBuffers.has(sound)) return soundBuffers.get(sound);

  const assetUrl = SOUND_ASSETS[sound];
  if (!assetUrl) return null;
  if (typeof DecompressionStream !== 'function') {
    throw new Error('この端末では撮影音の展開に対応していません。');
  }

  const response = await fetch(assetUrl);
  if (!response.ok || !response.body) {
    throw new Error(`撮影音を読み込めませんでした: ${response.status}`);
  }

  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  const bytes = await new Response(stream).arrayBuffer();
  const buffer = await context.decodeAudioData(bytes.slice(0));
  soundBuffers.set(sound, buffer);
  return buffer;
}

export async function playShutterSound(sound='camera1', volume='medium') {
  if (sound === 'off') return false;

  try {
    // iPhone/iPadではユーザー操作中にAudioContextをresumeしておく必要があるため、
    // 音源読み込みより先に実行する。
    const context = await ensureAudioContextRunning();
    const buffer = await loadSoundBuffer(sound, context);
    if (!buffer) return false;

    const source = context.createBufferSource();
    const gainNode = context.createGain();
    gainNode.gain.value = volumeGain(volume);

    source.buffer = buffer;
    source.connect(gainNode);
    gainNode.connect(context.destination);
    source.start(0);
    return true;
  } catch (error) {
    console.warn('Shutter sound playback failed:', error);
    return false;
  }
}
