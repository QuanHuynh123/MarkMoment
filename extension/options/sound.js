import {
  normalizeThemeMode,
  normalizeThemePreset,
  validateCustomAudioMeta,
} from '../shared/core.js';
import {
  clearCustomSound,
  getCustomSound,
  getSettings,
  saveCustomSound,
  updateSettings,
} from '../shared/storage.js';
import { playAudioFromUrl, playNotificationAudio } from '../shared/sound.js';

const fileInput = document.getElementById('audio-file-input');
const dropzone = document.getElementById('dropzone');
const activeSoundName = document.getElementById('active-sound-name');
const activeSoundDesc = document.getElementById('active-sound-desc');
const btnPreviewActive = document.getElementById('btn-preview-active');
const btnUseSample = document.getElementById('btn-use-sample');
const btnPreviewSample = document.getElementById('btn-preview-sample');
const btnDone = document.getElementById('btn-done');
const pickerStatus = document.getElementById('picker-status');

let currentCustom = null;
const sampleUrl = chrome.runtime.getURL('assets/sena.mp3');

function applyTheme(theme, themePreset) {
  const safeMode = normalizeThemeMode(theme);
  const safePreset = normalizeThemePreset(themePreset);
  const root = document.documentElement;
  if (safeMode === 'light' || safeMode === 'dark') {
    root.setAttribute('data-theme', safeMode);
  } else {
    root.removeAttribute('data-theme');
  }
  root.setAttribute('data-preset', safePreset);
}

function setStatus(text, isError = false) {
  pickerStatus.textContent = text;
  pickerStatus.classList.toggle('error', isError);
}

function renderActiveCard() {
  if (currentCustom && currentCustom.name) {
    const kb = Math.max(1, Math.round((currentCustom.size || 0) / 1024));
    activeSoundName.textContent = currentCustom.name;
    activeSoundDesc.textContent = `File riêng (${kb} KB) • Đã kích hoạt`;
    btnUseSample.classList.remove('hidden');
  } else {
    activeSoundName.textContent = 'sena.mp3 (mẫu sẵn)';
    activeSoundDesc.textContent = 'Đang dùng âm mẫu có sẵn trong extension';
    btnUseSample.classList.add('hidden');
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không thể đọc file âm thanh.'));
    reader.readAsDataURL(file);
  });
}

async function handleSelectedFile(file) {
  const check = validateCustomAudioMeta(file);
  if (!check.ok) {
    setStatus(check.error, true);
    return;
  }

  try {
    setStatus('Đang lưu âm thanh...');
    const dataUrl = await readFileAsDataUrl(file);
    currentCustom = await saveCustomSound({
      name: file.name,
      type: file.type || 'audio/mpeg',
      size: file.size,
      dataUrl,
      updatedAt: Date.now(),
    });
    await updateSettings({ soundSource: 'custom', soundEnabled: true });
    renderActiveCard();
    setStatus(`Đã lưu "${file.name}" và đặt làm âm nhắc.`);
    playAudioFromUrl(dataUrl).catch(() => {});
  } catch (err) {
    setStatus(err.message || 'Lưu file thất bại.', true);
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  if (file) handleSelectedFile(file);
  fileInput.value = '';
});

dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleSelectedFile(file);
});

btnPreviewActive.addEventListener('click', () => {
  playNotificationAudio({
    soundSource: 'custom',
    customSoundDataUrl: (currentCustom && currentCustom.dataUrl) || '',
    sampleUrl,
  }).catch(() => {});
});

btnPreviewSample.addEventListener('click', () => {
  playAudioFromUrl(sampleUrl).catch(() => {});
});

btnUseSample.addEventListener('click', async () => {
  await clearCustomSound();
  currentCustom = null;
  await updateSettings({ soundSource: 'sample', soundEnabled: true });
  renderActiveCard();
  setStatus('Đã quay về âm mẫu sena.mp3.');
  playAudioFromUrl(sampleUrl).catch(() => {});
});

btnDone.addEventListener('click', () => {
  window.close();
});

async function init() {
  const [settings, custom] = await Promise.all([getSettings(), getCustomSound()]);
  currentCustom = custom;
  applyTheme(settings.theme, settings.themePreset);
  renderActiveCard();
}

init();
