// Background service worker. Two jobs:
//
// 1. scrapeOneTab() — the core "fetch a URL through the user's own browser"
//    primitive. Opens the URL in a background tab, lets it render (real browser,
//    so it passes bot checks; if a captcha shows we surface the tab so the user
//    solves it), scrapes text (+links), then closes it. Exposed to the popup via
//    the "scrapeUrl" message so single-song / candidate imports also go through
//    the user's browser.
//
// 2. runPlaylistJob() — imports many songs unattended: optionally create the
//    playlist, then for each song scrapeOneTab -> POST /api/import/extract-text
//    to parse -> save to library and/or playlist (per `target`) -> next.
//    Progress is written to chrome.storage.local["job"] and broadcast via
//    runtime messages, so the popup can show it and the job survives the popup
//    (or window) closing.
//
// The toolbar icon has no default_popup; clicking it opens popup.html as a
// standalone window (openPopupWindow).

const SETTLE_MS = 2500; // let late JS run after "complete"
const LOAD_TIMEOUT_MS = 45000;
const CHALLENGE_POLL_MS = 3000;
const CHALLENGE_MAX_WAIT_MS = 150000; // up to 2.5 min for a manual captcha

// Mirrors backend/web_fetch.py:_CHALLENGE_TEXT_MARKERS.
const CHALLENGE_MARKERS = [
  "performing security verification",
  "checking your browser before accessing",
  "just a moment",
  "attention required",
  "verify you are human",
  "verifying you are human",
  "enable javascript and cookies to continue",
];

let CURRENT = null; // in-memory mirror of the job (also persisted)

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanBase(siteUrl) {
  let s = (siteUrl || "").trim().replace(/\/+$/, "");
  if (s && !/^https?:\/\//i.test(s)) {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$|\/)/i.test(s);
    s = (local ? "http://" : "https://") + s;
  }
  return s;
}

function authHeaders(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

function looksLikeChallenge(text) {
  const blob = (text || "").slice(0, 3000).toLowerCase();
  return CHALLENGE_MARKERS.some((m) => blob.includes(m));
}

// Injected into the page tab. Text only.
function scrapePageText() {
  return { text: document.body ? document.body.innerText : "", title: document.title || "" };
}

// Injected: text + anchor links (mirrors backend web_fetch _LINKS_JS).
function scrapePageFull() {
  const links = Array.from(document.querySelectorAll("a[href]"))
    .map((a) => ({
      href: a.href,
      text: (a.innerText || a.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
    }))
    .filter((l) => l.href && !l.href.startsWith("javascript:") && !l.href.startsWith("mailto:"));
  return { text: document.body ? document.body.innerText : "", title: document.title || "", links };
}

async function scrapeTab(tabId, full = false) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: full ? scrapePageFull : scrapePageText,
    });
    return result || { text: "", title: "", links: [] };
  } catch {
    return { text: "", title: "", links: [] };
  }
}

// Open `url` in a background tab, let it render, surface it if a captcha shows
// (so the user can solve it), then scrape and close. Returns
// { ok, text, links, title } or { ok:false, error }. This is the core
// "fetch through the user's own browser" primitive used everywhere.
async function scrapeOneTab(url, { full = false, onStep, isCancelled } = {}) {
  let tab = null;
  try {
    onStep && onStep("opening");
    tab = await chrome.tabs.create({ url, active: false });
    await waitForComplete(tab.id, LOAD_TIMEOUT_MS);
    await delay(SETTLE_MS);

    let scraped = await scrapeTab(tab.id, full);
    const start = Date.now();
    let surfaced = false;
    while (
      looksLikeChallenge(scraped.text) &&
      Date.now() - start < CHALLENGE_MAX_WAIT_MS &&
      !(isCancelled && isCancelled())
    ) {
      if (!surfaced) {
        surfaced = true;
        await chrome.tabs.update(tab.id, { active: true });
        onStep && onStep("solve-captcha");
      }
      await delay(CHALLENGE_POLL_MS);
      scraped = await scrapeTab(tab.id, full);
    }
    if (looksLikeChallenge(scraped.text)) return { ok: false, error: "captcha not cleared in time" };
    if (!scraped.text || scraped.text.trim().length < 20) return { ok: false, error: "no readable text on page" };
    return { ok: true, text: scraped.text, links: scraped.links || [], title: scraped.title || "" };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    if (tab) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function waitForComplete(tabId, timeout) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpd);
      clearTimeout(timer);
      resolve(ok);
    };
    const onUpd = (id, info) => {
      if (id === tabId && info.status === "complete") finish(true);
    };
    chrome.tabs.onUpdated.addListener(onUpd);
    const timer = setTimeout(() => finish(false), timeout);
    chrome.tabs.get(tabId).then((t) => {
      if (t && t.status === "complete") finish(true);
    }).catch(() => {});
  });
}

async function setJob(patch) {
  CURRENT = { ...(CURRENT || {}), ...patch };
  await chrome.storage.local.set({ job: CURRENT });
  chrome.runtime.sendMessage({ type: "jobUpdate", job: CURRENT }).catch(() => {});
}

async function logLine(msg) {
  const log = ((CURRENT && CURRENT.log) || []).slice(-40);
  log.push(msg);
  await setJob({ log });
}

async function streamExtract(base, token, text, url) {
  const res = await fetch(`${base}/api/import/extract-text`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ text, url }),
  });
  if (!res.ok) throw new Error(`extract HTTP ${res.status}`);
  let song = null;
  let err = null;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      let evt;
      try {
        evt = JSON.parse(t);
      } catch {
        continue;
      }
      if (evt.type === "result") song = evt.data;
      else if (evt.type === "error") err = evt.message;
    }
  }
  if (err) throw new Error(err);
  return song;
}

async function createPlaylist(base, token, name) {
  const res = await fetch(`${base}/api/playlists`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`create playlist HTTP ${res.status}`);
  return res.json();
}

async function addToPlaylist(base, token, plId, song) {
  const res = await fetch(`${base}/api/playlists/${plId}/songs`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ song }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.detail || `add HTTP ${res.status}`);
  }
  return res.json();
}

async function createLibrarySong(base, token, song) {
  const res = await fetch(`${base}/api/songs`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(song),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.detail || `save HTTP ${res.status}`);
  }
  return res.json();
}

// Title+artist key for duplicate detection. Mirrors songKey() in popup.js and
// frontend/screens.jsx — keep the three identical.
function songKey(title, artist) {
  const n = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${n(title)} ${n(artist)}`;
}

// ctx: { plId, toLibrary, toPlaylist, toExisting, dupMode, destKeys }. "both"
// makes two independent copies (one library song, one playlist-owned song) —
// mirroring the web app. When importing into an existing playlist, songs whose
// title+artist are already there are skipped unless dupMode === "copy".
async function processSong(base, token, ctx, song, index) {
  const setStep = (step) => setJob({ current: { index, title: song.title, url: song.url, step } });

  // Skip songs already in the destination playlist BEFORE the expensive
  // tab-scrape + parse, matched on the scanned title + artist. "Add copies
  // anyway" (dupMode === "copy") imports everything.
  if (ctx.toExisting && ctx.dupMode === "skip" && ctx.destKeys.has(songKey(song.title, song.artist))) {
    await setJob({ skippedCount: ((CURRENT && CURRENT.skippedCount) || 0) + 1 });
    await logLine(`↷ ${song.title} — already in playlist`);
    return;
  }

  try {
    const scraped = await scrapeOneTab(song.url, {
      onStep: (step) => {
        setStep(step);
        if (step === "solve-captcha") logLine(`Captcha on "${song.title}" — solve it in the opened tab…`);
      },
      isCancelled: () => CURRENT && CURRENT.cancelled,
    });
    if (!scraped.ok) throw new Error(scraped.error);

    await setStep("parsing");
    const parsed = await streamExtract(base, token, scraped.text, song.url);
    if (!parsed) throw new Error("no chords found");
    if (!parsed.title && song.title) parsed.title = song.title;
    if ((!parsed.artist || parsed.artist === "Unknown") && song.artist) parsed.artist = song.artist;
    const payload = { ...parsed, tags: [] };

    await setStep("saving");
    if (ctx.toLibrary) await createLibrarySong(base, token, payload);
    if (ctx.toPlaylist) await addToPlaylist(base, token, ctx.plId, payload);
    // Track what we've added so a repeated incoming title is also caught (same
    // scanned title+artist basis as the pre-parse skip check above).
    if (ctx.toExisting) ctx.destKeys.add(songKey(song.title, song.artist));
    await setJob({ doneCount: ((CURRENT && CURRENT.doneCount) || 0) + 1 });
    await logLine(`✓ ${parsed.title || song.title}`);
  } catch (e) {
    const failed = ((CURRENT && CURRENT.failed) || []).concat([
      { title: song.title, url: song.url, reason: e.message },
    ]);
    await setJob({ failed });
    await logLine(`✗ ${song.title}: ${e.message}`);
  }
}

// `playlistId` (optional): append to this existing playlist instead of creating
// a new one. The popup resolves the name-collision choice and passes it here.
async function runPlaylistJob({
  siteUrl, token, playlistName, songs,
  target = "playlist", playlistId = null, dupMode = "copy", existingKeys = [],
}) {
  const base = cleanBase(siteUrl);
  const toLibrary = target === "library" || target === "both";
  const toNewPlaylist = target === "playlist" || target === "both";
  const toExisting = target === "existing";
  // Songs land in a playlist for both the "new" and "existing" targets.
  const toPlaylist = toNewPlaylist || toExisting;
  await setJob({
    status: "running",
    playlistName,
    target,
    playlistId: null,
    total: songs.length,
    doneCount: 0,
    skippedCount: 0,
    failed: [],
    current: null,
    log: [],
    cancelled: false,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
  });

  let plId = playlistId || null;
  if (toPlaylist) {
    if (plId) {
      await setJob({ playlistId: plId });
      await logLine(`Adding to existing playlist "${playlistName}"`);
    } else {
      try {
        const pl = await createPlaylist(base, token, playlistName);
        plId = pl.id;
        await setJob({ playlistId: plId });
        await logLine(`Created playlist "${playlistName}"`);
      } catch (e) {
        await setJob({ status: "error", error: `Couldn't create playlist: ${e.message}`, finishedAt: Date.now() });
        return;
      }
    }
  } else {
    await logLine("Importing songs to your library…");
  }

  const ctx = {
    plId, toLibrary, toPlaylist, toExisting,
    dupMode,
    destKeys: new Set(existingKeys),
  };
  for (let i = 0; i < songs.length; i++) {
    if (CURRENT && CURRENT.cancelled) {
      await logLine("Cancelled.");
      break;
    }
    await processSong(base, token, ctx, songs[i], i);
  }

  await setJob({ status: "done", current: null, finishedAt: Date.now() });
  const skipped = (CURRENT && CURRENT.skippedCount) || 0;
  await logLine(
    `Done — ${(CURRENT && CURRENT.doneCount) || 0} imported`
      + (skipped ? `, ${skipped} skipped (already there)` : "")
      + `, ${((CURRENT && CURRENT.failed) || []).length} failed.`
  );
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.cmd === "startPlaylist") {
    if (CURRENT && CURRENT.status === "running") {
      sendResponse({ ok: false, error: "A playlist import is already running." });
      return;
    }
    runPlaylistJob(msg).catch(async (e) => {
      await setJob({ status: "error", error: e.message, finishedAt: Date.now() });
    });
    sendResponse({ ok: true });
    return;
  }
  if (msg && msg.cmd === "cancel") {
    if (CURRENT) CURRENT.cancelled = true;
    setJob({ cancelled: true });
    sendResponse({ ok: true });
    return;
  }
  if (msg && msg.cmd === "scrapeUrl") {
    // Fetch an arbitrary URL through the user's own browser (past bot checks).
    scrapeOneTab(msg.url, { full: !!msg.full }).then((r) => sendResponse(r));
    return true; // async response
  }
  if (msg && msg.cmd === "getJob") {
    // Fall back to persisted state if the worker restarted.
    if (CURRENT) sendResponse({ job: CURRENT });
    else chrome.storage.local.get({ job: null }).then((s) => sendResponse({ job: s.job }));
    return true; // async response
  }
  if (msg && msg.cmd === "openWindow") {
    openPopupWindow().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// The toolbar icon has no default_popup, so a click lands here and we open the
// UI as its own standalone window (remembering which tab the user was on).
async function openPopupWindow() {
  let sourceTabId = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab) sourceTabId = tab.id;
  } catch {
    /* ignore */
  }
  const url = chrome.runtime.getURL(
    `popup.html?windowed=1${sourceTabId != null ? `&tabId=${sourceTabId}` : ""}`
  );
  // Reuse an existing window if one is already open.
  const existing = await chrome.tabs.query({ url: chrome.runtime.getURL("popup.html*") });
  if (existing && existing.length) {
    await chrome.windows.update(existing[0].windowId, { focused: true });
    return;
  }
  await chrome.windows.create({ url, type: "popup", width: 420, height: 640 });
}

chrome.action.onClicked.addListener(() => {
  openPopupWindow();
});
