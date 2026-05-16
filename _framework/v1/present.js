/*
 * present.js — controller logic for /<slug>/present/.
 *
 * Talks to the deck (at /<slug>/) over a same-origin BroadcastChannel keyed
 * by deck pathname. Inbound: {type:'state', index, total, skipped, reason}.
 * Outbound: {type:'cmd', cmd:'next'|'prev'|'first'|'last'|'goto'|'sync', ...}.
 *
 * Notes are sourced by fetching the deck's HTML once at startup and
 * extracting #speaker-notes — no extra hop on each navigation.
 */

// ----- derive deck location -----

// The presenter lives one directory under the deck: /<slug>/present/ → /<slug>/.
const DECK_URL = new URL('../', location.href).href;
const DECK_PATH = new URL(DECK_URL).pathname;
const CHANNEL_NAME = 'deck-stage:' + DECK_PATH;

// ----- state -----

// Heartbeat: the deck broadcasts 'state' every 5s when idle. Silence
// beyond DISCONNECT_AFTER_MS means the deck closed (tab shut, reload,
// navigated away); flip back to "Waiting for deck…" so the user can
// re-open it. Each inbound message rearms the watchdog.
const DISCONNECT_AFTER_MS = 7000;

const state = {
  index: 0,
  total: 0,
  skipped: [],
  fragment: 0,
  fragmentTotal: 0,
  notes: [],
  connected: false,
};

// ----- channel -----

let channel = null;
let watchdog = null;
try {
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener('message', onChannelMessage);
} catch (e) {
  channel = null;
}

function send(cmd, extra) {
  if (!channel) return;
  try { channel.postMessage(Object.assign({ type: 'cmd', cmd }, extra || {})); }
  catch (e) {}
}

function armWatchdog() {
  if (watchdog) clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    state.connected = false;
    setStatus('Waiting for deck…', 'waiting', true);
  }, DISCONNECT_AFTER_MS);
}

function onChannelMessage(e) {
  const d = e.data;
  if (!d || d.type !== 'state') return;
  state.index = Number.isInteger(d.index) ? d.index : 0;
  state.total = Number.isInteger(d.total) ? d.total : 0;
  state.skipped = Array.isArray(d.skipped) ? d.skipped : [];
  state.fragment = Number.isInteger(d.fragment) ? d.fragment : 0;
  state.fragmentTotal = Number.isInteger(d.fragmentTotal) ? d.fragmentTotal : 0;
  setConnected(true);
  armWatchdog();
  render();
}

// ----- DOM refs -----

const els = {
  clock:        document.getElementById('clock'),
  timer:        document.getElementById('timer'),
  timerToggle:  document.getElementById('timer-toggle'),
  timerReset:   document.getElementById('timer-reset'),
  status:       document.getElementById('status'),
  openDeck:     document.getElementById('open-deck'),
  fullscreen:   document.getElementById('fullscreen'),
  frameCurrent: document.getElementById('frame-current'),
  frameNext:    document.getElementById('frame-next'),
  curNum:       document.getElementById('cur-num'),
  curTotal:     document.getElementById('cur-total'),
  curFragment:  document.getElementById('cur-fragment'),
  curFragNum:   document.getElementById('cur-frag-num'),
  curFragTotal: document.getElementById('cur-frag-total'),
  nextMeta:     document.getElementById('next-meta'),
  notes:        document.getElementById('notes'),
  notesStatus:  document.getElementById('notes-status'),
  notesReset:   document.getElementById('notes-reset'),
  navPrev:      document.getElementById('nav-prev'),
  navNext:      document.getElementById('nav-next'),
  navCur:       document.getElementById('nav-cur'),
  navTotal:     document.getElementById('nav-total'),
  waiting:      document.getElementById('waiting'),
  waitingOpen:  document.getElementById('waiting-open'),
};

// ----- clock -----

function tickClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  els.clock.textContent = hh + ':' + mm;
}
tickClock();
setInterval(tickClock, 15 * 1000);

// ----- timer -----

const timer = {
  startedAt: 0,
  accumMs: 0,
  running: false,
};

function timerMs() {
  return timer.accumMs + (timer.running ? (Date.now() - timer.startedAt) : 0);
}

function renderTimer() {
  const total = Math.floor(timerMs() / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  els.timer.textContent = h > 0 ? (h + ':' + pad(m) + ':' + pad(s)) : (pad(m) + ':' + pad(s));
}
renderTimer();
setInterval(renderTimer, 250);

els.timerToggle.addEventListener('click', () => {
  if (timer.running) {
    timer.accumMs += Date.now() - timer.startedAt;
    timer.running = false;
    els.timerToggle.textContent = 'Start';
  } else {
    timer.startedAt = Date.now();
    timer.running = true;
    els.timerToggle.textContent = 'Pause';
  }
  renderTimer();
});

els.timerReset.addEventListener('click', () => {
  timer.startedAt = Date.now();
  timer.accumMs = 0;
  if (timer.running) {} // keep running, just zeroed
  renderTimer();
});

// ----- connection status -----

function setStatus(label, dataState, openDeckVisible) {
  els.status.textContent = label;
  els.status.dataset.state = dataState;
  els.openDeck.hidden = !openDeckVisible;
  // The center-stage waiting card covers the empty iframes when the deck
  // isn't connected. Same trigger as the small header-button.
  if (els.waiting) els.waiting.hidden = !openDeckVisible;
}

function setConnected(on) {
  if (on === state.connected) return;
  state.connected = on;
  setStatus(on ? 'Connected' : 'Waiting for deck…',
            on ? 'connected'  : 'waiting',
            !on);
}

function openDeckWindow() {
  window.open(DECK_URL, 'deck:' + DECK_PATH);
}
els.openDeck.addEventListener('click', openDeckWindow);
if (els.waitingOpen) els.waitingOpen.addEventListener('click', openDeckWindow);

// If we don't hear back after a moment, surface "Waiting for deck…" and
// the "Open deck" button. setConnected(false) is a no-op if state hasn't
// flipped, so call setStatus directly.
setTimeout(() => {
  if (!state.connected) setStatus('Waiting for deck…', 'waiting', true);
}, 600);

// ----- thumbnails -----

// Cache the iframe src per index so we don't re-trigger a load when the
// channel re-broadcasts the same state (e.g. on 'sync' or 'mutation').
const frameSrc = { current: '', next: '' };

function thumbUrl(index) {
  // ?_view=slide hides all framework chrome (rail, overlay, tap zones)
  // and disables keyboard nav + BroadcastChannel inside the iframe so it
  // can't echo state back. &n=N (1-indexed) selects the slide; the
  // legacy ?_snthumb=1#N form still works via an alias in deck-stage.js.
  return DECK_URL + '?_view=slide&n=' + (index + 1);
}

function loadFrame(key, index) {
  const url = thumbUrl(index);
  if (frameSrc[key] === url) return;
  frameSrc[key] = url;
  const el = key === 'current' ? els.frameCurrent : els.frameNext;
  el.src = url;
}

function nextVisibleIndex(from) {
  const skipped = new Set(state.skipped);
  for (let i = from + 1; i < state.total; i++) if (!skipped.has(i)) return i;
  return -1;
}

// ----- render -----

function render() {
  const { index, total, fragment, fragmentTotal } = state;
  els.curNum.textContent = total ? String(index + 1) : '–';
  els.curTotal.textContent = total ? String(total) : '–';
  els.navCur.textContent = total ? String(index + 1) : '–';
  els.navTotal.textContent = total ? String(total) : '–';

  // Fragment indicator: shown only when the current slide has reveals.
  // Lets the presenter see "I have 2 more taps before the next slide".
  if (fragmentTotal > 0) {
    els.curFragment.hidden = false;
    els.curFragNum.textContent = String(fragment);
    els.curFragTotal.textContent = String(fragmentTotal);
  } else {
    els.curFragment.hidden = true;
  }

  if (total) {
    loadFrame('current', index);
    const nx = nextVisibleIndex(index);
    if (nx >= 0) {
      loadFrame('next', nx);
      els.nextMeta.textContent = (nx + 1) + ' / ' + total;
      els.frameNext.style.visibility = '';
    } else {
      // End of deck — keep the iframe but mark next as N/A.
      els.nextMeta.textContent = '—';
      els.frameNext.style.visibility = 'hidden';
    }
  }

  renderNotes(index);
}

// ----- editable notes -----
//
// Notes live in two places:
//   1. The deck's <script id="speaker-notes"> JSON — canonical, version-
//      controlled. Authoritative until edited locally.
//   2. localStorage, keyed by deck path + slide index — per-presenter
//      drafts. Survive reloads, never leave the browser. The user
//      bakes them back into the deck file at next upload.
//
// The textarea always shows: localStorage value if present, else the
// canonical note from #2. The "Edited locally" affordance only appears
// when a localStorage override exists.

const NOTES_KEY_PREFIX = 'slides.notes:' + DECK_PATH + ':';
function notesKey(index) { return NOTES_KEY_PREFIX + index; }

function originalNote(index) {
  return (state.notes[index] || '').trim();
}

function overrideNote(index) {
  try {
    const v = localStorage.getItem(notesKey(index));
    return v == null ? null : v;
  } catch { return null; }
}

function effectiveNote(index) {
  const o = overrideNote(index);
  return o != null ? o : originalNote(index);
}

let renderedIndex = -1;
function renderNotes(index) {
  // Avoid clobbering a textarea the user is actively typing in. The
  // index changes only on nav, so re-rendering on every state broadcast
  // would steal focus/caret on each heartbeat.
  if (index === renderedIndex && document.activeElement === els.notes) return;
  renderedIndex = index;
  els.notes.value = effectiveNote(index);
  syncNotesStatus(index);
}

function syncNotesStatus(index) {
  const o = overrideNote(index);
  const edited = o != null && o !== originalNote(index);
  els.notesStatus.hidden = !edited;
}

let saveTimer = null;
els.notes.addEventListener('input', () => {
  const i = renderedIndex;
  if (i < 0) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const v = els.notes.value;
    try {
      // Reset to original via Reset button is the only way to clear the
      // override; an empty edit is itself a meaningful override (the
      // user said "no note here"). Both paths route through writeOverride.
      writeOverride(i, v);
    } catch {}
    syncNotesStatus(i);
  }, 250);
});

function writeOverride(index, value) {
  try { localStorage.setItem(notesKey(index), value); } catch {}
}

function clearOverride(index) {
  try { localStorage.removeItem(notesKey(index)); } catch {}
}

els.notesReset.addEventListener('click', () => {
  const i = renderedIndex;
  if (i < 0) return;
  clearOverride(i);
  els.notes.value = originalNote(i);
  syncNotesStatus(i);
  els.notes.focus();
});

// ----- nav -----
//
// Each nav action does two things: send the cmd on the channel (drives
// any connected deck) AND optimistically update local state. If a deck
// is connected it'll broadcast back authoritative state and overwrite
// the optimistic guess; if not, the optimistic update keeps the
// presenter usable as a standalone slide stepper.

function nav(cmd) {
  send(cmd);
  if (!state.total) return;
  const skipped = new Set(state.skipped);
  const before = state.index;
  if (cmd === 'next') {
    for (let i = state.index + 1; i < state.total; i++) {
      if (!skipped.has(i)) { state.index = i; break; }
    }
  } else if (cmd === 'prev') {
    for (let i = state.index - 1; i >= 0; i--) {
      if (!skipped.has(i)) { state.index = i; break; }
    }
  } else if (cmd === 'first') {
    state.index = 0;
  } else if (cmd === 'last') {
    state.index = state.total - 1;
  }
  if (state.index !== before) render();
}

els.navPrev.addEventListener('click', () => nav('prev'));
els.navNext.addEventListener('click', () => nav('next'));

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  const inEditor = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

  // Slide nav keys always win, even when the speaker-notes textarea is
  // focused — during a presentation you keep the textarea active to read
  // notes, but you should still be able to advance with ←/→ without
  // having to click out first. preventDefault stops the textarea from
  // also moving the caret on those keys.
  switch (e.key) {
    case 'ArrowRight':
    case 'PageDown':
      nav('next'); e.preventDefault(); return;
    case 'ArrowLeft':
    case 'PageUp':
      nav('prev'); e.preventDefault(); return;
  }

  // The rest are typeable characters / line nav. Stay out of the way
  // when the user is editing notes.
  if (inEditor) return;

  switch (e.key) {
    case ' ':
    case 'Spacebar':
      nav('next'); e.preventDefault(); break;
    case 'Home': nav('first'); e.preventDefault(); break;
    case 'End':  nav('last');  e.preventDefault(); break;
    case 't': case 'T': els.timerToggle.click(); e.preventDefault(); break;
    case 'f': case 'F': toggleFullscreen(); e.preventDefault(); break;
  }
});

// ----- fullscreen -----

function toggleFullscreen() {
  const doc = document;
  if (!doc.fullscreenElement) {
    if (doc.documentElement.requestFullscreen) doc.documentElement.requestFullscreen();
  } else if (doc.exitFullscreen) {
    doc.exitFullscreen();
  }
}
els.fullscreen.addEventListener('click', toggleFullscreen);

// ----- bootstrap from deck HTML -----
//
// Fetch the deck once at startup to: (1) read #speaker-notes, (2) count
// slides so we know the total even before a deck window connects. Without
// this, a standalone presenter shows empty iframes and "– / –" counts
// until a deck window broadcasts state — which looks broken if the user
// hasn't opened a deck yet.

(async () => {
  try {
    const res = await fetch(DECK_URL, { cache: 'no-store' });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const tag = doc.getElementById('speaker-notes');
    if (tag) {
      const parsed = JSON.parse(tag.textContent || '[]');
      if (Array.isArray(parsed)) state.notes = parsed;
    }

    // Optimistic: assume slide 1 until the deck broadcasts otherwise.
    // The count comes from the parsed HTML's <section> children of
    // <deck-stage>; if a deck window is open, its 'state' broadcast
    // overrides these values within a few hundred ms.
    const sections = doc.querySelectorAll('deck-stage > section');
    if (sections.length && state.total === 0) {
      state.total = sections.length;
      state.index = 0;
    }
  } catch (e) {
    // Notes/count are best-effort. Manual navigation still works.
  }

  // Ask the deck for its current state (in case the presenter was opened
  // after the deck — the channel only fires on subsequent navs).
  send('sync');
  render();
})();
