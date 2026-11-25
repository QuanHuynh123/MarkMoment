import {
  computeNextTrigger,
  computePresetTimestamp,
  countActiveSchedules,
  extractDomain,
  filterBookmarks,
  formatContextBadge,
  formatScheduleBadge,
  formatTime,
  isSafeFaviconUrl,
  normalizeSoundSource,
  normalizeThemeMode,
  normalizeThemePreset,
} from '../shared/core.js';
import {
  clearCustomSound,
  createId,
  getBookmarks,
  getCustomSound,
  getMissedIds,
  getSettings,
  updateSettings,
} from '../shared/storage.js';
import { playNotificationAudio } from '../shared/sound.js';

const ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>',
  palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>',
};

// State
let activeTabState = { injectable: false, tab: null, context: null };
let bookmarks = [];
let missedIds = [];
let settings = {
  theme: 'auto',
  themePreset: 'indigo',
  soundEnabled: true,
  soundSource: 'chime',
  closeTabOnSave: false,
  dndFullscreen: true,
};
let customSound = null;

let filterTab = 'saved';
let filterTag = 'all';
let searchQuery = '';
let editingCardId = null;
let openMenuCardId = null;

// Draft schedule for Quick Capture Card
let draftSchedule = {
  enabled: false,
  repeat: 'none',
  days: [1, 3, 5],
  date: '',
  time: '20:30',
  nextTriggerAt: null,
  note: '',
};

let lastDeletedBookmark = null;
let statusTimer = null;

// Elements
const btnSearchToggle = document.getElementById('btn-search-toggle');
const btnThemeToggle = document.getElementById('btn-theme-toggle');
const themePopover = document.getElementById('theme-popover');
const themePickerAnchor = btnThemeToggle.closest('.theme-picker-anchor');
const btnSoundTest = document.getElementById('btn-sound-test');
const btnSoundMore = document.getElementById('btn-sound-more');
const btnSoundToggle = document.getElementById('btn-sound-toggle');
const soundDrawer = document.getElementById('sound-drawer');
const customSoundBox = document.getElementById('custom-sound-box');
const customSoundName = document.getElementById('custom-sound-name');
const btnUploadSound = document.getElementById('btn-upload-sound');
const btnResetSound = document.getElementById('btn-reset-sound');
const searchBar = document.getElementById('search-bar');
const searchInput = document.getElementById('search-input');

const capIcon = document.getElementById('cap-icon');
const capTag = document.getElementById('cap-tag');
const capTitle = document.getElementById('cap-title');
const capMeta = document.getElementById('cap-meta');

const schedulePanel = document.getElementById('schedule-panel');
const btnToggleSchedule = document.getElementById('btn-toggle-schedule');
const scheduleBtnLabel = document.getElementById('schedule-btn-label');
const btnClearSchedule = document.getElementById('btn-clear-schedule');
const schedDateInput = document.getElementById('sched-date');
const schedTimeInput = document.getElementById('sched-time');
const daysRow = document.getElementById('days-row');
const schedNoteInput = document.getElementById('sched-note');
const chkCloseTab = document.getElementById('chk-close-tab');
const btnSaveNow = document.getElementById('btn-save-now');

const missedBanner = document.getElementById('missed-banner');
const missedBannerLabel = document.getElementById('missed-banner-label');
const btnMissedOpen = document.getElementById('btn-missed-open');
const btnMissedDismiss = document.getElementById('btn-missed-dismiss');

const tabSavedBtn = document.getElementById('tab-saved');
const tabScheduledBtn = document.getElementById('tab-scheduled');
const countSaved = document.getElementById('count-saved');
const countScheduled = document.getElementById('count-scheduled');
const tagFilterSelect = document.getElementById('tag-filter');
const tagFilterWrap = document.getElementById('tag-filter-wrap');
const bookmarkList = document.getElementById('bookmark-list');

const statusBar = document.getElementById('status-bar');
const statusText = document.getElementById('status-text');
const btnUndo = document.getElementById('btn-undo');

// ---------- HELPERS ----------
function toDateInputValue(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toTimeInputValue(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function showStatus(text, { allowUndo = false } = {}) {
  statusText.textContent = text;
  btnUndo.classList.toggle('hidden', !allowUndo);
  statusBar.classList.remove('hidden');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusBar.classList.add('hidden');
    if (allowUndo) lastDeletedBookmark = null;
  }, 4200);
}

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

  btnThemeToggle.innerHTML = ICONS.palette;
  document.querySelectorAll('[data-theme-mode]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.themeMode === safeMode));
  });
  document.querySelectorAll('[data-theme-preset]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.themePreset === safePreset));
  });
}

function renderSoundSetting(enabled, soundSource) {
  const isOn = enabled !== false;
  const safeSource = normalizeSoundSource(soundSource);
  btnSoundToggle.setAttribute('aria-checked', String(isOn));
  btnSoundTest.style.opacity = isOn ? '1' : '0.5';

  document.querySelectorAll('[data-sound-source]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.soundSource === safeSource));
  });

  customSoundBox.classList.toggle('hidden', safeSource !== 'custom');
  if (customSound && customSound.name) {
    customSoundName.textContent = customSound.name;
    btnResetSound.classList.remove('hidden');
  } else {
    customSoundName.textContent = 'sena.mp3 (mẫu sẵn)';
    btnResetSound.classList.add('hidden');
  }
}

function previewSelectedSound() {
  const sampleUrl = chrome?.runtime?.getURL ? chrome.runtime.getURL('assets/sena.mp3') : '';
  return playNotificationAudio({
    soundSource: normalizeSoundSource(settings.soundSource),
    customSoundDataUrl: (customSound && customSound.dataUrl) || '',
    sampleUrl,
  });
}

function getChromeFaviconFallbackUrl(pageUrl) {
  if (!pageUrl || !chrome?.runtime?.getURL) return '';
  try {
    return chrome.runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`);
  } catch {
    return '';
  }
}

function renderSiteAvatarInto(container, url, favIconUrl, context) {
  const isVideo = context && (context.kind === 'youtube' || context.kind === 'video');
  const fallbackSvg = isVideo ? ICONS.play : ICONS.file;

  const showSvgFallback = () => {
    container.innerHTML = fallbackSvg;
  };

  const chromeFav = getChromeFaviconFallbackUrl(url);
  const primarySrc = isSafeFaviconUrl(favIconUrl) ? favIconUrl : chromeFav;

  if (!primarySrc) {
    showSvgFallback();
    return;
  }

  const img = document.createElement('img');
  img.className = 'site-favicon';
  img.width = 16;
  img.height = 16;
  img.alt = '';
  let triedFallback = primarySrc === chromeFav;

  img.addEventListener('error', () => {
    if (!triedFallback && chromeFav) {
      triedFallback = true;
      img.src = chromeFav;
    } else {
      showSvgFallback();
    }
  });

  img.src = primarySrc;
  container.innerHTML = '';
  container.appendChild(img);
}

function buildStatusInline(context) {
  const isVideo = context && (context.kind === 'youtube' || context.kind === 'video');
  const isActiveRead =
    context && context.kind === 'scroll' && Number(context.scrollPercent || 0) > 0;
  const dotClass = isVideo ? 'video' : isActiveRead ? 'read' : '';
  const labelText =
    isVideo && context.duration > 0
      ? `${formatContextBadge(context)} / ${formatTime(context.duration)}`
      : formatContextBadge(context);

  const wrap = document.createElement('span');
  wrap.className = 'status-inline';
  const dot = document.createElement('span');
  dot.className = `status-dot ${dotClass}`.trim();
  const txt = document.createElement('span');
  txt.textContent = labelText;
  wrap.appendChild(dot);
  wrap.appendChild(txt);
  return wrap;
}

// ---------- CAPTURE CARD RENDERING ----------
function renderCaptureCard() {
  const { injectable, tab, context } = activeTabState;
  if (!tab || !injectable) {
    capIcon.innerHTML = ICONS.globe;
    capTitle.textContent = (tab && tab.title) || 'Trang hệ thống Chrome';
    capMeta.innerHTML = '<span class="domain-label">Mở YouTube, blog hoặc web thường để lưu mốc</span>';
    btnSaveNow.disabled = true;
    return;
  }

  btnSaveNow.disabled = false;
  const isVideo = context && (context.kind === 'youtube' || context.kind === 'video');
  renderSiteAvatarInto(capIcon, tab.url, tab.favIconUrl, context);
  capTitle.textContent = tab.title || tab.url;
  capTitle.title = tab.title || tab.url;

  const statusNode = buildStatusInline(context);
  const sep = document.createElement('span');
  sep.className = 'meta-sep';
  sep.textContent = '·';
  const domainSpan = document.createElement('span');
  domainSpan.className = 'domain-label';
  domainSpan.textContent = tab.domain || extractDomain(tab.url);

  capMeta.innerHTML = '';
  capMeta.appendChild(statusNode);
  capMeta.appendChild(sep);
  capMeta.appendChild(domainSpan);

  capTag.value = isVideo ? 'Tiếng Anh' : 'Đọc sau';
}

// ---------- DRAFT SCHEDULE LOGIC ----------
function syncDraftScheduleUI() {
  if (draftSchedule.enabled) {
    const label = formatScheduleBadge(draftSchedule);
    scheduleBtnLabel.textContent = label || 'Đã chọn giờ';
    btnToggleSchedule.classList.add('active');
  } else {
    scheduleBtnLabel.textContent = 'Hẹn giờ';
    btnToggleSchedule.classList.remove('active');
  }

  document.querySelectorAll('#schedule-panel [data-repeat]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.repeat === draftSchedule.repeat));
  });

  daysRow.classList.toggle('hidden', draftSchedule.repeat !== 'custom');
  document.querySelectorAll('#days-row .day-btn').forEach((btn) => {
    const day = Number(btn.dataset.day);
    btn.setAttribute('aria-pressed', String(draftSchedule.days.includes(day)));
  });
}

function updateDraftTriggerFromInputs() {
  draftSchedule.enabled = true;
  draftSchedule.date = schedDateInput.value;
  draftSchedule.time = schedTimeInput.value || '20:30';
  draftSchedule.note = schedNoteInput.value.trim();
  const nextTs = computeNextTrigger(draftSchedule);
  if (nextTs) {
    draftSchedule.nextTriggerAt = nextTs;
  } else if (draftSchedule.repeat === 'none') {
    const tomorrow = Date.now() + 24 * 60 * 60_000;
    draftSchedule.date = toDateInputValue(tomorrow);
    schedDateInput.value = draftSchedule.date;
    draftSchedule.nextTriggerAt = computeNextTrigger(draftSchedule);
  }
  syncDraftScheduleUI();
}

function resetDraftSchedule() {
  const now = Date.now();
  draftSchedule = {
    enabled: false,
    repeat: 'none',
    days: [1, 3, 5],
    date: toDateInputValue(now),
    time: '20:30',
    nextTriggerAt: null,
    note: '',
  };
  schedDateInput.value = draftSchedule.date;
  schedTimeInput.value = draftSchedule.time;
  schedNoteInput.value = '';
  document.querySelectorAll('#schedule-panel [data-preset]').forEach((b) => b.classList.remove('active'));
  syncDraftScheduleUI();
}

// ---------- MISSED BANNER & BOOKMARK LIST ----------
function renderMissedBanner() {
  if (!missedIds || missedIds.length === 0) {
    missedBanner.classList.add('hidden');
    return;
  }
  missedBanner.classList.remove('hidden');
  missedBannerLabel.textContent = `Bạn có ${missedIds.length} lịch nhắc vừa lỡ`;
}

function renderFilterTabs() {
  countSaved.textContent = String(bookmarks.length);
  countScheduled.textContent = String(countActiveSchedules(bookmarks));

  tabSavedBtn.classList.toggle('active', filterTab === 'saved');
  tabSavedBtn.setAttribute('aria-selected', String(filterTab === 'saved'));
  tabScheduledBtn.classList.toggle('active', filterTab === 'scheduled');
  tabScheduledBtn.setAttribute('aria-selected', String(filterTab === 'scheduled'));
  tagFilterWrap.classList.toggle('active', filterTag !== 'all');
}

function createInlineScheduleEditor(bm) {
  const existing = bm.schedule || {};
  const initTs = existing.nextTriggerAt || computePresetTimestamp('+1h');
  let edState = {
    enabled: true,
    repeat: existing.repeat || 'none',
    days: Array.isArray(existing.days) && existing.days.length ? [...existing.days] : [1, 3, 5],
    date: existing.date || toDateInputValue(initTs),
    time: existing.time || toTimeInputValue(initTs),
    note: existing.note || '',
  };

  const editor = document.createElement('div');
  editor.className = 'card-editor';
  editor.innerHTML = `
    <div class="datetime-row">
      <input type="date" class="input input-sm ed-date" value="${edState.date}" aria-label="Ngày nhắc mới" />
      <input type="time" class="input input-sm font-mono ed-time" value="${edState.time}" aria-label="Giờ nhắc mới" />
    </div>
    <div class="repeat-row">
      <button type="button" class="chip-btn" data-ed-repeat="none" aria-pressed="${edState.repeat === 'none'}">Một lần</button>
      <button type="button" class="chip-btn" data-ed-repeat="daily" aria-pressed="${edState.repeat === 'daily'}">Hằng ngày</button>
      <button type="button" class="chip-btn" data-ed-repeat="weekdays" aria-pressed="${edState.repeat === 'weekdays'}">T2–T6</button>
      <button type="button" class="chip-btn" data-ed-repeat="custom" aria-pressed="${edState.repeat === 'custom'}">Chọn thứ</button>
    </div>
    <div class="days-row ed-days ${edState.repeat === 'custom' ? '' : 'hidden'}">
      ${[
        [1, 'T2'],
        [2, 'T3'],
        [3, 'T4'],
        [4, 'T5'],
        [5, 'T6'],
        [6, 'T7'],
        [0, 'CN'],
      ]
        .map(
          ([d, lbl]) =>
            `<button type="button" class="day-btn" data-ed-day="${d}" aria-pressed="${edState.days.includes(d)}">${lbl}</button>`
        )
        .join('')}
    </div>
    <input type="text" class="input input-sm ed-note" maxlength="80" placeholder="Ghi chú nhắc nhở..." aria-label="Ghi chú" />
    <div class="editor-footer">
      <button type="button" class="text-link ed-clear">Tắt lịch</button>
      <div class="editor-btns">
        <button type="button" class="text-link ed-cancel">Hủy</button>
        <button type="button" class="btn-primary ed-save">Lưu lịch</button>
      </div>
    </div>
  `;

  editor.querySelector('.ed-note').value = edState.note;

  editor.querySelectorAll('[data-ed-repeat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      edState.repeat = btn.dataset.edRepeat;
      editor.querySelectorAll('[data-ed-repeat]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.edRepeat === edState.repeat));
      });
      editor.querySelector('.ed-days').classList.toggle('hidden', edState.repeat !== 'custom');
    });
  });

  editor.querySelectorAll('[data-ed-day]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const d = Number(btn.dataset.edDay);
      if (edState.days.includes(d)) {
        if (edState.days.length > 1) edState.days = edState.days.filter((x) => x !== d);
      } else {
        edState.days.push(d);
      }
      btn.setAttribute('aria-pressed', String(edState.days.includes(d)));
    });
  });

  editor.querySelector('.ed-clear').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'UPDATE_BOOKMARK_SCHEDULE', id: bm.id, schedule: null });
    editingCardId = null;
    await refreshData();
    showStatus('Đã tắt lịch nhắc');
  });

  editor.querySelector('.ed-cancel').addEventListener('click', () => {
    editingCardId = null;
    renderBookmarkList();
  });

  editor.querySelector('.ed-save').addEventListener('click', async () => {
    edState.date = editor.querySelector('.ed-date').value;
    edState.time = editor.querySelector('.ed-time').value || '20:30';
    edState.note = editor.querySelector('.ed-note').value.trim();
    const nextTriggerAt = computeNextTrigger(edState);
    if (!nextTriggerAt) {
      showStatus('Hãy chọn thời gian ở tương lai');
      return;
    }
    const schedule = {
      enabled: true,
      repeat: edState.repeat,
      days: edState.repeat === 'custom' ? edState.days : [],
      date: edState.repeat === 'none' ? edState.date : '',
      time: edState.time,
      nextTriggerAt,
      note: edState.note,
      fired: false,
      missed: false,
    };
    await chrome.runtime.sendMessage({ type: 'UPDATE_BOOKMARK_SCHEDULE', id: bm.id, schedule });
    editingCardId = null;
    await refreshData();
    showStatus(`Đã hẹn: ${formatScheduleBadge(schedule)}`);
  });

  return editor;
}

function renderBookmarkList() {
  renderFilterTabs();
  const visible = filterBookmarks(bookmarks, {
    tab: filterTab,
    tag: filterTag,
    query: searchQuery,
  });

  bookmarkList.innerHTML = '';
  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `<strong>${filterTab === 'scheduled' ? 'Chưa có lịch hẹn nào' : 'Chưa có tab nào được lưu'}</strong><span>Bấm "Lưu ngay" hoặc nhấn Alt+S trên tab bất kỳ để lưu đúng mốc đang xem.</span>`;
    bookmarkList.appendChild(empty);
    return;
  }

  visible.forEach((bm, idx) => {
    const card = document.createElement('article');
    const isMenuOpen = openMenuCardId === bm.id;
    card.className = `bookmark-card${isMenuOpen ? ' menu-open' : ''}`;

    const main = document.createElement('div');
    main.className = 'card-main';

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'card-open-btn';
    openBtn.title = bm.title;

    const avatar = document.createElement('div');
    avatar.className = 'site-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    renderSiteAvatarInto(avatar, bm.url, bm.favIconUrl, bm.context);

    const body = document.createElement('div');
    body.className = 'card-body';

    const titleEl = document.createElement('div');
    titleEl.className = 'card-title';
    titleEl.textContent = bm.title || bm.url;

    const metaLine = document.createElement('div');
    metaLine.className = 'card-meta-line';

    // Calm inline context status (dot + text)
    const statusWrap = document.createElement('span');
    statusWrap.className = 'status-inline';
    const isVideo = bm.context && (bm.context.kind === 'youtube' || bm.context.kind === 'video');
    const isActiveRead =
      bm.context && bm.context.kind === 'scroll' && Number(bm.context.scrollPercent || 0) > 0;
    const dot = document.createElement('span');
    dot.className = `status-dot ${isVideo ? 'video' : isActiveRead ? 'read' : ''}`.trim();
    const statusTxt = document.createElement('span');
    statusTxt.textContent = formatContextBadge(bm.context);
    statusWrap.appendChild(dot);
    statusWrap.appendChild(statusTxt);

    const sep = document.createElement('span');
    sep.className = 'meta-sep';
    sep.textContent = '·';

    const domSpan = document.createElement('span');
    domSpan.className = 'domain-label';
    domSpan.textContent = bm.domain || extractDomain(bm.url);

    metaLine.appendChild(statusWrap);
    metaLine.appendChild(sep);
    metaLine.appendChild(domSpan);

    if (bm.schedule && bm.schedule.enabled && !bm.schedule.fired) {
      const schedBadge = document.createElement('span');
      schedBadge.className = 'badge-alarm';
      schedBadge.innerHTML = `${ICONS.bell}<span></span>`;
      schedBadge.querySelector('span').textContent = formatScheduleBadge(bm.schedule);
      metaLine.appendChild(schedBadge);
    }

    body.appendChild(titleEl);
    body.appendChild(metaLine);
    openBtn.appendChild(avatar);
    openBtn.appendChild(body);

    openBtn.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'OPEN_BOOKMARK', id: bm.id });
      window.close();
    });

    // Single compact ⋯ Row Action Menu
    const menuAnchor = document.createElement('div');
    menuAnchor.className = 'row-menu-anchor';

    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'row-menu-btn';
    moreBtn.innerHTML = ICONS.more;
    moreBtn.setAttribute('aria-label', `Tùy chọn cho ${bm.title}`);
    moreBtn.setAttribute('aria-haspopup', 'menu');
    moreBtn.setAttribute('aria-expanded', String(isMenuOpen));

    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openMenuCardId = openMenuCardId === bm.id ? null : bm.id;
      renderBookmarkList();
    });

    menuAnchor.appendChild(moreBtn);

    if (isMenuOpen) {
      const menu = document.createElement('div');
      const openUp = visible.length >= 2 && idx === visible.length - 1;
      menu.className = `row-menu${openUp ? ' open-up' : ''}`;
      menu.setAttribute('role', 'menu');

      const schedItem = document.createElement('button');
      schedItem.type = 'button';
      schedItem.className = 'row-menu-item';
      schedItem.setAttribute('role', 'menuitem');
      schedItem.innerHTML = `${ICONS.clock}<span>Hẹn giờ / Sửa lịch</span>`;
      schedItem.addEventListener('click', (e) => {
        e.stopPropagation();
        openMenuCardId = null;
        editingCardId = editingCardId === bm.id ? null : bm.id;
        renderBookmarkList();
      });

      const delItem = document.createElement('button');
      delItem.type = 'button';
      delItem.className = 'row-menu-item danger';
      delItem.setAttribute('role', 'menuitem');
      delItem.innerHTML = `${ICONS.trash}<span>Xóa thẻ</span>`;
      delItem.addEventListener('click', async (e) => {
        e.stopPropagation();
        openMenuCardId = null;
        lastDeletedBookmark = bm;
        await chrome.runtime.sendMessage({ type: 'DELETE_BOOKMARK', id: bm.id });
        await refreshData();
        showStatus(`Đã xóa "${bm.title}"`, { allowUndo: true });
      });

      menu.appendChild(schedItem);
      menu.appendChild(delItem);
      menuAnchor.appendChild(menu);
    }

    main.appendChild(openBtn);
    main.appendChild(menuAnchor);
    card.appendChild(main);

    if (editingCardId === bm.id) {
      card.appendChild(createInlineScheduleEditor(bm));
    }

    bookmarkList.appendChild(card);
  });
}

// ---------- DATA LOADING ----------
async function refreshData() {
  const [list, missed] = await Promise.all([getBookmarks(), getMissedIds()]);
  bookmarks = list;
  missedIds = missed;
  renderMissedBanner();
  renderBookmarkList();
}

// ---------- EVENT LISTENERS ----------
btnSearchToggle.addEventListener('click', () => {
  const willShow = searchBar.classList.contains('hidden');
  searchBar.classList.toggle('hidden', !willShow);
  btnSearchToggle.setAttribute('aria-expanded', String(willShow));
  if (willShow) {
    searchInput.focus();
  } else {
    searchQuery = '';
    searchInput.value = '';
    renderBookmarkList();
  }
});

searchInput.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderBookmarkList();
});

function setThemePopoverOpen(open) {
  themePopover.classList.toggle('hidden', !open);
  btnThemeToggle.setAttribute('aria-expanded', String(open));
}

btnThemeToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = themePopover.classList.contains('hidden');
  setThemePopoverOpen(willOpen);
});

document.addEventListener('click', (e) => {
  if (!themePopover.classList.contains('hidden') && !themePickerAnchor.contains(e.target)) {
    setThemePopoverOpen(false);
  }
  if (openMenuCardId && !e.target.closest('.row-menu-anchor')) {
    openMenuCardId = null;
    renderBookmarkList();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!themePopover.classList.contains('hidden')) {
      setThemePopoverOpen(false);
      btnThemeToggle.focus();
      return;
    }
    if (openMenuCardId) {
      openMenuCardId = null;
      renderBookmarkList();
    }
  }
});

document.querySelectorAll('[data-theme-mode]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const nextMode = normalizeThemeMode(btn.dataset.themeMode);
    settings = await updateSettings({ theme: nextMode });
    applyTheme(settings.theme, settings.themePreset);
    chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' }).catch(() => {});
  });
});

document.querySelectorAll('[data-theme-preset]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const nextPreset = normalizeThemePreset(btn.dataset.themePreset);
    settings = await updateSettings({ themePreset: nextPreset });
    applyTheme(settings.theme, settings.themePreset);
    chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' }).catch(() => {});
  });
});

btnSoundTest.addEventListener('click', () => {
  previewSelectedSound().catch(() => {});
});

btnSoundMore.addEventListener('click', () => {
  const willOpen = soundDrawer.classList.contains('hidden');
  soundDrawer.classList.toggle('hidden', !willOpen);
  btnSoundMore.setAttribute('aria-expanded', String(willOpen));
});

document.querySelectorAll('[data-sound-source]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const nextSource = normalizeSoundSource(btn.dataset.soundSource);
    settings = await updateSettings({ soundSource: nextSource, soundEnabled: true });
    renderSoundSetting(settings.soundEnabled, settings.soundSource);
    previewSelectedSound().catch(() => {});
  });
});

btnUploadSound.addEventListener('click', () => {
  const pickerUrl = chrome.runtime.getURL('options/sound.html');
  chrome.windows.create({
    url: pickerUrl,
    type: 'popup',
    width: 390,
    height: 360,
  });
});

btnResetSound.addEventListener('click', async () => {
  await clearCustomSound();
  customSound = null;
  renderSoundSetting(settings.soundEnabled, settings.soundSource);
  previewSelectedSound().catch(() => {});
});

btnSoundToggle.addEventListener('click', async () => {
  const nextSound = settings.soundEnabled === false;
  settings = await updateSettings({ soundEnabled: nextSound });
  renderSoundSetting(settings.soundEnabled, settings.soundSource);
  if (nextSound) {
    previewSelectedSound().catch(() => {});
  }
});

btnToggleSchedule.addEventListener('click', () => {
  const willOpen = schedulePanel.classList.contains('hidden');
  schedulePanel.classList.toggle('hidden', !willOpen);
  btnToggleSchedule.setAttribute('aria-expanded', String(willOpen));
});

btnClearSchedule.addEventListener('click', () => {
  resetDraftSchedule();
  schedulePanel.classList.add('hidden');
  btnToggleSchedule.setAttribute('aria-expanded', 'false');
});

document.querySelectorAll('#schedule-panel [data-preset]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const presetKey = btn.dataset.preset;
    const ts = computePresetTimestamp(presetKey);
    if (!ts) return;

    document.querySelectorAll('#schedule-panel [data-preset]').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });

    draftSchedule.enabled = true;
    draftSchedule.repeat = 'none';
    draftSchedule.date = toDateInputValue(ts);
    draftSchedule.time = toTimeInputValue(ts);
    draftSchedule.nextTriggerAt = ts;
    schedDateInput.value = draftSchedule.date;
    schedTimeInput.value = draftSchedule.time;
    syncDraftScheduleUI();
  });
});

schedDateInput.addEventListener('change', updateDraftTriggerFromInputs);
schedTimeInput.addEventListener('change', updateDraftTriggerFromInputs);
schedNoteInput.addEventListener('input', () => {
  draftSchedule.note = schedNoteInput.value.trim();
});

document.querySelectorAll('#schedule-panel [data-repeat]').forEach((btn) => {
  btn.addEventListener('click', () => {
    draftSchedule.repeat = btn.dataset.repeat;
    draftSchedule.enabled = true;
    updateDraftTriggerFromInputs();
  });
});

document.querySelectorAll('#days-row .day-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const day = Number(btn.dataset.day);
    if (draftSchedule.days.includes(day)) {
      if (draftSchedule.days.length > 1) {
        draftSchedule.days = draftSchedule.days.filter((d) => d !== day);
      }
    } else {
      draftSchedule.days.push(day);
    }
    draftSchedule.enabled = true;
    updateDraftTriggerFromInputs();
  });
});

chkCloseTab.addEventListener('change', async () => {
  settings = await updateSettings({ closeTabOnSave: chkCloseTab.checked });
});

btnSaveNow.addEventListener('click', async () => {
  if (!activeTabState.tab || !activeTabState.injectable) return;

  let scheduleObj = null;
  if (draftSchedule.enabled) {
    const nextTriggerAt = computeNextTrigger(draftSchedule) || draftSchedule.nextTriggerAt;
    if (!nextTriggerAt || nextTriggerAt <= Date.now()) {
      showStatus('Vui lòng chọn thời gian hẹn ở tương lai');
      return;
    }
    scheduleObj = {
      enabled: true,
      repeat: draftSchedule.repeat,
      days: draftSchedule.repeat === 'custom' ? [...draftSchedule.days] : [],
      date: draftSchedule.repeat === 'none' ? draftSchedule.date : '',
      time: draftSchedule.time,
      nextTriggerAt,
      note: schedNoteInput.value.trim(),
      fired: false,
      missed: false,
    };
  }

  const tab = activeTabState.tab;
  const bookmark = {
    id: createId(),
    url: tab.url,
    title: tab.title || tab.url,
    domain: tab.domain || extractDomain(tab.url),
    favIconUrl: tab.favIconUrl || '',
    tag: capTag.value,
    context: activeTabState.context,
    schedule: scheduleObj,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await chrome.runtime.sendMessage({
    type: 'SAVE_BOOKMARK',
    bookmark,
    closeTab: chkCloseTab.checked,
    tabId: tab.id,
  });

  if (chkCloseTab.checked) {
    window.close();
    return;
  }

  btnSaveNow.textContent = 'Đã lưu';
  btnSaveNow.classList.add('saved');
  setTimeout(() => {
    btnSaveNow.textContent = 'Lưu ngay';
    btnSaveNow.classList.remove('saved');
  }, 1100);

  resetDraftSchedule();
  schedulePanel.classList.add('hidden');
  btnToggleSchedule.setAttribute('aria-expanded', 'false');
  await refreshData();
  showStatus(
    scheduleObj
      ? `Đã lưu • Hẹn ${formatScheduleBadge(scheduleObj)}`
      : `Đã lưu mốc ${formatContextBadge(bookmark.context)}`
  );
});

tabSavedBtn.addEventListener('click', () => {
  filterTab = 'saved';
  openMenuCardId = null;
  renderBookmarkList();
});

tabScheduledBtn.addEventListener('click', () => {
  filterTab = 'scheduled';
  openMenuCardId = null;
  renderBookmarkList();
});

tagFilterSelect.addEventListener('change', (e) => {
  filterTag = e.target.value;
  renderBookmarkList();
});

btnMissedOpen.addEventListener('click', async () => {
  if (missedIds[0]) {
    await chrome.runtime.sendMessage({ type: 'OPEN_BOOKMARK', id: missedIds[0] });
    window.close();
  }
});

btnMissedDismiss.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'DISMISS_MISSED' });
  await refreshData();
});

btnUndo.addEventListener('click', async () => {
  if (!lastDeletedBookmark) return;
  const toRestore = lastDeletedBookmark;
  lastDeletedBookmark = null;
  await chrome.runtime.sendMessage({ type: 'RESTORE_DELETED_BOOKMARK', bookmark: toRestore });
  statusBar.classList.add('hidden');
  await refreshData();
});

// ---------- INIT ----------
async function init() {
  const [loadedSettings, loadedCustomSound] = await Promise.all([
    getSettings(),
    getCustomSound(),
  ]);
  settings = loadedSettings;
  customSound = loadedCustomSound;
  applyTheme(settings.theme, settings.themePreset);
  renderSoundSetting(settings.soundEnabled, settings.soundSource);
  chkCloseTab.checked = Boolean(settings.closeTabOnSave);
  resetDraftSchedule();

  const [tabResponse] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_CONTEXT' }).catch(() => null),
    refreshData(),
  ]);

  if (tabResponse && tabResponse.ok) {
    activeTabState = tabResponse;
  }
  renderCaptureCard();
}

init();
