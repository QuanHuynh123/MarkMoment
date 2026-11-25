import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRESET_BADGE_COLORS,
  THEME_PRESETS,
  buildRestoreUrl,
  computeNextTrigger,
  computePresetTimestamp,
  computeScrollPercent,
  computeSnoozeTimestamp,
  computeTargetScrollY,
  countActiveSchedules,
  extractDomain,
  filterBookmarks,
  formatContextBadge,
  formatScheduleBadge,
  formatTime,
  isInjectableUrl,
  isSafeFaviconUrl,
  normalizeThemeMode,
  normalizeThemePreset,
  normalizeUrlForMatch,
  parseYouTubeUrl,
} from '../extension/shared/core.js';

test('formatTime formats seconds into MM:SS and H:MM:SS', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(65), '01:05');
  assert.equal(formatTime(868), '14:28');
  assert.equal(formatTime(3661), '1:01:01');
  assert.equal(formatTime(-10), '00:00');
});

test('extractDomain strips www prefix cleanly', () => {
  assert.equal(extractDomain('https://www.youtube.com/watch?v=abc'), 'youtube.com');
  assert.equal(extractDomain('https://uxdesign.cc/article'), 'uxdesign.cc');
  assert.equal(extractDomain('not-a-url'), '');
});

test('isInjectableUrl allows http/https and rejects Chrome system or store URLs', () => {
  assert.equal(isInjectableUrl('https://www.youtube.com/watch?v=123'), true);
  assert.equal(isInjectableUrl('http://localhost:3000/docs'), true);
  assert.equal(isInjectableUrl('chrome://newtab'), false);
  assert.equal(isInjectableUrl('chrome://extensions'), false);
  assert.equal(isInjectableUrl('chrome-extension://abcdef/popup.html'), false);
  assert.equal(isInjectableUrl('https://chromewebstore.google.com/detail/xyz'), false);
  assert.equal(isInjectableUrl('https://chrome.google.com/webstore/category/extensions'), false);
});

test('parseYouTubeUrl and normalizeUrlForMatch handle watch, youtu.be, shorts, and playlists', () => {
  assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/watch?v=eng12&t=868s'), {
    videoId: 'eng12',
    isShorts: false,
  });
  assert.deepEqual(parseYouTubeUrl('https://youtu.be/eng12?t=45'), {
    videoId: 'eng12',
    isShorts: false,
  });
  assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/shorts/short99'), {
    videoId: 'short99',
    isShorts: true,
  });
  assert.equal(parseYouTubeUrl('https://vimeo.com/12345'), null);

  assert.equal(
    normalizeUrlForMatch('https://youtu.be/eng12?t=120'),
    normalizeUrlForMatch('https://www.youtube.com/watch?v=eng12&t=868s')
  );
  assert.equal(
    normalizeUrlForMatch('https://www.youtube.com/watch?v=eng12&list=PL1&t=50s'),
    'https://www.youtube.com/watch?v=eng12&list=PL1'
  );
  assert.equal(
    normalizeUrlForMatch('https://example.com/blog#'),
    'https://example.com/blog'
  );
});

test('buildRestoreUrl attaches exact YouTube t param and PDF page hash', () => {
  const ytUrl = buildRestoreUrl({
    url: 'https://www.youtube.com/watch?v=eng12&list=PL1',
    context: { kind: 'youtube', seconds: 868 },
  });
  assert.equal(ytUrl, 'https://www.youtube.com/watch?v=eng12&list=PL1&t=868s');

  const pdfUrl = buildRestoreUrl({
    url: 'https://example.com/book.pdf',
    context: { kind: 'pdf', page: 12 },
  });
  assert.equal(pdfUrl, 'https://example.com/book.pdf#page=12');

  const blogUrl = buildRestoreUrl({
    url: 'https://uxdesign.cc/post',
    context: { kind: 'scroll', scrollPercent: 64 },
  });
  assert.equal(blogUrl, 'https://uxdesign.cc/post');
});

test('formatContextBadge returns clean single-line status text', () => {
  assert.equal(formatContextBadge({ kind: 'youtube', seconds: 868 }), '14:28');
  assert.equal(formatContextBadge({ kind: 'video', seconds: 125 }), '02:05');
  assert.equal(formatContextBadge({ kind: 'scroll', scrollPercent: 64 }), 'Đọc dở 64%');
  assert.equal(formatContextBadge({ kind: 'scroll', scrollPercent: 0 }), 'Đầu trang');
  assert.equal(formatContextBadge({ kind: 'pdf', page: 7 }), 'Trang 7');
});

test('computePresetTimestamp and computeSnoozeTimestamp calculate relative times', () => {
  const base = new Date(2026, 10, 25, 18, 0, 0, 0).getTime(); // 2026-11-25 18:00
  assert.equal(computePresetTimestamp('+15m', base), base + 15 * 60_000);
  assert.equal(computePresetTimestamp('+30m', base), base + 30 * 60_000);
  assert.equal(computePresetTimestamp('+1h', base), base + 60 * 60_000);

  const tonight = new Date(computePresetTimestamp('tonight', base));
  assert.equal(tonight.getDate(), 25);
  assert.equal(tonight.getHours(), 20);

  const lateBase = new Date(2026, 10, 25, 21, 0, 0, 0).getTime();
  const nextNight = new Date(computePresetTimestamp('tonight', lateBase));
  assert.equal(nextNight.getDate(), 26);
  assert.equal(nextNight.getHours(), 20);

  const tomorrowMorning = new Date(computePresetTimestamp('tomorrow', base));
  assert.equal(tomorrowMorning.getDate(), 26);
  assert.equal(tomorrowMorning.getHours(), 9);

  assert.equal(computeSnoozeTimestamp(15, base), base + 15 * 60_000);
});

test('computeNextTrigger handles one-time, daily, weekdays, and custom days', () => {
  // 2026-11-27 is Friday (day=5) at 21:00
  const fridayNight = new Date(2026, 10, 27, 21, 0, 0, 0).getTime();

  // One-time future
  const once = computeNextTrigger(
    { enabled: true, repeat: 'none', date: '2026-11-28', time: '09:30' },
    fridayNight
  );
  assert.equal(new Date(once).getDate(), 28);
  assert.equal(new Date(once).getHours(), 9);

  // One-time already fired -> null
  assert.equal(
    computeNextTrigger(
      { enabled: true, repeat: 'none', date: '2026-11-28', time: '09:30', fired: true },
      fridayNight
    ),
    null
  );

  // Daily rolls to Saturday 20:00
  const daily = computeNextTrigger({ enabled: true, repeat: 'daily', time: '20:00' }, fridayNight);
  assert.equal(new Date(daily).getDate(), 28);
  assert.equal(new Date(daily).getHours(), 20);

  // Weekdays skips Saturday (28) & Sunday (29), picks Monday Nov 30 at 08:00
  const weekday = computeNextTrigger(
    { enabled: true, repeat: 'weekdays', time: '08:00' },
    fridayNight
  );
  assert.equal(new Date(weekday).getDate(), 30);
  assert.equal(new Date(weekday).getDay(), 1);

  // Custom [1, 3, 5] (Mon, Wed, Fri) from Friday 21:00 -> Monday Nov 30
  const custom = computeNextTrigger(
    { enabled: true, repeat: 'custom', days: [1, 3, 5], time: '20:30' },
    fridayNight
  );
  assert.equal(new Date(custom).getDate(), 30);
  assert.equal(new Date(custom).getDay(), 1);
});

test('formatScheduleBadge formats Vietnamese schedule labels', () => {
  const now = new Date(2026, 10, 25, 10, 0, 0, 0).getTime();
  const todayEvening = new Date(2026, 10, 25, 20, 30, 0, 0).getTime();
  const tomorrowMorning = new Date(2026, 10, 26, 9, 0, 0, 0).getTime();

  assert.equal(
    formatScheduleBadge({ enabled: true, repeat: 'none', nextTriggerAt: todayEvening }, now),
    'Hôm nay 20:30'
  );
  assert.equal(
    formatScheduleBadge({ enabled: true, repeat: 'none', nextTriggerAt: tomorrowMorning }, now),
    'Ngày mai 09:00'
  );
  assert.equal(
    formatScheduleBadge({ enabled: true, repeat: 'daily', time: '21:00' }, now),
    'Hằng ngày 21:00'
  );
  assert.equal(
    formatScheduleBadge({ enabled: true, repeat: 'weekdays', time: '20:00' }, now),
    'T2–T6 20:00'
  );
  assert.equal(
    formatScheduleBadge({ enabled: true, repeat: 'custom', days: [5, 1, 3], time: '21:00' }, now),
    'T2, T4, T6 21:00'
  );
});

test('filterBookmarks and countActiveSchedules filter accurately', () => {
  const items = [
    {
      id: '1',
      title: 'BBC English Ep 12',
      domain: 'youtube.com',
      tag: 'Tiếng Anh',
      schedule: { enabled: true, fired: false, nextTriggerAt: 9999999999999, note: 'Ôn nghe' },
    },
    {
      id: '2',
      title: 'UX Micro-interactions',
      domain: 'uxdesign.cc',
      tag: 'Đọc sau',
      schedule: null,
    },
    {
      id: '3',
      title: 'Already fired reminder',
      domain: 'example.com',
      tag: 'Học tập',
      schedule: { enabled: true, fired: true, nextTriggerAt: 1000, note: '' },
    },
  ];

  assert.equal(countActiveSchedules(items), 1);
  assert.equal(filterBookmarks(items, { tab: 'saved' }).length, 3);
  assert.equal(filterBookmarks(items, { tab: 'scheduled' }).length, 1);
  assert.equal(filterBookmarks(items, { tag: 'Đọc sau' }).length, 1);
  assert.equal(filterBookmarks(items, { query: 'ôn nghe' }).length, 1);
});

test('normalizeThemeMode, normalizeThemePreset, and PRESET_BADGE_COLORS cover all presets', () => {
  assert.deepEqual(THEME_PRESETS, ['indigo', 'paper', 'sage', 'rose', 'mono']);
  for (const preset of THEME_PRESETS) {
    assert.equal(normalizeThemePreset(preset), preset);
    assert.match(PRESET_BADGE_COLORS[preset], /^#[0-9A-Fa-f]{6}$/);
  }
  assert.equal(normalizeThemePreset('unknown'), 'indigo');
  assert.equal(normalizeThemePreset(null), 'indigo');

  assert.equal(normalizeThemeMode('auto'), 'auto');
  assert.equal(normalizeThemeMode('light'), 'light');
  assert.equal(normalizeThemeMode('dark'), 'dark');
  assert.equal(normalizeThemeMode('sepia'), 'auto');
});

test('computeScrollPercent, computeTargetScrollY, and isSafeFaviconUrl handle lazy-load & favicons', () => {
  assert.equal(computeScrollPercent(0, 2000, 800), 0);
  assert.equal(computeScrollPercent(1196, 2000, 800), 100);
  assert.equal(computeScrollPercent(600, 2000, 800), 50);

  // Anchor present -> aligns element to saved anchorViewportTop
  assert.equal(
    computeTargetScrollY({
      anchorAbsTop: 2400,
      anchorViewportTop: 180,
      scrollHeight: 6000,
      innerHeight: 800,
    }),
    2220
  );

  // Lazy-image height expansion with atBottom -> jumps to new bottom
  assert.equal(
    computeTargetScrollY({
      scrollPercent: 100,
      scrollHeight: 9000,
      innerHeight: 800,
      atBottom: true,
    }),
    8200
  );

  // Fallback by scrollPercent when anchor missing
  assert.equal(
    computeTargetScrollY({
      scrollPercent: 50,
      scrollY: 600,
      scrollHeight: 4800,
      innerHeight: 800,
    }),
    2000
  );

  assert.equal(isSafeFaviconUrl('https://vinpearl.com/favicon.ico'), true);
  assert.equal(isSafeFaviconUrl('data:image/png;base64,AAA'), true);
  assert.equal(isSafeFaviconUrl('javascript:alert(1)'), false);
  assert.equal(isSafeFaviconUrl(''), false);
});
