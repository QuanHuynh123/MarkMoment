/**
 * Chrome local storage wrapper for MarkMoment.
 */

const KEYS = {
  BOOKMARKS: 'mm_bookmarks',
  SETTINGS: 'mm_settings',
  PENDING_RESTORES: 'mm_pending_restores',
  MISSED_IDS: 'mm_missed_ids',
  CUSTOM_SOUND: 'mm_custom_sound',
};

export const DEFAULT_SETTINGS = {
  theme: 'auto',
  themePreset: 'indigo',
  soundEnabled: true,
  soundSource: 'chime',
  closeTabOnSave: false,
  dndFullscreen: true,
};

/**
 * Generate a unique bookmark ID.
 * @returns {string}
 */
export function createId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return `bm-${globalThis.crypto.randomUUID()}`;
  }
  return `bm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function getBookmarks() {
  const data = await chrome.storage.local.get(KEYS.BOOKMARKS);
  return Array.isArray(data[KEYS.BOOKMARKS]) ? data[KEYS.BOOKMARKS] : [];
}

export async function saveBookmarks(bookmarks) {
  await chrome.storage.local.set({ [KEYS.BOOKMARKS]: bookmarks });
  return bookmarks;
}

export async function getBookmarkById(id) {
  const list = await getBookmarks();
  return list.find((item) => item.id === id) || null;
}

export async function upsertBookmark(bookmark) {
  const list = await getBookmarks();
  const idx = list.findIndex((item) => item.id === bookmark.id);
  if (idx >= 0) {
    list[idx] = bookmark;
  } else {
    list.unshift(bookmark);
  }
  await saveBookmarks(list);
  return bookmark;
}

export async function deleteBookmark(id) {
  const list = await getBookmarks();
  const next = list.filter((item) => item.id !== id);
  await saveBookmarks(next);
  return next;
}

export async function getSettings() {
  const data = await chrome.storage.local.get(KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(data[KEYS.SETTINGS] || {}) };
}

export async function updateSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [KEYS.SETTINGS]: next });
  return next;
}

export async function setPendingRestore(tabId, payload) {
  const data = await chrome.storage.local.get(KEYS.PENDING_RESTORES);
  const map = data[KEYS.PENDING_RESTORES] || {};
  // Prune stale entries older than 5 minutes
  const cutoff = Date.now() - 5 * 60_000;
  for (const key of Object.keys(map)) {
    if (!map[key] || map[key].createdAt < cutoff) {
      delete map[key];
    }
  }
  map[String(tabId)] = payload;
  await chrome.storage.local.set({ [KEYS.PENDING_RESTORES]: map });
}

export async function consumePendingRestore(tabId) {
  const data = await chrome.storage.local.get(KEYS.PENDING_RESTORES);
  const map = data[KEYS.PENDING_RESTORES] || {};
  const key = String(tabId);
  const payload = map[key] || null;
  if (payload) {
    delete map[key];
    await chrome.storage.local.set({ [KEYS.PENDING_RESTORES]: map });
  }
  return payload;
}

export async function getMissedIds() {
  const data = await chrome.storage.local.get(KEYS.MISSED_IDS);
  return Array.isArray(data[KEYS.MISSED_IDS]) ? data[KEYS.MISSED_IDS] : [];
}

export async function setMissedIds(ids) {
  const unique = [...new Set(Array.isArray(ids) ? ids : [])];
  await chrome.storage.local.set({ [KEYS.MISSED_IDS]: unique });
  return unique;
}

export async function clearMissedIds() {
  await chrome.storage.local.set({ [KEYS.MISSED_IDS]: [] });
}

export async function getCustomSound() {
  const data = await chrome.storage.local.get(KEYS.CUSTOM_SOUND);
  const val = data[KEYS.CUSTOM_SOUND];
  return val && typeof val === 'object' && val.dataUrl ? val : null;
}

export async function saveCustomSound(soundObj) {
  await chrome.storage.local.set({ [KEYS.CUSTOM_SOUND]: soundObj });
  return soundObj;
}

export async function clearCustomSound() {
  await chrome.storage.local.remove(KEYS.CUSTOM_SOUND);
}
