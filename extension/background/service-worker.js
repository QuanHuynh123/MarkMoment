import {
  PRESET_BADGE_COLORS,
  buildRestoreUrl,
  computeNextTrigger,
  computeSnoozeTimestamp,
  countActiveSchedules,
  extractDomain,
  formatContextBadge,
  isInjectableUrl,
  normalizeSoundSource,
  normalizeThemePreset,
  normalizeUrlForMatch,
} from '../shared/core.js';
import {
  clearMissedIds,
  consumePendingRestore,
  createId,
  deleteBookmark,
  getBookmarkById,
  getBookmarks,
  getCustomSound,
  getMissedIds,
  getSettings,
  saveBookmarks,
  setMissedIds,
  setPendingRestore,
  upsertBookmark,
} from '../shared/storage.js';

const ALARM_PREFIX = 'mm-reminder:';
const NOTIF_PREFIX = 'mm-notif:';
const MISSED_NOTIF_ID = 'mm-missed';
const OFFSCREEN_PATH = 'offscreen/offscreen.html';

let creatingOffscreenPromise = null;

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  if (typeof chrome.runtime.getContexts === 'function') {
    const existing = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl],
    });
    if (existing.length > 0) return;
  }

  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return;
  }

  creatingOffscreenPromise = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play a gentle notification chime when a scheduled reminder triggers.',
    })
    .catch(() => {})
    .finally(() => {
      creatingOffscreenPromise = null;
    });

  await creatingOffscreenPromise;
}

async function playNotificationSound(settings) {
  if (settings && settings.soundEnabled === false) return;
  try {
    const soundSource = normalizeSoundSource(settings && settings.soundSource);
    let customSoundDataUrl = '';
    if (soundSource === 'custom') {
      const custom = await getCustomSound();
      customSoundDataUrl = (custom && custom.dataUrl) || '';
    }
    await ensureOffscreenDocument();
    await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'PLAY_CHIME',
      soundSource,
      customSoundDataUrl,
    });
  } catch {
    // Ignore audio playback issues so visual notification still delivers cleanly
  }
}

async function sendToTabWithFallback(tabId, url, message) {
  if (!tabId || !isInjectableUrl(url)) return null;
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/content.js'],
      });
      return await chrome.tabs.sendMessage(tabId, message);
    } catch {
      return null;
    }
  }
}

async function syncAlarmForBookmark(bookmark) {
  const alarmName = `${ALARM_PREFIX}${bookmark.id}`;
  await chrome.alarms.clear(alarmName);
  if (
    bookmark.schedule &&
    bookmark.schedule.enabled &&
    !bookmark.schedule.fired &&
    typeof bookmark.schedule.nextTriggerAt === 'number' &&
    bookmark.schedule.nextTriggerAt > Date.now()
  ) {
    await chrome.alarms.create(alarmName, { when: bookmark.schedule.nextTriggerAt });
  }
}

async function updateActionBadge() {
  const [bookmarks, missedIds, settings] = await Promise.all([
    getBookmarks(),
    getMissedIds(),
    getSettings(),
  ]);
  const total = countActiveSchedules(bookmarks) + missedIds.length;
  const preset = normalizeThemePreset(settings.themePreset);
  await chrome.action.setBadgeBackgroundColor({ color: PRESET_BADGE_COLORS[preset] });
  await chrome.action.setBadgeText({ text: total > 0 ? String(total) : '' });
}

async function getActiveNormalTab() {
  try {
    const win = await chrome.windows.getLastFocused({
      populate: true,
      windowTypes: ['normal'],
    });
    if (!win || !win.tabs) return { focused: false, tab: null };
    const activeTab = win.tabs.find((t) => t.active) || null;
    return { focused: Boolean(win.focused), tab: activeTab };
  } catch {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return { focused: true, tab: tabs[0] || null };
  }
}

async function deliverReminderNotification(bookmark) {
  const settings = await getSettings();
  const { focused, tab } = await getActiveNormalTab();

  playNotificationSound(settings);

  if (focused && tab && isInjectableUrl(tab.url)) {
    const res = await sendToTabWithFallback(tab.id, tab.url, {
      type: 'SHOW_REMINDER_TOAST',
      theme: settings.theme,
      themePreset: settings.themePreset,
      dndFullscreen: settings.dndFullscreen,
      payload: {
        id: bookmark.id,
        title: bookmark.title,
        domain: bookmark.domain || extractDomain(bookmark.url),
        context: bookmark.context,
        note: bookmark.schedule?.note || '',
      },
    });
    if (res && res.ok && res.shown) {
      return;
    }
  }

  await chrome.notifications.create(`${NOTIF_PREFIX}${bookmark.id}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: bookmark.schedule?.note || 'MarkMoment — Đến giờ quay lại',
    message: `${bookmark.title} (${formatContextBadge(bookmark.context)})`,
    buttons: [{ title: 'Mở đúng mốc' }, { title: 'Nhắc +15 phút' }],
    priority: 2,
    silent: true,
  });
}

async function deliverMissedSummaryNotification(missedBookmarks) {
  if (!missedBookmarks || missedBookmarks.length === 0) return;
  const settings = await getSettings();
  const first = missedBookmarks[0];
  const { focused, tab } = await getActiveNormalTab();

  playNotificationSound(settings);

  if (focused && tab && isInjectableUrl(tab.url)) {
    const res = await sendToTabWithFallback(tab.id, tab.url, {
      type: 'SHOW_MISSED_TOAST',
      theme: settings.theme,
      themePreset: settings.themePreset,
      dndFullscreen: settings.dndFullscreen,
      payload: {
        count: missedBookmarks.length,
        firstId: first.id,
        firstTitle: first.title,
      },
    });
    if (res && res.ok && res.shown) {
      return;
    }
  }

  await chrome.notifications.create(MISSED_NOTIF_ID, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: `MarkMoment — Bạn có ${missedBookmarks.length} lịch nhắc vừa lỡ`,
    message: first.title,
    buttons: [{ title: 'Mở tab đầu' }, { title: 'Bỏ qua' }],
    priority: 1,
    silent: true,
  });
}

async function openAndRestoreBookmark(bookmarkId) {
  const bookmark = await getBookmarkById(bookmarkId);
  if (!bookmark) return { ok: false, error: 'not_found' };

  // Clear missed status on open
  const missedIds = await getMissedIds();
  if (missedIds.includes(bookmarkId)) {
    await setMissedIds(missedIds.filter((id) => id !== bookmarkId));
  }
  if (bookmark.schedule && bookmark.schedule.missed) {
    bookmark.schedule.missed = false;
    await upsertBookmark(bookmark);
  }
  await updateActionBadge();

  const restoreUrl = buildRestoreUrl(bookmark);
  const targetNorm = normalizeUrlForMatch(bookmark.url);
  const allTabs = await chrome.tabs.query({});
  const existingTab = allTabs.find((t) => t.url && normalizeUrlForMatch(t.url) === targetNorm);

  if (existingTab) {
    const settings = await getSettings();
    await chrome.windows.update(existingTab.windowId, { focused: true });
    await chrome.tabs.update(existingTab.id, { active: true });
    await sendToTabWithFallback(existingTab.id, existingTab.url, {
      type: 'RESTORE_CONTEXT',
      context: bookmark.context,
      title: bookmark.title,
      theme: settings.theme,
      themePreset: settings.themePreset,
    });
    return { ok: true, reusedTabId: existingTab.id };
  }

  const createdTab = await chrome.tabs.create({ url: restoreUrl, active: true });
  await setPendingRestore(createdTab.id, {
    context: bookmark.context,
    title: bookmark.title,
    url: restoreUrl,
    createdAt: Date.now(),
  });
  return { ok: true, createdTabId: createdTab.id };
}

async function snoozeBookmark(bookmarkId, minutes = 15) {
  const bookmark = await getBookmarkById(bookmarkId);
  if (!bookmark) return { ok: false };

  const missedIds = await getMissedIds();
  if (missedIds.includes(bookmarkId)) {
    await setMissedIds(missedIds.filter((id) => id !== bookmarkId));
  }

  const nextAt = computeSnoozeTimestamp(minutes);
  bookmark.schedule = {
    ...(bookmark.schedule || { repeat: 'none', note: '' }),
    enabled: true,
    fired: false,
    missed: false,
    nextTriggerAt: nextAt,
  };
  await upsertBookmark(bookmark);
  await syncAlarmForBookmark(bookmark);
  await updateActionBadge();
  return { ok: true, nextTriggerAt: nextAt };
}

async function reconcileAlarmsAndMissedReminders() {
  const now = Date.now();
  const bookmarks = await getBookmarks();
  const missed = [];
  let changed = false;

  for (const bm of bookmarks) {
    const sched = bm.schedule;
    if (!sched || !sched.enabled || sched.fired) continue;

    if (typeof sched.nextTriggerAt === 'number' && sched.nextTriggerAt <= now) {
      missed.push(bm);
      if (sched.repeat && sched.repeat !== 'none') {
        sched.nextTriggerAt = computeNextTrigger(sched, now);
        sched.missed = true;
      } else {
        sched.fired = true;
        sched.missed = true;
      }
      changed = true;
    }
  }

  if (changed) {
    await saveBookmarks(bookmarks);
  }

  if (missed.length > 0) {
    const prevMissed = await getMissedIds();
    await setMissedIds([...prevMissed, ...missed.map((b) => b.id)]);
  }

  for (const bm of bookmarks) {
    await syncAlarmForBookmark(bm);
  }
  await updateActionBadge();

  if (missed.length > 0) {
    await deliverMissedSummaryNotification(missed);
  }
}

async function handleQuickSaveShortcut() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.url) return;

  const settings = await getSettings();
  let captured = null;
  if (isInjectableUrl(tab.url)) {
    captured = await sendToTabWithFallback(tab.id, tab.url, { type: 'CAPTURE_CONTEXT' });
  }

  const title = (captured && captured.title) || tab.title || tab.url;
  const context = (captured && captured.context) || {
    kind: 'scroll',
    scrollY: 0,
    scrollPercent: 0,
    anchorText: '',
    anchorTag: '',
    anchorSelector: null,
  };

  const bookmark = {
    id: createId(),
    url: tab.url,
    title,
    domain: extractDomain(tab.url),
    favIconUrl: tab.favIconUrl || '',
    tag: context.kind === 'youtube' ? 'Xem sau' : 'Đọc sau',
    context,
    schedule: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await upsertBookmark(bookmark);
  await updateActionBadge();

  const badge = formatContextBadge(context);
  if (isInjectableUrl(tab.url)) {
    await sendToTabWithFallback(tab.id, tab.url, {
      type: 'SHOW_STATUS_PILL',
      theme: settings.theme,
      themePreset: settings.themePreset,
      text: `Đã lưu (Alt+S) • ${badge}`,
    });
  } else {
    await chrome.notifications.create(`mm-saved-${bookmark.id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'MarkMoment — Đã lưu tab (Alt+S)',
      message: `${title} (${badge})`,
    });
  }

  if (settings.closeTabOnSave && tab.id) {
    try {
      await chrome.tabs.remove(tab.id);
    } catch {
      // Ignore if last tab or protected
    }
  }
}

// ---------- CHROME LIFECYCLE LISTENERS ----------
chrome.runtime.onInstalled.addListener(() => {
  reconcileAlarmsAndMissedReminders();
});

chrome.runtime.onStartup.addListener(() => {
  reconcileAlarmsAndMissedReminders();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm || !alarm.name || !alarm.name.startsWith(ALARM_PREFIX)) return;
  const bookmarkId = alarm.name.slice(ALARM_PREFIX.length);
  const bookmark = await getBookmarkById(bookmarkId);
  if (!bookmark || !bookmark.schedule || !bookmark.schedule.enabled) return;

  const sched = bookmark.schedule;
  if (sched.repeat && sched.repeat !== 'none') {
    sched.nextTriggerAt = computeNextTrigger(sched, Date.now() + 1000);
    sched.fired = false;
  } else {
    sched.fired = true;
  }
  bookmark.updatedAt = Date.now();
  await upsertBookmark(bookmark);
  await syncAlarmForBookmark(bookmark);
  await updateActionBadge();
  await deliverReminderNotification(bookmark);
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'quick-save-tab') {
    handleQuickSaveShortcut();
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const pending = await consumePendingRestore(tabId);
  if (!pending || !pending.context) return;
  const settings = await getSettings();
  await sendToTabWithFallback(tabId, tab.url || pending.url, {
    type: 'RESTORE_CONTEXT',
    context: pending.context,
    title: pending.title,
    theme: settings.theme,
    themePreset: settings.themePreset,
  });
});

chrome.notifications.onClicked.addListener(async (notifId) => {
  await chrome.notifications.clear(notifId);
  if (notifId.startsWith(NOTIF_PREFIX)) {
    const id = notifId.slice(NOTIF_PREFIX.length);
    await openAndRestoreBookmark(id);
  } else if (notifId === MISSED_NOTIF_ID) {
    const missedIds = await getMissedIds();
    if (missedIds[0]) {
      await openAndRestoreBookmark(missedIds[0]);
    }
    await clearMissedIds();
    await updateActionBadge();
  }
});

chrome.notifications.onButtonClicked.addListener(async (notifId, buttonIndex) => {
  await chrome.notifications.clear(notifId);
  if (notifId.startsWith(NOTIF_PREFIX)) {
    const id = notifId.slice(NOTIF_PREFIX.length);
    if (buttonIndex === 0) {
      await openAndRestoreBookmark(id);
    } else if (buttonIndex === 1) {
      await snoozeBookmark(id, 15);
    }
  } else if (notifId === MISSED_NOTIF_ID) {
    if (buttonIndex === 0) {
      const missedIds = await getMissedIds();
      if (missedIds[0]) await openAndRestoreBookmark(missedIds[0]);
    }
    await clearMissedIds();
    await updateActionBadge();
  }
});

// ---------- POPUP & CONTENT SCRIPT RPC ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  (async () => {
    if (msg.type === 'GET_ACTIVE_TAB_CONTEXT') {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab || !tab.url) {
        sendResponse({ ok: false, injectable: false, tab: null, context: null });
        return;
      }
      const injectable = isInjectableUrl(tab.url);
      let captured = null;
      if (injectable) {
        captured = await sendToTabWithFallback(tab.id, tab.url, { type: 'CAPTURE_CONTEXT' });
      }
      sendResponse({
        ok: true,
        injectable,
        tab: {
          id: tab.id,
          url: tab.url,
          title: (captured && captured.title) || tab.title || tab.url,
          domain: extractDomain(tab.url),
          favIconUrl: tab.favIconUrl || '',
        },
        context: (captured && captured.context) || {
          kind: 'scroll',
          scrollY: 0,
          scrollPercent: 0,
          anchorText: '',
          anchorTag: '',
          anchorSelector: null,
        },
      });
      return;
    }

    if (msg.type === 'SAVE_BOOKMARK') {
      const bookmark = msg.bookmark;
      if (!bookmark.id) bookmark.id = createId();
      bookmark.createdAt = bookmark.createdAt || Date.now();
      bookmark.updatedAt = Date.now();

      await upsertBookmark(bookmark);
      await syncAlarmForBookmark(bookmark);
      await updateActionBadge();

      if (msg.closeTab && msg.tabId) {
        try {
          await chrome.tabs.remove(msg.tabId);
        } catch {
          // Ignore protected tab close error
        }
      }
      sendResponse({ ok: true, bookmark });
      return;
    }

    if (msg.type === 'UPDATE_BOOKMARK_SCHEDULE') {
      const existing = await getBookmarkById(msg.id);
      if (!existing) {
        sendResponse({ ok: false });
        return;
      }
      existing.schedule = msg.schedule || null;
      existing.updatedAt = Date.now();
      await upsertBookmark(existing);
      await syncAlarmForBookmark(existing);
      await updateActionBadge();
      sendResponse({ ok: true, bookmark: existing });
      return;
    }

    if (msg.type === 'DELETE_BOOKMARK') {
      await chrome.alarms.clear(`${ALARM_PREFIX}${msg.id}`);
      const missedIds = await getMissedIds();
      if (missedIds.includes(msg.id)) {
        await setMissedIds(missedIds.filter((id) => id !== msg.id));
      }
      await deleteBookmark(msg.id);
      await updateActionBadge();
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'RESTORE_DELETED_BOOKMARK') {
      const bm = msg.bookmark;
      if (bm) {
        await upsertBookmark(bm);
        await syncAlarmForBookmark(bm);
        await updateActionBadge();
      }
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'OPEN_BOOKMARK') {
      const result = await openAndRestoreBookmark(msg.id);
      sendResponse(result);
      return;
    }

    if (msg.type === 'SNOOZE_BOOKMARK') {
      const result = await snoozeBookmark(msg.id, msg.minutes || 15);
      sendResponse(result);
      return;
    }

    if (msg.type === 'DISMISS_MISSED') {
      await clearMissedIds();
      const bookmarks = await getBookmarks();
      let changed = false;
      for (const bm of bookmarks) {
        if (bm.schedule && bm.schedule.missed) {
          bm.schedule.missed = false;
          changed = true;
        }
      }
      if (changed) await saveBookmarks(bookmarks);
      await updateActionBadge();
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'CHECK_PENDING_RESTORE') {
      const tabId = sender.tab && sender.tab.id;
      if (!tabId) {
        sendResponse({ pending: null });
        return;
      }
      const [pending, settings] = await Promise.all([
        consumePendingRestore(tabId),
        getSettings(),
      ]);
      sendResponse({
        pending,
        theme: settings.theme,
        themePreset: settings.themePreset,
      });
      return;
    }

    if (msg.type === 'SETTINGS_UPDATED') {
      await updateActionBadge();
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: 'unknown_message' });
  })();

  return true;
});
