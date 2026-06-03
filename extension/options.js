// Options: store the site URL + auth token.
// The web app keeps its JWT in localStorage["chords_token"] (see frontend/api.js),
// so we offer a one-click grab from the currently focused app tab.

const $ = (id) => document.getElementById(id);

async function load() {
  const s = await chrome.storage.local.get({ siteUrl: "", token: "" });
  $("siteUrl").value = s.siteUrl;
  $("token").value = s.token;
}

async function save() {
  await chrome.storage.local.set({
    siteUrl: $("siteUrl").value.trim(),
    token: $("token").value.trim(),
  });
  flash("Saved.");
}

function flash(msg, ok = true) {
  const el = $("status");
  el.textContent = msg;
  el.style.color = ok ? "var(--primary)" : "var(--destructive)";
  setTimeout(() => (el.textContent = ""), 3000);
}

// Runs in the app tab's page context.
function readToken() {
  return localStorage.getItem("chords_token");
}

// The Options page is itself the active tab (and a chrome-extension:// page we
// can't script), so we can't read "the active tab". Instead scan open http(s)
// tabs — preferring ones matching the configured Site URL origin — and grab the
// token from the first logged-in app tab we find.
async function grabToken() {
  let originFilter = null;
  const site = $("siteUrl").value.trim();
  if (site) {
    try {
      originFilter = new URL(site).origin;
    } catch {
      /* ignore malformed url */
    }
  }

  const httpTabs = (await chrome.tabs.query({})).filter(
    (t) => t.id != null && t.url && /^https?:/i.test(t.url)
  );
  const matched = originFilter
    ? httpTabs.filter((t) => {
        try {
          return new URL(t.url).origin === originFilter;
        } catch {
          return false;
        }
      })
    : [];
  const ordered = matched.length ? matched : httpTabs;

  if (!ordered.length) {
    return flash("Open the Chords app in a tab and log in first.", false);
  }

  for (const tab of ordered) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: readToken,
      });
      if (result) {
        $("token").value = result;
        if (!$("siteUrl").value.trim()) {
          try {
            $("siteUrl").value = new URL(tab.url).origin;
          } catch {
            /* leave blank */
          }
        }
        await save();
        return flash("Token grabbed and saved.");
      }
    } catch {
      // tab not scriptable (restricted scheme), skip it
    }
  }
  flash("No logged-in Chords tab found. Open the app, log in, then retry.", false);
}

$("save").addEventListener("click", save);
$("grab").addEventListener("click", grabToken);
load();
