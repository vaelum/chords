// Popup — mirrors the web app's Import section (frontend/screens.jsx ImportPanel),
// but every page fetch happens in the user's own browser (past bot checks):
//
//   Web mode:
//     • a URL  -> scrape it client-side -> /api/import/auto-text
//                 -> single song (preview + save) OR playlist (target + select)
//     • free text -> /api/import/search -> candidates -> pick -> scrape -> save
//     • "Use current page" -> scrape the active tab -> same auto-detect
//   Text/Image mode:
//     • paste text -> /api/import/extract-text   -> preview + save
//     • upload image -> /api/import/extract-image -> preview + save
//
// Single-item work runs inline here (with a progress log). Playlist imports are
// handed to the background worker so they survive the popup closing and can open
// each song in its own tab to clear captchas.

const $ = (id) => document.getElementById(id);
const IS_WINDOWED = new URLSearchParams(location.search).get("windowed") === "1";

const CHALLENGE_MARKERS = [
  "performing security verification",
  "checking your browser before accessing",
  "just a moment",
  "attention required",
  "verify you are human",
  "verifying you are human",
  "enable javascript and cookies to continue",
];

const state = {
  mode: "web",
  busy: false,
  progress: [],
  candidates: null,
  playlist: null, // { url, songs }
  selected: new Set(),
  target: "both",
  playlists: [], // the user's playlists, for the "Existing playlist" picker
  existingPlaylistId: null, // destination when target === "existing"
  dupMode: "skip", // 'skip' | 'copy' — handling for title+artist dups in the destination
  importingUrl: null,
  image: null, // { dataUrl, base64, mediaType, name }
};

// ---- settings / helpers ---------------------------------------------------

async function getSettings() {
  return chrome.storage.local.get({ siteUrl: "", token: "" });
}

async function getTargetTab() {
  const forced = new URLSearchParams(location.search).get("tabId");
  if (forced) {
    try {
      const t = await chrome.tabs.get(Number(forced));
      if (t) return t;
    } catch {
      /* closed — fall through */
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

function base(siteUrl) {
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

function looksLikeUrl(v) {
  return /^https?:\/\//i.test(v) || (/\.[a-z]{2,}/i.test(v) && !/\s/.test(v));
}
function normalizeUrl(v) {
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}
function looksLikeChallenge(text) {
  const blob = (text || "").slice(0, 3000).toLowerCase();
  return CHALLENGE_MARKERS.some((m) => blob.includes(m));
}


// ---- error / progress UI --------------------------------------------------

function setError(msg) {
  if (!msg) {
    $("errbox").classList.add("hide");
    return;
  }
  $("errmsg").textContent = msg;
  $("errbox").classList.remove("hide");
}

function pushProgress(line) {
  state.progress.push(line);
  renderProgress();
}
function clearProgress() {
  state.progress = [];
  renderProgress();
}
function renderProgress() {
  const el = $("progress");
  if (!state.busy && state.progress.length === 0) {
    el.classList.add("hide");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hide");
  const lines = state.progress
    .map((l, i) => `<div class="${i === state.progress.length - 1 && state.busy ? "last" : ""}">· ${escapeHtml(l)}</div>`)
    .join("");
  el.innerHTML = `
    <div class="plog">
      <div class="h">${state.busy ? '<span class="spin">↻</span>' : ""} ${state.busy ? "Working…" : "Progress"}</div>
      <div class="lines">${lines}</div>
    </div>`;
  const box = el.querySelector(".lines");
  if (box) box.scrollTop = box.scrollHeight;
}

function setBusy(v) {
  state.busy = v;
  $("go").disabled = v;
  $("convert").disabled = v || (!state.image && !$("pasted").value.trim());
  renderProgress();
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// Comparison key for duplicate detection when importing into an existing
// playlist: title + artist, case-insensitive and whitespace-normalized.
// Mirrors songKey() in frontend/screens.jsx — keep them identical.
function songKey(title, artist) {
  const n = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${n(title)} ${n(artist)}`;
}

// Fetch the user's playlists (for the "Existing playlist" picker + dup check).
async function fetchPlaylists() {
  const { siteUrl, token } = await getSettings();
  if (!siteUrl || !token) return [];
  const res = await fetch(`${base(siteUrl)}/api/playlists`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  return (await res.json()) || [];
}

// Modal choice dialog. choices: [{ value, label, variant }]. Resolves with the
// chosen value, or null if dismissed (backdrop / Escape / a value:null button).
function askChoice({ title, message, choices }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <div class="m-title">${escapeHtml(title)}</div>
      <div class="m-msg">${escapeHtml(message)}</div>
      <div class="m-actions"></div>`;
    const actions = modal.querySelector(".m-actions");

    let done = false;
    const close = (val) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close(null);
    };

    choices.forEach((c) => {
      const b = document.createElement("button");
      b.className = `btn btn-${c.variant || "secondary"} btn-block`;
      b.textContent = c.label;
      b.addEventListener("click", () => close(c.value));
      actions.appendChild(b);
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(null);
    });
    document.addEventListener("keydown", onKey);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  });
}

// ---- NDJSON streaming -----------------------------------------------------

async function runStream(path, body, onResult) {
  setError("");
  const { siteUrl, token } = await getSettings();
  if (!siteUrl || !token) {
    setError("Open Settings and set the site URL + token first.");
    return false;
  }
  const res = await fetch(`${base(siteUrl)}/api${path}`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let result = null;
  let errMsg = null;
  const handle = (evt) => {
    if (evt.type === "progress") pushProgress(evt.message);
    else if (evt.type === "result") {
      result = evt.data;
      pushProgress("Done.");
    } else if (evt.type === "error") errMsg = evt.message;
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() || "";
    for (const p of parts) {
      const t = p.trim();
      if (!t) continue;
      try {
        handle(JSON.parse(t));
      } catch {
        /* ignore */
      }
    }
  }
  if (buf.trim()) {
    try {
      handle(JSON.parse(buf.trim()));
    } catch {
      /* ignore */
    }
  }
  if (errMsg) {
    setError(errMsg);
    return false;
  }
  if (result) onResult(result);
  return true;
}

// ---- save -----------------------------------------------------------------

async function saveLibrarySong(song) {
  const { siteUrl, token } = await getSettings();
  const res = await fetch(`${base(siteUrl)}/api/songs`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ ...song, tags: [] }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.detail || `save HTTP ${res.status}`);
  }
  return res.json();
}

// ---- scrape a URL through the user's browser (via background) --------------

async function bgScrape(url) {
  const r = await chrome.runtime.sendMessage({ cmd: "scrapeUrl", url, full: true });
  if (!r || !r.ok) throw new Error((r && r.error) || "could not load page");
  return r; // { text, links, title }
}

// ---- single-song preview --------------------------------------------------

function showPreview(song) {
  const el = $("preview");
  el.classList.remove("hide");
  const bodyExcerpt = (song.body || "").slice(0, 600);
  el.innerHTML = `
    <div class="card preview mt">
      <div class="pv-head">
        <div>
          <div class="pv-title">${escapeHtml(song.title || "Untitled")}</div>
          <div class="pv-artist">${escapeHtml(song.artist || "Unknown")}</div>
        </div>
        <span class="badge badge-outline">${escapeHtml(song.key || "C")}</span>
      </div>
      <div class="pv-body">${escapeHtml(bodyExcerpt)}${(song.body || "").length > 600 ? "\n…" : ""}</div>
      <button class="btn btn-primary btn-block" id="savePreview">Save to library</button>
    </div>`;
  $("savePreview").addEventListener("click", async () => {
    const btn = $("savePreview");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      await saveLibrarySong(song);
      btn.textContent = "✓ Saved to library";
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Save to library";
      setError(`Save failed: ${e.message}`);
    }
  });
}
function clearPreview() {
  $("preview").classList.add("hide");
  $("preview").innerHTML = "";
}

// ---- candidates (web search) ----------------------------------------------

function showCandidates(list) {
  state.candidates = list || [];
  const el = $("candidates");
  el.classList.remove("hide");
  if (!state.candidates.length) {
    el.innerHTML = `<div class="t-muted">No versions found. Try a more specific query, or paste a URL.</div>`;
    return;
  }
  el.innerHTML =
    `<div class="t-muted">${state.candidates.length} versions found · pick one to import</div>` +
    state.candidates
      .map((c, i) => {
        let host = "";
        try {
          host = c.source || new URL(c.url).hostname;
        } catch {
          host = c.source || "";
        }
        return `
        <div class="card" data-i="${i}">
          <div class="pv-head" style="margin-bottom:6px">
            <div style="min-width:0">
              <div class="pv-title" style="font-size:14px">${escapeHtml(c.title || "Untitled")}</div>
              <div class="pv-artist">${escapeHtml(c.artist || "")}${c.snippet ? " · " + escapeHtml(c.snippet) : ""}</div>
            </div>
            ${c.key ? `<span class="badge badge-outline">${escapeHtml(c.key)}</span>` : ""}
          </div>
          <div class="t-muted" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(host)}</div>
          <button class="btn btn-primary btn-sm btn-block" style="margin-top:8px" data-import="${i}">Import</button>
        </div>`;
      })
      .join("");
  el.querySelectorAll("[data-import]").forEach((btn) => {
    btn.addEventListener("click", () => importCandidate(state.candidates[Number(btn.dataset.import)]));
  });
}
function clearCandidates() {
  state.candidates = null;
  $("candidates").classList.add("hide");
  $("candidates").innerHTML = "";
}

async function importCandidate(c) {
  if (!c || !c.url) return;
  setBusy(true);
  clearProgress();
  clearPreview();
  pushProgress(`Opening ${c.url} in your browser…`);
  try {
    const scraped = await bgScrape(c.url);
    if (looksLikeChallenge(scraped.text)) throw new Error("page is still showing a captcha");
    pushProgress("Parsing chords…");
    await runStream("/import/extract-text", { text: scraped.text, url: c.url }, (song) => {
      if (!song || !song.body) {
        setError("The page did not contain chords/lyrics we could parse.");
        return;
      }
      if (!song.title && c.title) song.title = c.title;
      if ((!song.artist || song.artist === "Unknown") && c.artist) song.artist = c.artist;
      showPreview(song);
    });
  } catch (e) {
    setError(`Import failed: ${e.message}`);
  } finally {
    setBusy(false);
  }
}

// ---- playlist selector ----------------------------------------------------

function showPlaylist(url, songs, suggestedName) {
  state.playlist = { url, songs };
  state.selected = new Set(songs.map((_, i) => i));
  state.target = "both";
  state.existingPlaylistId = null;
  state.dupMode = "skip";
  const el = $("playlistSel");
  el.classList.remove("hide");
  el.dataset.name = suggestedName || "Imported playlist";
  renderPlaylist();
  // Load playlists for the "Existing playlist" picker (async — fill it in once
  // it arrives without blocking the panel).
  fetchPlaylists()
    .then((list) => { state.playlists = list; populateExistingPicker(); })
    .catch(() => { state.playlists = []; });
}
function clearPlaylist() {
  state.playlist = null;
  $("playlistSel").classList.add("hide");
  $("playlistSel").innerHTML = "";
}

// Build the panel ONCE. Selection / target changes then update the existing DOM
// in place — rebuilding innerHTML on every toggle would reset the name input
// (losing what the user typed) and scroll the song list back to the top.
function renderPlaylist() {
  const { playlist, selected, target } = state;
  if (!playlist) return;
  const total = playlist.songs.length;
  const targets = [
    ["library", "Library only", "Add to your library."],
    ["playlist", "New playlist", "Create a new playlist with its own copies."],
    ["existing", "Existing playlist", "Append to a playlist you already have."],
    ["both", "Both", "A library copy and a new-playlist copy."],
  ];
  const el = $("playlistSel");
  el.innerHTML = `
    <div class="mt t-muted">▤ Playlist detected · ${total} ${total === 1 ? "song" : "songs"}</div>
    <label class="label mt">Import to</label>
    <div class="target-grid">
      ${targets
        .map(
          ([v, t, d]) =>
            `<button class="target-card ${target === v ? "on" : ""}" data-target="${v}">
               <div class="tt">${t}</div><div class="td">${d}</div></button>`
        )
        .join("")}
    </div>
    <div class="pl-name-field" style="margin:12px 0">
      <label class="label">Playlist name</label>
      <input class="input" id="plName" value="${escapeHtml(el.dataset.name || "")}" placeholder="Imported playlist" />
    </div>
    <div class="pl-existing-field hide" style="margin:12px 0">
      <label class="label">Add to playlist</label>
      <select class="input" id="existingPl"></select>
      <div id="dupNotice" class="hide" style="margin-top:10px;padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:color-mix(in oklab, var(--primary) 6%, var(--card))"></div>
    </div>
    <div class="sel-bar">
      <span class="t-muted" id="selCount"></span>
      <button class="btn btn-ghost btn-sm" id="selAll"></button>
    </div>
    <div class="sel-list">
      ${playlist.songs
        .map(
          (s, i) => `
        <button class="sel-row" data-toggle="${i}">
          <span class="box"></span>
          <span style="min-width:0">
            <span class="ti">${escapeHtml(s.title || "Untitled")}</span>
            ${s.artist ? `<span class="ar"> · ${escapeHtml(s.artist)}</span>` : ""}
          </span>
        </button>`
        )
        .join("")}
    </div>
    <div class="row-end">
      <button class="btn btn-primary" id="plImport"></button>
      <span class="helper" style="margin:0">Each song opens in a tab and is parsed individually.</span>
    </div>`;

  el.querySelectorAll("[data-target]").forEach((b) =>
    b.addEventListener("click", () => {
      state.target = b.dataset.target;
      syncTargetUI();
    })
  );
  el.querySelectorAll("[data-toggle]").forEach((b) =>
    b.addEventListener("click", () => {
      const i = Number(b.dataset.toggle);
      if (state.selected.has(i)) state.selected.delete(i);
      else state.selected.add(i);
      syncSelectionUI();
    })
  );
  $("selAll").addEventListener("click", () => {
    const all = state.selected.size === playlist.songs.length;
    state.selected = all ? new Set() : new Set(playlist.songs.map((_, i) => i));
    syncSelectionUI();
  });
  const exSel = $("existingPl");
  if (exSel)
    exSel.addEventListener("change", () => {
      state.existingPlaylistId = exSel.value || null;
      syncSelectionUI();
    });
  $("plImport").addEventListener("click", startPlaylistImport);

  populateExistingPicker(); // fill the <select> from whatever we've loaded so far
  syncTargetUI();           // toggles fields and cascades to selection + dup UI
}

// Fill the "Existing playlist" <select> from state.playlists (loaded async).
function populateExistingPicker() {
  const sel = $("existingPl");
  if (!sel) return;
  const pls = state.playlists || [];
  if (!pls.length) {
    sel.innerHTML = `<option value="">No playlists yet — choose “New playlist”</option>`;
    sel.disabled = true;
  } else {
    sel.disabled = false;
    sel.innerHTML =
      `<option value="">Choose a playlist…</option>` +
      pls.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${p.entries.length})</option>`).join("");
    sel.value = state.existingPlaylistId || "";
  }
  syncSelectionUI();
}

// Reflect the chosen target without rebuilding the panel.
function syncTargetUI() {
  const el = $("playlistSel");
  if (!el || !state.playlist) return;
  const toNewPlaylist = state.target === "playlist" || state.target === "both";
  const toExisting = state.target === "existing";
  el.querySelectorAll("[data-target]").forEach((b) =>
    b.classList.toggle("on", b.dataset.target === state.target)
  );
  const nameField = el.querySelector(".pl-name-field");
  if (nameField) nameField.classList.toggle("hide", !toNewPlaylist);
  const existingField = el.querySelector(".pl-existing-field");
  if (existingField) existingField.classList.toggle("hide", !toExisting);
  syncSelectionUI(); // refresh import-button disabled + dup notice for the new target
}

// Show/refresh the duplicate notice when importing into an existing playlist.
function syncDupUI() {
  const notice = $("dupNotice");
  if (!notice) return;
  const dest = (state.playlists || []).find((p) => p.id === state.existingPlaylistId);
  let dupCount = 0;
  if (state.target === "existing" && dest && state.playlist) {
    const keys = new Set(dest.entries.map((e) => songKey(e.song && e.song.title, e.song && e.song.artist)));
    dupCount = state.playlist.songs.filter(
      (s, i) => state.selected.has(i) && keys.has(songKey(s.title, s.artist))
    ).length;
  }
  if (dupCount === 0) {
    notice.classList.add("hide");
    notice.innerHTML = "";
    return;
  }
  const choices = [
    ["skip", "Skip duplicates", "Import only the songs not already there."],
    ["copy", "Add copies anyway", "Import everything, even duplicates."],
  ];
  notice.classList.remove("hide");
  notice.innerHTML = `
    <div style="font-weight:600;font-size:13px">${dupCount} of the selected ${dupCount === 1 ? "song is" : "songs are"} already in “${escapeHtml(dest.name)}”</div>
    <div class="t-muted" style="font-size:12px;margin:2px 0 8px">Matched by title and artist — choose what to do with the duplicates:</div>
    <div class="target-grid">
      ${choices
        .map(
          ([v, t, d]) =>
            `<button class="target-card ${state.dupMode === v ? "on" : ""}" data-dup="${v}">
               <div class="tt">${t}</div><div class="td">${d}</div></button>`
        )
        .join("")}
    </div>`;
  notice.querySelectorAll("[data-dup]").forEach((b) =>
    b.addEventListener("click", () => {
      state.dupMode = b.dataset.dup;
      syncDupUI();
    })
  );
}

// Reflect the current selection (rows, count, select-all label, import button)
// without touching the name input or the list's scroll position.
function syncSelectionUI() {
  const el = $("playlistSel");
  if (!el || !state.playlist) return;
  const { selected, playlist } = state;
  const total = playlist.songs.length;

  el.querySelectorAll("[data-toggle]").forEach((b) => {
    const on = selected.has(Number(b.dataset.toggle));
    b.classList.toggle("on", on);
    b.classList.toggle("off", !on);
    const box = b.querySelector(".box");
    if (box) box.textContent = on ? "✓" : "";
  });
  const count = $("selCount");
  if (count) count.textContent = `${selected.size} of ${total} selected`;
  const selAll = $("selAll");
  if (selAll) selAll.textContent = selected.size === total ? "Deselect all" : "Select all";
  const imp = $("plImport");
  if (imp) {
    imp.textContent = `Import ${selected.size} ${selected.size === 1 ? "song" : "songs"}`;
    const needPick = state.target === "existing" && !state.existingPlaylistId;
    imp.disabled = selected.size === 0 || needPick;
  }
  syncDupUI();
}

async function startPlaylistImport() {
  const { siteUrl, token } = await getSettings();
  if (!siteUrl || !token) return setError("Set the site URL + token in Settings first.");
  if (!state.playlist) return;
  const chosen = state.playlist.songs.filter((_, i) => state.selected.has(i));
  if (!chosen.length) return;
  const target = state.target;
  const name = ($("plName") && $("plName").value.trim()) || "Imported playlist";

  // Existing-playlist destination: append to the chosen playlist and apply the
  // duplicate (title+artist) handling. New/library targets create fresh copies.
  let playlistId = null;
  let playlistName = name;
  let dupMode = "copy";
  let existingKeys = [];
  if (target === "existing") {
    if (!state.existingPlaylistId) return setError("Pick a playlist to import into.");
    const dest = (state.playlists || []).find((p) => p.id === state.existingPlaylistId);
    if (!dest) return setError("That playlist no longer exists.");
    playlistId = dest.id;
    playlistName = dest.name;
    dupMode = state.dupMode;
    existingKeys = dest.entries.map((e) => songKey(e.song && e.song.title, e.song && e.song.artist));
  }

  const resp = await chrome.runtime.sendMessage({
    cmd: "startPlaylist",
    siteUrl,
    token,
    playlistName,
    target,
    songs: chosen,
    playlistId,
    dupMode,
    existingKeys,
  });
  if (!resp || !resp.ok) return setError((resp && resp.error) || "Could not start the import.");
  clearPlaylist();
  clearCandidates();
}

// ---- web-mode entry -------------------------------------------------------

async function processScraped(scraped, sourceUrl) {
  if (looksLikeChallenge(scraped.text)) {
    setError("This page is still showing a bot/captcha check. Solve it in the tab, then retry.");
    return;
  }
  pushProgress("Detecting page type…");
  await runStream("/import/auto-text", { text: scraped.text, links: scraped.links || [], url: sourceUrl }, (data) => {
    if (data.kind === "playlist") {
      const songs = data.songs || [];
      if (!songs.length) {
        setError("This looks like a collection, but no song links were detected.");
        return;
      }
      showPlaylist(sourceUrl, songs, scraped.title);
    } else {
      if (!data.body) {
        setError("The page did not contain chords/lyrics we could parse.");
        return;
      }
      showPreview(data);
    }
  });
}

async function submit() {
  const raw = $("entry").value.trim();
  if (!raw) return;
  setBusy(true);
  clearProgress();
  clearCandidates();
  clearPlaylist();
  clearPreview();
  setError("");
  try {
    if (looksLikeUrl(raw)) {
      const url = normalizeUrl(raw);
      pushProgress(`Opening ${url} in your browser…`);
      const scraped = await bgScrape(url);
      await processScraped(scraped, url);
    } else {
      pushProgress(`Searching the web for “${raw}”…`);
      await runStream("/import/search", { query: raw }, (data) => showCandidates(data.candidates || []));
    }
  } catch (e) {
    setError(`Import failed: ${e.message}`);
  } finally {
    setBusy(false);
  }
}


// ---- text / image mode ----------------------------------------------------

function onPickImage(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result || "");
    state.image = { dataUrl, base64: dataUrl.split(",")[1] || "", mediaType: file.type || "image/png", name: file.name };
    renderImage();
  };
  reader.onerror = () => setError("Couldn't read that image.");
  reader.readAsDataURL(file);
}
function renderImage() {
  if (state.image) {
    $("imagePick").classList.add("hide");
    $("imageCard").classList.remove("hide");
    $("imageThumb").src = state.image.dataUrl;
    $("imageName").textContent = state.image.name;
    $("imageType").textContent = state.image.mediaType;
    $("pasted").disabled = true;
    $("convertHint").textContent = "The image is read with vision and parsed into chords.";
  } else {
    $("imagePick").classList.remove("hide");
    $("imageCard").classList.add("hide");
    $("pasted").disabled = false;
    $("convertHint").textContent = "Pasted text is parsed into chords.";
  }
  $("convert").disabled = state.busy || (!state.image && !$("pasted").value.trim());
}

async function convertTextImage() {
  setBusy(true);
  clearProgress();
  clearPreview();
  setError("");
  try {
    if (state.image) {
      pushProgress("Reading image…");
      await runStream(
        "/import/extract-image",
        { imageData: state.image.base64, mediaType: state.image.mediaType },
        (song) => showPreview(song)
      );
    } else {
      const text = $("pasted").value.trim();
      if (!text) return;
      pushProgress("Parsing pasted text…");
      await runStream("/import/extract-text", { text, url: "" }, (song) => {
        if (!song || !song.body) {
          setError("No chords or lyrics were found in the pasted text.");
          return;
        }
        showPreview(song);
      });
    }
  } catch (e) {
    setError(`Convert failed: ${e.message}`);
  } finally {
    setBusy(false);
  }
}

// ---- mode switch ----------------------------------------------------------

function setMode(mode) {
  state.mode = mode;
  $("segWeb").classList.toggle("on", mode === "web");
  $("segText").classList.toggle("on", mode === "textimage");
  $("tabWeb").classList.toggle("hide", mode !== "web");
  $("tabText").classList.toggle("hide", mode !== "textimage");
  $("subText").textContent =
    mode === "web"
      ? "Paste a link or describe what you're looking for."
      : "Paste raw chord text or upload an image, then convert it.";
  setError("");
  clearPreview();
}

// ---- background job panel -------------------------------------------------

function renderJob(job) {
  const el = $("job");
  if (!job || job.status === "idle") {
    el.innerHTML = "";
    return;
  }
  const done = job.doneCount || 0;
  const failed = (job.failed || []).length;
  const total = job.total || 0;
  const pct = total ? Math.round(((done + failed) / total) * 100) : 0;
  let head = "";
  if (job.status === "running") {
    const c = job.current;
    const step = c ? `${c.step === "solve-captcha" ? "⚠ solve captcha" : c.step}: ${c.title || ""}` : "starting…";
    head = `Importing “${job.playlistName}” — ${done + failed}/${total}\n${step}`;
  } else if (job.status === "done") {
    head = `Done “${job.playlistName}” — ${done} imported, ${failed} failed.`;
  } else if (job.status === "error") {
    head = `Error: ${job.error || "unknown"}`;
  }
  const cancelBtn =
    job.status === "running" ? `<button class="btn btn-destructive btn-sm" id="cancelJob">Cancel</button>` : "";
  el.innerHTML = `
    <div class="card">
      <div class="job-head">
        <div class="t-small" style="white-space:pre-wrap;${job.status === "error" ? "color:var(--destructive)" : ""}">${escapeHtml(head)}</div>
        ${cancelBtn}
      </div>
      <div class="bar"><div style="width:${pct}%"></div></div>
      <div class="log">${escapeHtml((job.log || []).join("\n"))}</div>
    </div>`;
  const cb = $("cancelJob");
  if (cb) cb.addEventListener("click", () => chrome.runtime.sendMessage({ cmd: "cancel" }));
}

// ---- init -----------------------------------------------------------------

async function init() {
  if (IS_WINDOWED) document.body.classList.add("windowed");

  $("segWeb").addEventListener("click", () => setMode("web"));
  $("segText").addEventListener("click", () => setMode("textimage"));
  $("go").addEventListener("click", submit);
  $("entry").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
  $("convert").addEventListener("click", convertTextImage);
  $("pasted").addEventListener("input", () => {
    $("convert").disabled = state.busy || (!state.image && !$("pasted").value.trim());
  });
  $("imageInput").addEventListener("change", (e) => {
    onPickImage(e.target.files && e.target.files[0]);
    e.target.value = "";
  });
  $("imageRemove").addEventListener("click", () => {
    state.image = null;
    renderImage();
  });
  $("opts").addEventListener("click", () => chrome.runtime.openOptionsPage());

  const ow = $("openWindow");
  if (ow && !IS_WINDOWED) {
    ow.hidden = false;
    ow.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ cmd: "openWindow" });
      window.close();
    });
  }

  // Prefill the entry with the current tab URL as a convenience.
  const tab = await getTargetTab();
  if (tab && tab.url && /^https?:/i.test(tab.url)) $("entry").value = tab.url;

  renderImage();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "jobUpdate") renderJob(msg.job);
  });
  const resp = await chrome.runtime.sendMessage({ cmd: "getJob" }).catch(() => null);
  if (resp && resp.job) renderJob(resp.job);
}

init();
