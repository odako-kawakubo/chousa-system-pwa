/**
 * camera-session.js
 * getUserMediaの開始・停止・復帰・世代管理だけを担当する。
 */

export function createCameraSession({ getRoot, getVideo, setReady, onReady } = {}) {
  let stream = null;
  let sessionId = 0;
  let startingSessionId = null;

  async function requestFullscreenSafe() {
    const target = document.documentElement;
    if (document.fullscreenElement || !target.requestFullscreen) return;
    try {
      await target.requestFullscreen();
    } catch {
      // Fullscreen APIが拒否されても撮影は継続する。
    }
  }

  function stop() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }

    const video = getVideo?.();
    if (video) {
      try { video.pause(); } catch {}
      video.srcObject = null;
    }

    setReady?.(false, 'カメラ停止中');
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('この環境ではカメラAPIを利用できません。');
    }
    if (startingSessionId !== null) return;

    const currentSession = ++sessionId;
    startingSessionId = currentSession;
    setReady?.(false, 'カメラを準備しています');

    try {
      stop();
      await requestFullscreenSafe();

      const acquiredStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      const root = getRoot?.();
      if (currentSession !== sessionId || !root || root.hidden) {
        acquiredStream.getTracks().forEach((track) => track.stop());
        return;
      }

      stream = acquiredStream;
      const video = getVideo?.();
      if (!video) {
        stop();
        return;
      }
      video.srcObject = stream;
      video.playsInline = true;
      video.muted = true;
      await video.play();

      if (currentSession !== sessionId || !getRoot?.() || getRoot().hidden) {
        stop();
        return;
      }

      setReady?.(true);
      onReady?.();
    } finally {
      if (startingSessionId === currentSession) startingSessionId = null;
    }
  }

  function invalidate() {
    sessionId += 1;
    startingSessionId = null;
  }

  async function resume() {
    const root = getRoot?.();
    if (!root || root.hidden || document.hidden) return;
    if (startingSessionId !== null) return;

    const liveTrack = stream?.getVideoTracks?.().find((track) => track.readyState === 'live');
    const video = getVideo?.();
    if (liveTrack && video) {
      try {
        if (video.srcObject !== stream) video.srcObject = stream;
        if (video.paused) await video.play();
        setReady?.(true);
        return;
      } catch (error) {
        console.warn('Existing camera stream resume failed:', error);
      }
    }

    try {
      await start();
    } catch (error) {
      console.warn('Camera resume failed:', error);
      setReady?.(false, 'カメラを再起動してください');
    }
  }

  function isReady() {
    return Boolean(stream && stream.getVideoTracks?.().some((track) => track.readyState === 'live'));
  }

  return { start, stop, resume, invalidate, isReady };
}

export async function getVideoInputCount() {
  if (!navigator.mediaDevices?.enumerateDevices) return null;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'videoinput').length;
  } catch {
    return null;
  }
}

export function getCameraErrorMessage(error, cameraCount) {
  const suffix = Number.isInteger(cameraCount) ? `\n認識中のカメラ：${cameraCount}台` : '';
  switch (error?.name) {
    case 'NotAllowedError': return `カメラの使用が許可されていません。ブラウザのカメラ権限を確認してください。${suffix}`;
    case 'NotFoundError': return `利用可能なカメラが見つかりませんでした。${suffix}`;
    case 'NotReadableError': return `カメラを他のアプリが使用している可能性があります。${suffix}`;
    case 'OverconstrainedError': return `指定した条件に合うカメラが見つかりませんでした。${suffix}`;
    case 'SecurityError': return `現在の接続方法ではカメラを利用できません。HTTPS環境を確認してください。${suffix}`;
    default: return `カメラを起動できませんでした。\n${error?.name || ''}\n${error?.message || error || ''}${suffix}`;
  }
}
