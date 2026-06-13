/* HTTP client — JWT token storage + fetch wrapper */

window.IT = window.IT || {};

const TOKEN_KEY = 'chords_token';
const SERVER_KEY = 'chords_server';

// Backend base URL. Empty on the web build (served same-origin → relative
// `/api`). The native (Tauri) app has its own origin, so the user enters the
// server URL once; it's persisted here and prepended to every request. No
// default is baked in — the production domain never lives in the repo.
function getServer() {
  return localStorage.getItem(SERVER_KEY) || '';
}
function setServer(url) {
  let v = (url || '').trim().replace(/\/+$/, '');
  // A bare host with no scheme (e.g. "chords.example.com") would otherwise be
  // treated as a path relative to the app's own origin, so every request falls
  // through to the bundled UI and comes back as HTML — JSON.parse then throws
  // the cryptic "Unexpected token '<'". Default to https when no scheme given;
  // an explicit http:// (local dev server) is left as-is.
  if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
  if (v) localStorage.setItem(SERVER_KEY, v);
  else localStorage.removeItem(SERVER_KEY);
  return v;
}

// True when running inside the Tauri webview (vs a normal browser/PWA).
function isNative() {
  return !!(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

// Ephemeral id for THIS tab/session. Sent on every mutating request so the
// server can stamp the resulting SSE event with its origin; this tab then
// ignores its own echoes (see app.jsx) — only other sessions react.
const CLIENT_ID = (window.crypto && crypto.randomUUID)
  ? crypto.randomUUID()
  : String(Date.now()) + Math.random().toString(36).slice(2);

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

async function api(path, opts = {}) {
  const token = getToken();
  const res = await fetch(getServer() + '/api' + path, {
    method: opts.method || 'GET',
    headers: {
      ...(opts.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Client-Id': CLIENT_ID,
    },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = res.statusText;
    try { detail = JSON.parse(text).detail || detail; }
    catch (e) { if (/^\s*</.test(text)) detail = 'check the server address (got a web page, not API data)'; }
    const e = new Error(detail);
    e.status = res.status;
    throw e;
  }
  if (res.status === 204) return null;
  return jsonOrThrow(res);
}

// Parse a successful response as JSON, turning the native runtime's confusing
// "Unexpected token '<'" (what JSON.parse throws on an HTML page) into a clear
// message. Getting a web page back almost always means the server URL is wrong:
// the request fell through to a website or the app's own bundled UI, not the API.
async function jsonOrThrow(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch (e) {
    const looksHtml = /^\s*</.test(text) ||
      (res.headers.get('content-type') || '').includes('html');
    const err = new Error(looksHtml
      ? 'Got a web page instead of API data — check the server address.'
      : 'The server sent an invalid (non-JSON) response.');
    err.status = res.status;
    throw err;
  }
}

/* NDJSON streaming helper.
   Posts a JSON body to `path`, reads the response as newline-delimited JSON,
   and invokes onEvent(parsedObject) for each line. Throws on HTTP error. */
async function apiStream(path, body, onEvent, signal) {
  const token = getToken();
  const res = await fetch(getServer() + '/api' + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const e = new Error(payload.detail || res.statusText);
    e.status = res.status;
    throw e;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    if (signal?.aborted) { reader.cancel(); break; }
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();   // keep last (incomplete) line for next chunk
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { onEvent(JSON.parse(trimmed)); }
      catch (err) { console.warn('apiStream: bad line', trimmed); }
    }
  }
  if (buf.trim() && !signal?.aborted) {
    try { onEvent(JSON.parse(buf.trim())); } catch (err) {}
  }
}

/* Server-Sent Events reader.
   Opens a long-lived GET stream to `path` (with the JWT — which native
   EventSource can't send) and calls onEvent(parsedJSON) for each `data:` frame.
   Resolves when the server closes the stream; rejects on HTTP/network error.
   Pass an AbortSignal to close it (e.g. on logout). Comment frames (heartbeats,
   ": ping") are ignored. */
async function openEventStream(path, onEvent, signal) {
  const token = getToken();
  const res = await fetch(getServer() + '/api' + path, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal,
  });
  if (!res.ok) {
    const e = new Error(`event stream failed: ${res.status}`);
    e.status = res.status;
    throw e;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    if (signal?.aborted) { reader.cancel(); return; }
    const { value, done } = await reader.read();
    if (done) return;   // server closed the stream — caller may reconnect
    buf += decoder.decode(value, { stream: true });
    let sep;
    // SSE frames are separated by a blank line.
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const data = frame
        .split('\n')
        .filter(l => l.startsWith('data:'))
        .map(l => l.slice(5).trimStart())
        .join('\n');
      if (!data) continue;   // comment-only frame (heartbeat)
      try { onEvent(JSON.parse(data)); }
      catch (err) { console.warn('openEventStream: bad frame', frame); }
    }
  }
}

/* Trigger a browser download of `obj` as a pretty-printed .json file. */
function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the click a tick to start before revoking the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Open the OS file picker and resolve with the parsed JSON of the chosen file.
   Resolves null if the user cancels; rejects if the file isn't valid JSON. */
function pickJSONFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve(JSON.parse(reader.result)); }
        catch (e) { reject(new Error('That file isn’t valid JSON.')); }
      };
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.readAsText(file);
    };
    input.click();
  });
}

Object.assign(window.IT, {
  api, apiStream, openEventStream, getToken, setToken, clearToken, downloadJSON, pickJSONFile,
  getServer, setServer, isNative,
  clientId: CLIENT_ID,
});
