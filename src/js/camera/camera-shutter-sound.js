/**
 * camera-shutter-sound.js
 * 撮影音の選択・再生だけを担当する。
 * OtoLogicのMP3原音をgzipでPWA内へ同梱し、初回再生時に展開して利用する。
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

const soundObjectUrls = new Map();

function volumeGain(volume) {
  return SHUTTER_VOLUME_OPTIONS.find((item) => item.value === volume)?.gain ?? 0.55;
}

async function resolveSoundObjectUrl(sound) {
  if (soundObjectUrls.has(sound)) return soundObjectUrls.get(sound);

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
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type:'audio/mpeg' }));
  soundObjectUrls.set(sound, objectUrl);
  return objectUrl;
}

export async function playShutterSound(sound='camera1', volume='medium') {
  if (sound === 'off') return false;

  try {
    const url = await resolveSoundObjectUrl(sound);
    if (!url) return false;

    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.volume = volumeGain(volume);
    await audio.play();
    return true;
  } catch (error) {
    console.warn('Shutter sound playback failed:', error);
    return false;
  }
}
