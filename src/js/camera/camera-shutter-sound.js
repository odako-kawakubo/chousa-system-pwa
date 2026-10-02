/**
 * camera-shutter-sound.js
 * 撮影音の選択・再生だけを担当する。
 * 音源はPWA内へ同梱したOtoLogic素材を使用し、再生失敗時も撮影処理は止めない。
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

const SOUND_URLS = Object.freeze({
  camera1: new URL('../../assets/audio/camera1.mp3', import.meta.url).href,
  camera2: new URL('../../assets/audio/camera2.mp3', import.meta.url).href,
  click: new URL('../../assets/audio/click.mp3', import.meta.url).href,
  chime: new URL('../../assets/audio/chime.mp3', import.meta.url).href
});

function volumeGain(volume) {
  return SHUTTER_VOLUME_OPTIONS.find((item) => item.value === volume)?.gain ?? 0.55;
}

export async function playShutterSound(sound='camera1', volume='medium') {
  if (sound === 'off') return false;
  const url = SOUND_URLS[sound];
  if (!url) return false;

  try {
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
