import { playNotificationAudio } from '../shared/sound.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'PLAY_CHIME') {
    return false;
  }

  playNotificationAudio({
    soundSource: msg.soundSource || 'chime',
    customSoundDataUrl: msg.customSoundDataUrl || '',
    sampleUrl: chrome.runtime.getURL('assets/sena.mp3'),
  })
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }));

  return true;
});
