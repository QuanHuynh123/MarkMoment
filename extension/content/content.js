(function () {
  if (window.__MARKMOMENT_LOADED__) return;
  window.__MARKMOMENT_LOADED__ = true;

  const HOST_ID = 'markmoment-shadow-host';
  const TOAST_DURATION_MS = 5000;
  const PILL_DURATION_MS = 2800;

  // ---------- SMALL PURE HELPERS (classic content script cannot use ES imports) ----------
  function formatTime(totalSeconds) {
    const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function formatContextBadge(context) {
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

  function normalizeText(str) {
    return (str || '').replace(/\s+/g, ' ').trim();
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function parseYouTubeId(url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      if (host === 'youtu.be') {
        return parsed.pathname.replace(/^\/+/, '').split('/')[0] || '';
      }
      if (host === 'youtube.com' || host === 'm.youtube.com') {
        if (parsed.pathname === '/watch') {
          return parsed.searchParams.get('v') || '';
        }
        if (parsed.pathname.startsWith('/shorts/')) {
          return parsed.pathname.slice('/shorts/'.length).split('/')[0] || '';
        }
      }
      return '';
    } catch {
      return '';
    }
  }

  // ---------- 1. CONTEXT CAPTURE ----------
  function captureCurrentContext() {
    const url = window.location.href;
    const host = window.location.hostname.toLowerCase().replace(/^www\./, '');
    const isYouTube =
      host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be';

    if (isYouTube) {
      const ytId = parseYouTubeId(url);
      const video =
        document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (ytId || video) {
        const seconds = video ? Math.floor(video.currentTime || 0) : 0;
        const duration = video && Number.isFinite(video.duration) ? Math.floor(video.duration) : 0;
        const ytTitleEl =
          document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
          document.querySelector('#title h1 yt-formatted-string');
        const cleanTitle = normalizeText(
          (ytTitleEl && ytTitleEl.textContent) || document.title.replace(/ - YouTube$/i, '')
        );
        return {
          title: cleanTitle || document.title,
          url,
          context: {
            kind: 'youtube',
            videoId: ytId,
            seconds,
            duration,
          },
        };
      }
    }

    // Generic HTML5 video (e.g., Vimeo, learning portals)
    const videos = Array.from(document.querySelectorAll('video'));
    const activeVideo = videos.find(
      (v) => Number.isFinite(v.duration) && v.duration >= 30 && v.currentTime > 0
    );
    if (activeVideo) {
      return {
        title: document.title,
        url,
        context: {
          kind: 'video',
          seconds: Math.floor(activeVideo.currentTime || 0),
          duration: Math.floor(activeVideo.duration || 0),
        },
      };
    }

    // PDF viewer page hash
    if (/\.pdf($|[?#])/i.test(url)) {
      const pageMatch = /#page=(\d+)/i.exec(window.location.hash || '');
      return {
        title: document.title,
        url,
        context: {
          kind: 'pdf',
          page: pageMatch ? Number(pageMatch[1]) : 1,
        },
      };
    }

    // Blog / Web Scroll + Text Anchor
    function getDocumentHeight() {
      const docEl = document.documentElement;
      const body = document.body;
      return Math.max(
        docEl ? docEl.scrollHeight : 0,
        body ? body.scrollHeight : 0
      );
    }

    function isReadableNode(el) {
      if (!el || el.closest(`#${HOST_ID}`)) return false;
      if (el.closest('header, nav, footer, aside, [role="navigation"], [role="banner"], [aria-hidden="true"]')) {
        return false;
      }
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        return false;
      }
      return true;
    }

    const docHeight = getDocumentHeight();
    const scrollY = Math.max(0, Math.round(window.scrollY || window.pageYOffset || 0));
    const maxScroll = Math.max(0, docHeight - window.innerHeight);
    const scrollPercent =
      maxScroll <= 0
        ? 0
        : scrollY >= maxScroll - 8
          ? 100
          : Math.min(100, Math.max(0, Math.round((scrollY / maxScroll) * 100)));
    const atBottom = maxScroll > 0 && scrollY >= maxScroll - 24;

    const targetY = window.innerHeight * 0.25;
    const READABLE_SELECTOR =
      'article p, article h1, article h2, article h3, main p, main h1, main h2, main h3, p, h1, h2, h3, blockquote, figcaption, li';
    const candidates = document.querySelectorAll(READABLE_SELECTOR);

    let bestEl = null;
    let bestScore = Infinity;
    let bestRectTop = 0;

    for (let i = 0; i < candidates.length; i += 1) {
      const el = candidates[i];
      if (!isReadableNode(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.top < 0 || rect.top > window.innerHeight * 0.8) continue;
      const text = normalizeText(el.textContent);
      if (text.length < 20) continue;
      const dist = Math.abs(rect.top - targetY);
      if (dist < bestScore) {
        bestScore = dist;
        bestEl = el;
        bestRectTop = rect.top;
      }
    }

    let anchorText = '';
    let anchorTag = '';
    let anchorSelector = null;
    let anchorViewportTop = null;
    let anchorOccurrence = 0;

    if (bestEl) {
      anchorText = normalizeText(bestEl.textContent).slice(0, 140);
      anchorTag = bestEl.tagName.toLowerCase();
      anchorViewportTop = Math.round(Math.max(0, Math.min(bestRectTop, window.innerHeight * 0.75)));
      if (bestEl.id && /^[A-Za-z][A-Za-z0-9_-]*$/.test(bestEl.id)) {
        anchorSelector = `#${bestEl.id}`;
      }
      const snippet = anchorText.slice(0, 60).toLowerCase();
      if (snippet.length >= 16) {
        const sameTagNodes = document.querySelectorAll(anchorTag);
        for (let i = 0; i < sameTagNodes.length; i += 1) {
          const node = sameTagNodes[i];
          if (node === bestEl) break;
          if (!isReadableNode(node)) continue;
          if (normalizeText(node.textContent).toLowerCase().includes(snippet)) {
            anchorOccurrence += 1;
          }
        }
      }
    }

    return {
      title: document.title,
      url,
      context: {
        kind: 'scroll',
        scrollY,
        scrollPercent,
        anchorText,
        anchorTag,
        anchorSelector,
        anchorViewportTop,
        anchorOccurrence,
        atBottom,
        docHeightAtSave: docHeight,
      },
    };
  }

  // ---------- 2. CONTEXT RESTORATION ----------
  function getDocumentHeightGlobal() {
    const docEl = document.documentElement;
    const body = document.body;
    return Math.max(
      docEl ? docEl.scrollHeight : 0,
      body ? body.scrollHeight : 0
    );
  }

  function isReadableNodeGlobal(el) {
    if (!el || el.closest(`#${HOST_ID}`)) return false;
    if (el.closest('header, nav, footer, aside, [role="navigation"], [role="banner"], [aria-hidden="true"]')) {
      return false;
    }
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
    return true;
  }

  function flashHighlightElement(el) {
    if (!el) return;
    const prevBg = el.style.backgroundColor;
    const prevTransition = el.style.transition;
    const prevRadius = el.style.borderRadius;
    const prevOutline = el.style.outline;

    if (!prefersReducedMotion()) {
      el.style.transition = 'background-color 350ms ease, outline-color 350ms ease';
    }
    el.style.backgroundColor = 'rgba(79, 70, 229, 0.16)';
    el.style.outline = '4px solid rgba(79, 70, 229, 0.14)';
    el.style.borderRadius = '6px';

    setTimeout(() => {
      el.style.backgroundColor = prevBg;
      el.style.outline = prevOutline;
      setTimeout(() => {
        el.style.transition = prevTransition;
        el.style.borderRadius = prevRadius;
      }, 360);
    }, 2200);
  }

  function findScrollAnchorElement(context) {
    if (context.anchorSelector) {
      try {
        const byId = document.querySelector(context.anchorSelector);
        if (byId && isReadableNodeGlobal(byId)) return byId;
      } catch {
        // Ignore invalid selector
      }
    }
    if (context.anchorText && context.anchorText.length >= 16) {
      const snippet = context.anchorText.slice(0, 60).toLowerCase();
      const selector = context.anchorTag || 'p,h1,h2,h3,blockquote,figcaption,li';
      const nodes = document.querySelectorAll(selector);
      const matches = [];
      for (let i = 0; i < nodes.length; i += 1) {
        const el = nodes[i];
        if (!isReadableNodeGlobal(el)) continue;
        if (normalizeText(el.textContent).toLowerCase().includes(snippet)) {
          matches.push(el);
        }
      }
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) {
        if (
          Number.isInteger(context.anchorOccurrence) &&
          context.anchorOccurrence >= 0 &&
          matches[context.anchorOccurrence]
        ) {
          return matches[context.anchorOccurrence];
        }
        const docHeight = Math.max(1, getDocumentHeightGlobal());
        const targetRatio = Number(context.scrollPercent || 0) / 100;
        let closest = matches[0];
        let minDiff = Infinity;
        for (let i = 0; i < matches.length; i += 1) {
          const absTop = matches[i].getBoundingClientRect().top + window.scrollY;
          const diff = Math.abs(absTop / docHeight - targetRatio);
          if (diff < minDiff) {
            minDiff = diff;
            closest = matches[i];
          }
        }
        return closest;
      }
    }
    return null;
  }

  function restoreContext(context) {
    if (!context || typeof context !== 'object') return;
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';

    if (context.kind === 'youtube' || context.kind === 'video') {
      const targetSec = Number(context.seconds || 0);
      if (targetSec <= 0) {
        showStatusPill('Đã mở lại trang đã lưu');
        return;
      }
      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        const video =
          document.querySelector('video.html5-main-video') || document.querySelector('video');
        if (video && video.readyState >= 1) {
          clearInterval(timer);
          if (Math.abs((video.currentTime || 0) - targetSec) > 2) {
            video.currentTime = targetSec;
          }
          showStatusPill(`Đã quay lại mốc ${formatTime(targetSec)}`);
          return;
        }
        if (attempts >= 24) {
          clearInterval(timer);
          showStatusPill(`Đã mở video tại mốc ${formatTime(targetSec)}`);
        }
      }, 250);
      return;
    }

    if (context.kind === 'scroll') {
      let userScrolled = false;
      let cleanedUp = false;
      let lastDocHeight = 0;
      let lastTargetY = 0;
      let imgDebounce = null;
      const timers = [];

      const SCROLL_KEYS = new Set([
        'ArrowDown',
        'ArrowUp',
        'PageDown',
        'PageUp',
        'Space',
        ' ',
        'Home',
        'End',
      ]);

      const onUserKey = (e) => {
        if (SCROLL_KEYS.has(e.key)) cancelAutoSync();
      };

      function cancelAutoSync() {
        userScrolled = true;
        cleanupListeners();
      }

      function onImageLoad(e) {
        if (userScrolled || cleanedUp) return;
        if (!e.target || e.target.tagName !== 'IMG') return;
        clearTimeout(imgDebounce);
        imgDebounce = setTimeout(() => {
          if (userScrolled || cleanedUp) return;
          realignIfShifted();
        }, 160);
      }

      function cleanupListeners() {
        if (cleanedUp) return;
        cleanedUp = true;
        window.removeEventListener('wheel', cancelAutoSync);
        window.removeEventListener('touchstart', cancelAutoSync);
        window.removeEventListener('pointerdown', cancelAutoSync);
        window.removeEventListener('keydown', onUserKey);
        document.removeEventListener('load', onImageLoad, true);
        clearTimeout(imgDebounce);
        timers.forEach((t) => clearTimeout(t));
      }

      window.addEventListener('wheel', cancelAutoSync, { passive: true });
      window.addEventListener('touchstart', cancelAutoSync, { passive: true });
      window.addEventListener('pointerdown', cancelAutoSync, { passive: true });
      window.addEventListener('keydown', onUserKey);
      document.addEventListener('load', onImageLoad, true);

      function applyScroll(isFirstJump) {
        const docHeight = getDocumentHeightGlobal();
        const maxScroll = Math.max(0, docHeight - window.innerHeight);
        const anchorEl = findScrollAnchorElement(context);
        let nextY = 0;

        if (anchorEl) {
          const elAbsTop = anchorEl.getBoundingClientRect().top + window.scrollY;
          const offset = Number.isFinite(context.anchorViewportTop)
            ? Math.min(Math.max(0, context.anchorViewportTop), window.innerHeight * 0.75)
            : Math.round(window.innerHeight * 0.25);
          nextY = Math.max(0, Math.round(elAbsTop - offset));
          if (isFirstJump) flashHighlightElement(anchorEl);
        } else if (context.atBottom) {
          nextY = maxScroll;
        } else {
          const pct = Number(context.scrollPercent || 0);
          nextY =
            pct > 0 && maxScroll > 0
              ? Math.round((maxScroll * Math.min(100, pct)) / 100)
              : Math.max(0, Math.round(context.scrollY || 0));
        }

        window.scrollTo({
          top: nextY,
          behavior: isFirstJump ? behavior : 'auto',
        });
        lastDocHeight = docHeight;
        lastTargetY = nextY;
      }

      function realignIfShifted() {
        if (userScrolled) return;
        const docHeight = getDocumentHeightGlobal();
        const currentY = Math.round(window.scrollY || window.pageYOffset || 0);
        if (
          Math.abs(docHeight - lastDocHeight) > 60 ||
          Math.abs(currentY - lastTargetY) > 60
        ) {
          applyScroll(false);
        }
      }

      timers.push(
        setTimeout(() => {
          if (userScrolled) return;
          applyScroll(true);
          const pct = Number(context.scrollPercent || 0);
          const msg = context.atBottom || pct >= 100
            ? 'Đã quay lại cuối trang'
            : pct > 0
              ? `Đã quay lại đoạn đọc dở (${Math.round(pct)}%)`
              : 'Đã mở đầu trang';
          showStatusPill(msg);
        }, 180)
      );

      timers.push(setTimeout(realignIfShifted, 600));
      timers.push(setTimeout(realignIfShifted, 1250));
      timers.push(setTimeout(realignIfShifted, 2100));
      timers.push(setTimeout(cleanupListeners, 2700));
      return;
    }

    if (context.kind === 'pdf') {
      showStatusPill(`Đã mở PDF tại trang ${Math.floor(Number(context.page || 1))}`);
      return;
    }

    showStatusPill('Đã mở lại tab đã lưu');
  }

  // ---------- 3. SHADOW DOM TOP-RIGHT UI (ZERO EMOJIS, 100% LUCIDE SVG) ----------
  const SVG = {
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    chevronLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  };

  let shadowRoot = null;
  let toastContainer = null;
  let pillContainer = null;
  let currentThemeSetting = 'auto';
  let currentThemePreset = 'indigo';

  const toastQueue = [];
  let toastIndex = 0;
  let toastRAF = null;
  let toastRemaining = TOAST_DURATION_MS;
  let toastLastTick = 0;
  let toastPaused = false;
  let pillTimer = null;

  function resolveIsDark(themeSetting) {
    if (themeSetting === 'dark') return true;
    if (themeSetting === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function normalizePreset(preset) {
    return ['indigo', 'paper', 'sage', 'rose', 'mono'].includes(preset) ? preset : 'indigo';
  }

  function ensureShadowHost(themeSetting, themePreset) {
    if (themeSetting) currentThemeSetting = themeSetting;
    if (themePreset) currentThemePreset = normalizePreset(themePreset);
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      host.style.cssText =
        'position:fixed;top:0;right:0;left:0;z-index:2147483647;pointer-events:none;font-size:16px;';
      (document.body || document.documentElement).appendChild(host);
      shadowRoot = host.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent = `
        :host {
          all: initial;
          font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        * { box-sizing: border-box; }
        .mm-root {
          --mm-surface: #ffffff;
          --mm-subtle: #f4f5f8;
          --mm-border: rgba(15, 23, 42, 0.14);
          --mm-text: #0f172a;
          --mm-secondary: #334155;
          --mm-muted: #526071;
          --mm-accent: #4f46e5;
          --mm-accent-hover: #4338ca;
          --mm-on-accent: #ffffff;
          --mm-yt-bg: #fef2f2;
          --mm-yt-text: #b91c1c;
          --mm-blog-bg: #ecfdf5;
          --mm-blog-text: #047857;
          --mm-shadow: 0 16px 38px -10px rgba(15, 23, 42, 0.22), 0 4px 12px rgba(15, 23, 42, 0.08);
          color: var(--mm-text);
        }
        .mm-root.mm-dark {
          --mm-surface: #181a21;
          --mm-subtle: #20232c;
          --mm-border: rgba(255, 255, 255, 0.14);
          --mm-text: #f8fafc;
          --mm-secondary: #cbd5e1;
          --mm-muted: #94a3b8;
          --mm-accent: #6366f1;
          --mm-accent-hover: #818cf8;
          --mm-on-accent: #ffffff;
          --mm-yt-bg: rgba(239, 68, 68, 0.18);
          --mm-yt-text: #fca5a5;
          --mm-blog-bg: rgba(16, 185, 129, 0.18);
          --mm-blog-text: #6ee7b7;
          --mm-shadow: 0 20px 48px -10px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.08);
        }
        .mm-root[data-preset="paper"] {
          --mm-surface: #faf7f2;
          --mm-subtle: #f2ece2;
          --mm-border: rgba(68, 48, 28, 0.15);
          --mm-text: #261c14;
          --mm-secondary: #4e3d2f;
          --mm-muted: #6c5846;
          --mm-accent: #b45309;
          --mm-accent-hover: #92400e;
          --mm-on-accent: #ffffff;
        }
        .mm-root.mm-dark[data-preset="paper"] {
          --mm-surface: #1c1815;
          --mm-subtle: #25201c;
          --mm-border: rgba(245, 232, 215, 0.14);
          --mm-text: #f7f1e8;
          --mm-secondary: #d7cab9;
          --mm-muted: #a69582;
          --mm-accent: #f59e0b;
          --mm-accent-hover: #fbbf24;
          --mm-on-accent: #1c1815;
        }
        .mm-root[data-preset="sage"] {
          --mm-surface: #f7fbf9;
          --mm-subtle: #ecf5f1;
          --mm-border: rgba(15, 62, 52, 0.14);
          --mm-text: #0f2922;
          --mm-secondary: #284c43;
          --mm-muted: #476860;
          --mm-accent: #0f766e;
          --mm-accent-hover: #115e59;
          --mm-on-accent: #ffffff;
        }
        .mm-root.mm-dark[data-preset="sage"] {
          --mm-surface: #131c1a;
          --mm-subtle: #1a2623;
          --mm-border: rgba(204, 251, 241, 0.14);
          --mm-text: #f0fdf9;
          --mm-secondary: #c2ddd5;
          --mm-muted: #8fb1a7;
          --mm-accent: #2dd4bf;
          --mm-accent-hover: #5eead4;
          --mm-on-accent: #09221e;
        }
        .mm-root[data-preset="rose"] {
          --mm-surface: #fffafb;
          --mm-subtle: #f9eff2;
          --mm-border: rgba(94, 25, 53, 0.14);
          --mm-text: #29131c;
          --mm-secondary: #543140;
          --mm-muted: #724d5d;
          --mm-accent: #be185d;
          --mm-accent-hover: #9d174d;
          --mm-on-accent: #ffffff;
        }
        .mm-root.mm-dark[data-preset="rose"] {
          --mm-surface: #1e151a;
          --mm-subtle: #281c22;
          --mm-border: rgba(252, 231, 243, 0.14);
          --mm-text: #fdf2f8;
          --mm-secondary: #e2c5d3;
          --mm-muted: #b592a3;
          --mm-accent: #f472b6;
          --mm-accent-hover: #f9a8d4;
          --mm-on-accent: #250c17;
        }
        .mm-root[data-preset="mono"] {
          --mm-surface: #ffffff;
          --mm-subtle: #f4f4f5;
          --mm-border: rgba(24, 24, 27, 0.16);
          --mm-text: #09090b;
          --mm-secondary: #3f3f46;
          --mm-muted: #52525b;
          --mm-accent: #18181b;
          --mm-accent-hover: #27272a;
          --mm-on-accent: #ffffff;
        }
        .mm-root.mm-dark[data-preset="mono"] {
          --mm-surface: #111113;
          --mm-subtle: #1a1a1e;
          --mm-border: rgba(255, 255, 255, 0.16);
          --mm-text: #fafafa;
          --mm-secondary: #d4d4d8;
          --mm-muted: #a1a1aa;
          --mm-accent: #f4f4f5;
          --mm-accent-hover: #ffffff;
          --mm-on-accent: #09090b;
        }
        .mm-toast-wrap {
          position: fixed;
          top: 16px;
          right: 16px;
          width: 324px;
          pointer-events: auto;
        }
        .mm-toast {
          background: var(--mm-surface);
          color: var(--mm-text);
          border: 1px solid var(--mm-border);
          border-radius: 16px;
          box-shadow: var(--mm-shadow);
          overflow: hidden;
          animation: mmSlideIn 220ms cubic-bezier(0.2, 0.9, 0.25, 1);
        }
        .mm-toast-body { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
        .mm-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .mm-label {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 12px; font-weight: 600; color: var(--mm-accent);
          min-width: 0;
        }
        .mm-label svg { width: 14px; height: 14px; flex-shrink: 0; }
        .mm-label span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mm-head-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
        .mm-pager {
          display: inline-flex; align-items: center; gap: 2px;
          font-size: 11px; color: var(--mm-muted);
          background: var(--mm-subtle); border-radius: 8px; padding: 2px 4px;
        }
        .mm-icon-btn {
          width: 24px; height: 24px; border-radius: 8px; border: none;
          background: var(--mm-subtle); color: var(--mm-muted);
          display: inline-flex; align-items: center; justify-content: center;
          cursor: pointer; padding: 0;
        }
        .mm-icon-btn:hover { color: var(--mm-text); }
        .mm-icon-btn svg { width: 14px; height: 14px; }
        .mm-pager .mm-icon-btn { width: 18px; height: 18px; background: transparent; }
        .mm-pager .mm-icon-btn svg { width: 12px; height: 12px; }
        .mm-row { display: flex; align-items: flex-start; gap: 10px; }
        .mm-thumb {
          width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
        }
        .mm-thumb svg { width: 16px; height: 16px; }
        .mm-thumb.yt { background: var(--mm-yt-bg); color: var(--mm-yt-text); }
        .mm-thumb.doc { background: var(--mm-blog-bg); color: var(--mm-blog-text); }
        .mm-info { min-width: 0; flex: 1; }
        .mm-title {
          font-size: 13px; font-weight: 600; line-height: 1.35;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .mm-meta {
          margin-top: 3px; font-size: 12px; color: var(--mm-muted);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .mm-actions { display: flex; align-items: center; gap: 8px; }
        .mm-btn-primary {
          flex: 1; border: none; border-radius: 10px; padding: 7px 12px;
          background: var(--mm-accent); color: var(--mm-on-accent);
          font-size: 12px; font-weight: 600; cursor: pointer;
          transition: background-color 160ms ease;
        }
        .mm-btn-primary:hover { background: var(--mm-accent-hover); }
        .mm-btn-secondary {
          border: 1px solid var(--mm-border); border-radius: 10px; padding: 7px 12px;
          background: var(--mm-subtle); color: var(--mm-secondary);
          font-size: 12px; font-weight: 500; cursor: pointer;
          white-space: nowrap;
        }
        .mm-btn-secondary:hover { color: var(--mm-text); }
        button:focus-visible { outline: 2px solid var(--mm-accent); outline-offset: 2px; }
        .mm-bar-track { height: 2.5px; width: 100%; background: var(--mm-subtle); }
        .mm-bar-fill { height: 100%; width: 100%; background: var(--mm-accent); }
        .mm-pill-wrap {
          position: fixed;
          top: 16px;
          left: 50%;
          transform: translateX(-50%);
          pointer-events: none;
        }
        .mm-pill {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 8px 14px; border-radius: 999px;
          background: var(--mm-surface); color: var(--mm-text);
          border: 1px solid var(--mm-border); box-shadow: var(--mm-shadow);
          font-size: 12px; font-weight: 500;
          animation: mmPillIn 200ms cubic-bezier(0.2, 0.9, 0.25, 1);
        }
        .mm-pill svg { width: 14px; height: 14px; color: var(--mm-accent); flex-shrink: 0; }
        @keyframes mmSlideIn {
          from { opacity: 0; transform: translateX(18px) scale(0.97); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes mmPillIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .mm-toast, .mm-pill { animation: none !important; transition: none !important; }
        }
      `;
      shadowRoot.appendChild(style);

      const root = document.createElement('div');
      root.className = 'mm-root';
      toastContainer = document.createElement('div');
      toastContainer.className = 'mm-toast-wrap';
      pillContainer = document.createElement('div');
      pillContainer.className = 'mm-pill-wrap';
      root.appendChild(toastContainer);
      root.appendChild(pillContainer);
      shadowRoot.appendChild(root);
    }

    const rootEl = shadowRoot.querySelector('.mm-root');
    if (rootEl) {
      rootEl.classList.toggle('mm-dark', resolveIsDark(currentThemeSetting));
      rootEl.dataset.preset = currentThemePreset;
    }
  }

  function clearToastLoop() {
    if (toastRAF) {
      cancelAnimationFrame(toastRAF);
      toastRAF = null;
    }
  }

  function closeCurrentToast() {
    clearToastLoop();
    toastQueue.length = 0;
    toastIndex = 0;
    if (toastContainer) toastContainer.innerHTML = '';
  }

  function renderActiveToast() {
    if (!toastContainer) return;
    clearToastLoop();

    if (toastQueue.length === 0) {
      toastContainer.innerHTML = '';
      return;
    }

    if (toastIndex >= toastQueue.length) toastIndex = 0;
    if (toastIndex < 0) toastIndex = toastQueue.length - 1;

    const item = toastQueue[toastIndex];
    const isMissed = item.mode === 'missed';
    const isVideo =
      !isMissed && item.context && (item.context.kind === 'youtube' || item.context.kind === 'video');

    const card = document.createElement('div');
    card.className = 'mm-toast';
    card.setAttribute('role', 'alert');

    const labelText = isMissed
      ? `Bạn có ${item.count} lịch nhắc vừa lỡ`
      : item.note || 'Đến giờ quay lại tab';
    const titleText = isMissed
      ? item.firstTitle || 'Mở lại các tab đã hẹn giờ'
      : item.title || 'Tab đã lưu';
    const metaText = isMissed
      ? 'Nhấn để tiếp tục đúng mốc đã lưu'
      : `Tiếp tục từ ${formatContextBadge(item.context)} • ${item.domain || ''}`;

    const pagerHtml =
      toastQueue.length > 1
        ? `<div class="mm-pager">
            <button class="mm-icon-btn" data-act="prev" aria-label="Nhắc nhở trước">${SVG.chevronLeft}</button>
            <span>${toastIndex + 1}/${toastQueue.length}</span>
            <button class="mm-icon-btn" data-act="next" aria-label="Nhắc nhở tiếp">${SVG.chevronRight}</button>
          </div>`
        : '';

    card.innerHTML = `
      <div class="mm-toast-body">
        <div class="mm-head">
          <div class="mm-label">${SVG.bell}<span></span></div>
          <div class="mm-head-actions">
            ${pagerHtml}
            <button class="mm-icon-btn" data-act="close" aria-label="Đóng thông báo">${SVG.x}</button>
          </div>
        </div>
        <div class="mm-row">
          <div class="mm-thumb ${isVideo ? 'yt' : 'doc'}">${isVideo ? SVG.play : SVG.file}</div>
          <div class="mm-info">
            <div class="mm-title"></div>
            <div class="mm-meta"></div>
          </div>
        </div>
        <div class="mm-actions">
          <button class="mm-btn-primary" data-act="open">${isMissed ? 'Mở tab đầu' : 'Mở ngay'}</button>
          <button class="mm-btn-secondary" data-act="secondary">${isMissed ? 'Bỏ qua' : 'Nhắc +15p'}</button>
        </div>
      </div>
      <div class="mm-bar-track"><div class="mm-bar-fill"></div></div>
    `;

    card.querySelector('.mm-label span').textContent = labelText;
    card.querySelector('.mm-title').textContent = titleText;
    card.querySelector('.mm-meta').textContent = metaText;

    const fillEl = card.querySelector('.mm-bar-fill');

    card.addEventListener('mouseenter', () => {
      toastPaused = true;
    });
    card.addEventListener('mouseleave', () => {
      toastPaused = false;
      toastLastTick = performance.now();
    });
    card.addEventListener('focusin', () => {
      toastPaused = true;
    });
    card.addEventListener('focusout', () => {
      toastPaused = false;
      toastLastTick = performance.now();
    });

    card.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;

      if (act === 'close') {
        if (isMissed) chrome.runtime.sendMessage({ type: 'DISMISS_MISSED' });
        toastQueue.splice(toastIndex, 1);
        renderActiveToast();
        return;
      }
      if (act === 'prev') {
        toastIndex -= 1;
        renderActiveToast();
        return;
      }
      if (act === 'next') {
        toastIndex += 1;
        renderActiveToast();
        return;
      }
      if (act === 'open') {
        if (isMissed) {
          chrome.runtime.sendMessage({ type: 'OPEN_BOOKMARK', id: item.firstId });
          chrome.runtime.sendMessage({ type: 'DISMISS_MISSED' });
        } else {
          chrome.runtime.sendMessage({ type: 'OPEN_BOOKMARK', id: item.id });
        }
        toastQueue.splice(toastIndex, 1);
        renderActiveToast();
        return;
      }
      if (act === 'secondary') {
        if (isMissed) {
          chrome.runtime.sendMessage({ type: 'DISMISS_MISSED' });
        } else {
          chrome.runtime.sendMessage({ type: 'SNOOZE_BOOKMARK', id: item.id, minutes: 15 });
          showStatusPill('Đã hoãn nhắc nhở thêm 15 phút');
        }
        toastQueue.splice(toastIndex, 1);
        renderActiveToast();
      }
    });

    toastContainer.innerHTML = '';
    toastContainer.appendChild(card);

    toastRemaining = TOAST_DURATION_MS;
    toastPaused = false;
    toastLastTick = performance.now();

    function step(now) {
      const dt = now - toastLastTick;
      toastLastTick = now;
      if (!toastPaused) {
        toastRemaining -= dt;
        const ratio = Math.max(0, toastRemaining / TOAST_DURATION_MS);
        fillEl.style.width = `${ratio * 100}%`;
        if (toastRemaining <= 0) {
          toastQueue.splice(toastIndex, 1);
          renderActiveToast();
          return;
        }
      }
      toastRAF = requestAnimationFrame(step);
    }
    toastRAF = requestAnimationFrame(step);
  }

  function enqueueToast(payload, themeSetting, themePreset) {
    ensureShadowHost(themeSetting, themePreset);
    const existingIdx = toastQueue.findIndex((x) => x.id === payload.id && x.mode === payload.mode);
    if (existingIdx >= 0) {
      toastQueue[existingIdx] = payload;
      toastIndex = existingIdx;
    } else {
      toastQueue.push(payload);
      toastIndex = toastQueue.length - 1;
    }
    renderActiveToast();
  }

  function showStatusPill(text, themeSetting, themePreset) {
    ensureShadowHost(themeSetting, themePreset);
    if (!pillContainer) return;
    pillContainer.innerHTML = '';
    const pill = document.createElement('div');
    pill.className = 'mm-pill';
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-live', 'polite');
    pill.innerHTML = `${SVG.check}<span></span>`;
    pill.querySelector('span').textContent = text;
    pillContainer.appendChild(pill);

    clearTimeout(pillTimer);
    pillTimer = setTimeout(() => {
      if (pillContainer) pillContainer.innerHTML = '';
    }, PILL_DURATION_MS);
  }

  // ---------- 4. MESSAGE HANDLERS & PENDING RESTORE CHECK ----------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return false;

    if (msg.type === 'CAPTURE_CONTEXT') {
      sendResponse({ ok: true, ...captureCurrentContext() });
      return false;
    }

    if (msg.type === 'RESTORE_CONTEXT') {
      ensureShadowHost(msg.theme, msg.themePreset);
      restoreContext(msg.context, msg.title);
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'SHOW_REMINDER_TOAST') {
      if (document.fullscreenElement && msg.dndFullscreen !== false) {
        sendResponse({ ok: false, reason: 'fullscreen' });
        return false;
      }
      enqueueToast({ mode: 'reminder', ...msg.payload }, msg.theme, msg.themePreset);
      sendResponse({ ok: true, shown: true });
      return false;
    }

    if (msg.type === 'SHOW_MISSED_TOAST') {
      if (document.fullscreenElement && msg.dndFullscreen !== false) {
        sendResponse({ ok: false, reason: 'fullscreen' });
        return false;
      }
      enqueueToast({ mode: 'missed', id: 'missed-summary', ...msg.payload }, msg.theme, msg.themePreset);
      sendResponse({ ok: true, shown: true });
      return false;
    }

    if (msg.type === 'SHOW_STATUS_PILL') {
      showStatusPill(msg.text || 'Đã lưu tab', msg.theme, msg.themePreset);
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'HIDE_TOASTS') {
      closeCurrentToast();
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  // Self-check if this tab was opened by MarkMoment to restore context
  try {
    chrome.runtime.sendMessage({ type: 'CHECK_PENDING_RESTORE' }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res && res.pending && res.pending.context) {
        ensureShadowHost(res.theme, res.themePreset);
        restoreContext(res.pending.context, res.pending.title);
      }
    });
  } catch {
    // Ignore if extension context invalidated
  }
})();
