/**
 * Pure domain logic for MarkMoment (zero Chrome API dependencies).
 */

export const THEME_PRESETS = ['indigo', 'paper', 'sage', 'rose', 'mono'];

export const PRESET_BADGE_COLORS = {
  indigo: '#4F46E5',
  paper: '#B45309',
  sage: '#0F766E',
  rose: '#BE185D',
  mono: '#18181B',
};

export function normalizeThemePreset(preset) {
  return THEME_PRESETS.includes(preset) ? preset : 'indigo';
}

export function normalizeThemeMode(mode) {
  return mode === 'light' || mode === 'dark' || mode === 'auto' ? mode : 'auto';
}

export const SOUND_SOURCES = ['chime', 'sample', 'custom'];
export const MAX_CUSTOM_SOUND_BYTES = 2 * 1024 * 1024;
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|webm|aac)$/i;

export function normalizeSoundSource(source) {
  return SOUND_SOURCES.includes(source) ? source : 'chime';
}

/**
 * Validate metadata of a user-selected custom notification sound file.
 * @param {{ name?: string, type?: string, size?: number }} file
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateCustomAudioMeta(file) {
  if (!file || typeof file !== 'object') {
    return { ok: false, error: 'Chưa chọn file âm thanh.' };
  }
  const name = typeof file.name === 'string' ? file.name.trim() : '';
  const type = typeof file.type === 'string' ? file.type.trim().toLowerCase() : '';
  const size = Number(file.size || 0);

  const isAudioType = type.startsWith('audio/') || AUDIO_EXT_RE.test(name);
  if (!isAudioType) {
    return { ok: false, error: 'Chỉ hỗ trợ file âm thanh (.mp3, .wav, .ogg, .m4a).' };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: 'File âm thanh rỗng hoặc không hợp lệ.' };
  }
  if (size > MAX_CUSTOM_SOUND_BYTES) {
    return { ok: false, error: 'File vượt quá giới hạn 2 MB. Hãy chọn đoạn ngắn hơn.' };
  }
  return { ok: true };
}

const DAY_NAMES_VI = {
  1: 'T2',
  2: 'T3',
  3: 'T4',
  4: 'T5',
  5: 'T6',
  6: 'T7',
  0: 'CN',
};

const DAY_SORT_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * Format seconds into MM:SS or H:MM:SS.
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatTime(totalSeconds) {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * Extract a clean domain name without leading "www.".
 * @param {string} url
 * @returns {string}
 */
export function extractDomain(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/**
 * Return true if Chrome permits injecting content scripts into this URL.
 * @param {string} url
 * @returns {boolean}
 */
export function isInjectableUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (host === 'chromewebstore.google.com') return false;
    if (host === 'chrome.google.com' && parsed.pathname.startsWith('/webstore')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a YouTube URL and return its video ID and Shorts flag, or null.
 * @param {string} url
 * @returns {{ videoId: string, isShorts: boolean } | null}
 */
export function parseYouTubeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = parsed.pathname.replace(/^\/+/, '').split('/')[0];
      return id ? { videoId: id, isShorts: false } : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (parsed.pathname === '/watch') {
        const id = parsed.searchParams.get('v');
        return id ? { videoId: id, isShorts: false } : null;
      }
      if (parsed.pathname.startsWith('/shorts/')) {
        const id = parsed.pathname.slice('/shorts/'.length).split('/')[0];
        return id ? { videoId: id, isShorts: true } : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Normalize a URL for matching an existing open tab.
 * For YouTube, strips time params (`t`, `start`) and hash; for others, strips empty trailing `#`.
 * @param {string} url
 * @returns {string}
 */
export function normalizeUrlForMatch(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const yt = parseYouTubeUrl(url);
    const parsed = new URL(url);
    if (yt) {
      if (yt.isShorts) {
        return `https://www.youtube.com/shorts/${yt.videoId}`;
      }
      const canonical = new URL('https://www.youtube.com/watch');
      canonical.searchParams.set('v', yt.videoId);
      const list = parsed.searchParams.get('list');
      if (list) canonical.searchParams.set('list', list);
      return canonical.toString();
    }
    if (!parsed.hash || parsed.hash === '#') {
      parsed.hash = '';
      return parsed.toString().replace(/#$/, '');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Build the target URL with exact restoration hints (?t=...s or #page=...).
 * @param {{ url: string, context?: object }} bookmark
 * @returns {string}
 */
export function buildRestoreUrl(bookmark) {
  if (!bookmark || !bookmark.url) return '';
  const ctx = bookmark.context || {};
  try {
    const parsed = new URL(bookmark.url);
    if (ctx.kind === 'youtube' && Number(ctx.seconds) > 0) {
      const yt = parseYouTubeUrl(bookmark.url);
      if (yt && !yt.isShorts) {
        const secs = Math.floor(Number(ctx.seconds));
        parsed.searchParams.set('t', `${secs}s`);
        if (parsed.hash && parsed.hash.startsWith('#t=')) {
          parsed.hash = '';
        }
        return parsed.toString();
      }
    }
    if (ctx.kind === 'pdf' && Number(ctx.page) > 0) {
      parsed.hash = `page=${Math.floor(Number(ctx.page))}`;
      return parsed.toString();
    }
    return bookmark.url;
  } catch {
    return bookmark.url;
  }
}

/**
 * Format a compact single-line badge string describing captured context.
 * @param {object} context
 * @returns {string}
 */
export function formatContextBadge(context) {
  if (!context || typeof context !== 'object') return 'Đã lưu';
  if (context.kind === 'youtube' || context.kind === 'video') {
    return formatTime(Number(context.seconds || 0));
  }
  if (context.kind === 'scroll') {
    const pct = Number(context.scrollPercent || 0);
    return pct > 0 ? `Đọc dở ${Math.min(100, Math.round(pct))}%` : 'Đầu trang';
  }
  if (context.kind === 'pdf') {
    const page = Number(context.page || 0);
    return page > 0 ? `Trang ${Math.floor(page)}` : 'PDF';
  }
  return 'Đã lưu';
}

/**
 * Compute a preset trigger timestamp relative to nowMs.
 * @param {'+15m' | '+30m' | '+1h' | 'tonight' | 'tomorrow'} presetKey
 * @param {number} [nowMs]
 * @returns {number | null}
 */
export function computePresetTimestamp(presetKey, nowMs = Date.now()) {
  if (presetKey === '+15m') return nowMs + 15 * 60_000;
  if (presetKey === '+30m') return nowMs + 30 * 60_000;
  if (presetKey === '+1h') return nowMs + 60 * 60_000;
  if (presetKey === 'tonight') {
    const d = new Date(nowMs);
    d.setHours(20, 0, 0, 0);
    if (d.getTime() <= nowMs) {
      d.setDate(d.getDate() + 1);
    }
    return d.getTime();
  }
  if (presetKey === 'tomorrow') {
    const d = new Date(nowMs);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  }
  return null;
}

function parseTimeParts(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

function parseDateParts(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

/**
 * Compute the next trigger timestamp (in ms) strictly after fromMs, or null.
 * @param {object} schedule
 * @param {number} [fromMs]
 * @returns {number | null}
 */
export function computeNextTrigger(schedule, fromMs = Date.now()) {
  if (!schedule || !schedule.enabled) return null;
  const repeat = schedule.repeat || 'none';

  if (repeat === 'none') {
    if (schedule.fired) return null;
    const dateParts = parseDateParts(schedule.date);
    const timeParts = parseTimeParts(schedule.time);

    if (dateParts && timeParts) {
      const target = new Date(
        dateParts.year,
        dateParts.month - 1,
        dateParts.day,
        timeParts.hh,
        timeParts.mm,
        0,
        0
      );
      return target.getTime() > fromMs ? target.getTime() : null;
    }

    if (timeParts) {
      const candidate = new Date(fromMs);
      candidate.setHours(timeParts.hh, timeParts.mm, 0, 0);
      if (candidate.getTime() <= fromMs) {
        candidate.setDate(candidate.getDate() + 1);
      }
      return candidate.getTime();
    }

    if (typeof schedule.nextTriggerAt === 'number' && Number.isFinite(schedule.nextTriggerAt)) {
      return schedule.nextTriggerAt > fromMs ? schedule.nextTriggerAt : null;
    }
    return null;
  }

  const timeParts = parseTimeParts(schedule.time) || { hh: 20, mm: 0 };

  if (repeat === 'daily') {
    const candidate = new Date(fromMs);
    candidate.setHours(timeParts.hh, timeParts.mm, 0, 0);
    if (candidate.getTime() <= fromMs) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.getTime();
  }

  const allowedDays =
    repeat === 'weekdays'
      ? [1, 2, 3, 4, 5]
      : Array.isArray(schedule.days) && schedule.days.length > 0
        ? schedule.days
        : [1, 3, 5];

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(fromMs);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(timeParts.hh, timeParts.mm, 0, 0);
    if (candidate.getTime() > fromMs && allowedDays.includes(candidate.getDay())) {
      return candidate.getTime();
    }
  }
  return null;
}

/**
 * Compute a snooze timestamp N minutes from nowMs.
 * @param {number} [minutes=15]
 * @param {number} [nowMs]
 * @returns {number}
 */
export function computeSnoozeTimestamp(minutes = 15, nowMs = Date.now()) {
  const mins = Number.isFinite(minutes) && minutes > 0 ? minutes : 15;
  return nowMs + mins * 60_000;
}

/**
 * Format a schedule object into a concise single-line Vietnamese label.
 * @param {object} schedule
 * @param {number} [nowMs]
 * @returns {string}
 */
export function formatScheduleBadge(schedule, nowMs = Date.now()) {
  if (!schedule || !schedule.enabled) return '';
  const repeat = schedule.repeat || 'none';
  const pad = (n) => String(n).padStart(2, '0');

  let timeText = schedule.time || '';
  if (!timeText && typeof schedule.nextTriggerAt === 'number') {
    const dt = new Date(schedule.nextTriggerAt);
    timeText = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  }

  if (repeat === 'daily') {
    return `Hằng ngày ${timeText}`.trim();
  }
  if (repeat === 'weekdays') {
    return `T2–T6 ${timeText}`.trim();
  }
  if (repeat === 'custom') {
    const rawDays = Array.isArray(schedule.days) && schedule.days.length > 0 ? schedule.days : [1, 3, 5];
    const sorted = [...new Set(rawDays)].sort(
      (a, b) => DAY_SORT_ORDER.indexOf(a) - DAY_SORT_ORDER.indexOf(b)
    );
    const label = sorted.map((d) => DAY_NAMES_VI[d] || '').filter(Boolean).join(', ');
    return `${label} ${timeText}`.trim();
  }

  if (typeof schedule.nextTriggerAt === 'number') {
    const target = new Date(schedule.nextTriggerAt);
    const today = new Date(nowMs);
    const tomorrow = new Date(nowMs);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const sameDay = (a, b) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();

    const hhmm = `${pad(target.getHours())}:${pad(target.getMinutes())}`;
    if (sameDay(target, today)) return `Hôm nay ${hhmm}`;
    if (sameDay(target, tomorrow)) return `Ngày mai ${hhmm}`;
    return `${pad(target.getDate())}/${pad(target.getMonth() + 1)} ${hhmm}`;
  }

  return timeText || 'Đã hẹn giờ';
}

/**
 * Filter bookmarks by active tab, tag, and search query.
 * @param {Array<object>} bookmarks
 * @param {{ tab?: 'saved' | 'scheduled', tag?: string, query?: string }} [options]
 * @returns {Array<object>}
 */
export function filterBookmarks(bookmarks, { tab = 'saved', tag = 'all', query = '' } = {}) {
  if (!Array.isArray(bookmarks)) return [];
  const q = (query || '').trim().toLowerCase();

  return bookmarks.filter((bm) => {
    if (tab === 'scheduled') {
      const active = Boolean(bm.schedule && bm.schedule.enabled && !bm.schedule.fired);
      if (!active) return false;
    }
    if (tag && tag !== 'all' && bm.tag !== tag) {
      return false;
    }
    if (q) {
      const haystack = [
        bm.title || '',
        bm.domain || '',
        bm.tag || '',
        bm.schedule?.note || '',
        bm.context?.anchorText || '',
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Count bookmarks with an active, unfired scheduled reminder.
 * @param {Array<object>} bookmarks
 * @returns {number}
 */
export function countActiveSchedules(bookmarks) {
  if (!Array.isArray(bookmarks)) return 0;
  return bookmarks.filter(
    (bm) => Boolean(bm.schedule && bm.schedule.enabled && !bm.schedule.fired && bm.schedule.nextTriggerAt)
  ).length;
}

/**
 * Compute normalized scroll percentage (0..100), snapping to 100 near document bottom.
 * @param {number} scrollY
 * @param {number} scrollHeight
 * @param {number} innerHeight
 * @returns {number}
 */
export function computeScrollPercent(scrollY, scrollHeight, innerHeight) {
  const maxScroll = Math.max(0, Number(scrollHeight || 0) - Number(innerHeight || 0));
  if (maxScroll <= 0) return 0;
  const safeY = Math.max(0, Number(scrollY || 0));
  if (safeY >= maxScroll - 8) return 100;
  return Math.min(100, Math.max(0, Math.round((safeY / maxScroll) * 100)));
}

/**
 * Compute exact target scrollY when restoring a scroll bookmark.
 * @param {{
 *   anchorAbsTop?: number,
 *   anchorViewportTop?: number,
 *   scrollPercent?: number,
 *   scrollY?: number,
 *   scrollHeight?: number,
 *   innerHeight?: number,
 *   atBottom?: boolean
 * }} params
 * @returns {number}
 */
export function computeTargetScrollY({
  anchorAbsTop,
  anchorViewportTop,
  scrollPercent = 0,
  scrollY = 0,
  scrollHeight = 0,
  innerHeight = 0,
  atBottom = false,
} = {}) {
  const safeInner = Math.max(0, Number(innerHeight || 0));
  if (Number.isFinite(anchorAbsTop)) {
    const offset = Number.isFinite(anchorViewportTop)
      ? Math.min(Math.max(0, anchorViewportTop), safeInner * 0.75)
      : Math.round(safeInner * 0.25);
    return Math.max(0, Math.round(anchorAbsTop - offset));
  }
  const maxScroll = Math.max(0, Number(scrollHeight || 0) - safeInner);
  if (atBottom) return maxScroll;
  const pct = Number(scrollPercent || 0);
  if (pct > 0 && maxScroll > 0) {
    return Math.round((maxScroll * Math.min(100, pct)) / 100);
  }
  return Math.max(0, Math.round(Number(scrollY || 0)));
}

/**
 * Return true if URL is safe to render as a website favicon image source.
 * @param {string} url
 * @returns {boolean}
 */
export function isSafeFaviconUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return (
    url.startsWith('https://') ||
    url.startsWith('http://') ||
    url.startsWith('data:image/')
  );
}
