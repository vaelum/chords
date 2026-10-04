#!/usr/bin/env python3
"""Where the import's headless browser may connect (backend/egress_proxy.py).

A page any account submits can redirect the browser, load images and frames,
and call fetch() itself. All of it goes through the egress proxy, which refuses
any destination that is not a public address. Three layers here:

  [1] the address rules on their own;
  [2] the proxy, spoken to directly, plain HTTP and CONNECT;
  [3] a real Chromium through web_fetch: a "public" page that redirects to, and
      loads subresources from, 127.0.0.1, 10.0.0.1, 169.254.169.254 and
      forgejo:3000 gets no answer from any of them, and still imports.

There is no public server in a test, so one loopback port is exempted to stand
for the internet. [3] needs Playwright's Chromium and says so if it is missing.

    python butler.py server test        # or: python server/tests/test_egress.py
"""

import asyncio
import ipaddress
import os
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import SERVER_DIR  # noqa: E402,F401  (path setup)

os.environ["CHORDS_FETCH_DENY"] = "203.0.113.7/32, 2001:db8:1::1"
os.environ["CHORDS_BROWSER_PROFILE_DIR"] = tempfile.mkdtemp(prefix="chords-egress-profile-")
os.environ["CHORDS_BROWSER_CHANNEL"] = ""
os.environ["CHORDS_BROWSER_IDLE_TIMEOUT"] = "0"

import httpx  # noqa: E402

from backend import egress_proxy  # noqa: E402

FAILURES: list[str] = []


def check(name, cond, detail=""):
    print(f"  {'ok  ' if cond else 'FAIL'}  {name}" + (f"  [{detail}]" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


# --- two local servers: the "internet", and something private -----------------

SECRET_HITS: list[str] = []


class Secret(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        SECRET_HITS.append(self.path)
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"<pre>SECRET jwt_secret=hunter2</pre>")


def _serve(handler) -> int:
    srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_port


SECRET = _serve(Secret)
PRIVATE_TARGETS = [
    f"http://127.0.0.1:{SECRET}/loopback",
    f"http://localhost:{SECRET}/localhost",
    f"http://forgejo:{SECRET}/forgejo",          # resolved to loopback below
    "http://10.0.0.1/private",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]:%d/v6" % SECRET,
]


# A file on this machine, as secrets.json is on the server. Chromium refuses
# file:// to a page from an http(s) origin by itself (the proxy never sees it);
# this is here to notice if that ever stops being true.
_FILE = Path(tempfile.mkdtemp(prefix="chords-egress-file-")) / "secrets.json"
_FILE.write_text('{"SECRET": "jwt_secret=hunter2"}')
FILE_TARGET = _FILE.as_uri()
BROWSER_TARGETS = PRIVATE_TARGETS + [FILE_TARGET]


class Public(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.startswith("/redirect/"):
            self.send_response(302)
            self.send_header("Location", BROWSER_TARGETS[int(self.path.rsplit("/", 1)[1])])
            self.end_headers()
            return
        tags = "".join(f'<img src="{u}"><iframe src="{u}"></iframe>' for u in BROWSER_TARGETS)
        calls = "".join(f'fetch("{u}").then(r => r.text()).then(t => document.title = t)'
                        f'.catch(() => {{}});' for u in BROWSER_TARGETS)
        body = (f"<html><body><h1>Wish You Were Here</h1><pre>[G]So, so you think "
                f"you can tell heaven from hell</pre>{tags}<script>{calls}</script>"
                f"</body></html>").encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


PUBLIC = _serve(Public)
egress_proxy._exempt.add(("127.0.0.1", PUBLIC))

_real_resolve = egress_proxy._resolve


async def _resolve(host, port):
    # forgejo is a name on the server's `edge` network; here it is loopback.
    if host == "forgejo":
        return [ipaddress.ip_address("127.0.0.1")]
    return await _real_resolve(host, port)


egress_proxy._resolve = _resolve


def cases_rules():
    print("\n[1] the address rules")
    for a in ("127.0.0.1", "127.8.9.10", "::1", "10.0.0.1", "172.16.5.4", "192.168.1.1",
              "169.254.169.254", "fe80::1", "fc00::1", "100.64.0.1", "0.0.0.0", "::",
              "::ffff:127.0.0.1", "::ffff:169.254.169.254", "224.0.0.1", "ff02::1",
              "192.0.2.1", "255.255.255.255"):
        check(f"{a} refused", egress_proxy.refusal(ipaddress.ip_address(a)) is not None)
    for a in ("203.0.113.7", "2001:db8:1::1"):
        check(f"{a} refused as this server's own",
              egress_proxy.refusal(ipaddress.ip_address(a)) == "this server's own address")
    for a in ("1.1.1.1", "93.184.215.14", "2606:4700:4700::1111"):
        check(f"{a} allowed", egress_proxy.refusal(ipaddress.ip_address(a)) is None)


async def cases_proxy():
    print("\n[2] the proxy itself")
    port = await egress_proxy.ensure_started()
    proxy = f"http://127.0.0.1:{port}"
    async with httpx.AsyncClient(proxy=proxy, timeout=10) as c:
        r = await c.get(f"http://127.0.0.1:{PUBLIC}/")
        check("a public page comes through", r.status_code == 200 and "Wish You" in r.text,
              r.status_code)
        for u in PRIVATE_TARGETS:
            r = await c.get(u)
            # 403, or 400 for [::1]: httpx writes an IPv6 literal without its
            # brackets in a proxy request, which the proxy cannot parse.
            check(f"GET {u} refused", r.status_code in (400, 403), r.status_code)
            # The refusal becomes the page's text, which goes back to whoever
            # submitted the URL: it names no address the proxy resolved.
            check(f"GET {u}: the refusal names no address", "127.0.0.1" not in r.text, r.text)

    # CONNECT, as Chromium does for https:// and WebSockets.
    for target in (f"127.0.0.1:{SECRET}", "10.0.0.1:443", "169.254.169.254:80",
                   f"forgejo:{SECRET}", f"[::1]:{SECRET}", "localhost:443"):
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.write(f"CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n\r\n".encode())
        await writer.drain()
        status = (await reader.readline()).decode().strip()
        writer.close()
        check(f"CONNECT {target} refused", status.startswith("HTTP/1.1 403"), status)

    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write(f"CONNECT 127.0.0.1:{PUBLIC} HTTP/1.1\r\n\r\n".encode())
    await writer.drain()
    status = (await reader.readline()).decode().strip()
    await reader.readline()
    writer.write(b"GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
    await writer.drain()
    tunnelled = await reader.read()
    writer.close()
    check("CONNECT to a public address tunnels", status.endswith("200 Connection Established")
          and b"Wish You" in tunnelled, status)
    check("the private server saw nothing", SECRET_HITS == [], SECRET_HITS)


async def cases_browser():
    print("\n[3] a real Chromium through web_fetch")
    from backend import web_fetch
    try:
        page = await web_fetch.fetch_rendered_full(f"http://127.0.0.1:{PUBLIC}/", timeout_ms=20000)
    except Exception as e:
        if "Executable doesn't exist" in str(e) or "Could not launch browser" in str(e):
            print(f"  skip  no Chromium for Playwright here ({type(e).__name__})")
            return
        raise
    check("the public page imports", "Wish You Were Here" in page["text"]
          and "heaven from hell" in page["text"], page["text"][:200])
    check("no subresource, frame or fetch() reached a private address",
          SECRET_HITS == [], SECRET_HITS)
    check("nothing private was rendered", "SECRET" not in page["html"]
          and "SECRET" not in page["title"], page["title"])

    for i, target in enumerate(BROWSER_TARGETS):
        page = await web_fetch.fetch_rendered_full(f"http://127.0.0.1:{PUBLIC}/redirect/{i}",
                                                   timeout_ms=15000)
        check(f"a redirect to {target} gets no answer",
              "SECRET" not in page["text"] and "SECRET" not in page["html"], page["text"][:120])
    check("the private server saw nothing, after all of it", SECRET_HITS == [], SECRET_HITS)
    await web_fetch._close_context()


async def run() -> int:
    cases_rules()
    await cases_proxy()
    await cases_browser()
    print()
    if FAILURES:
        print(f"*** {len(FAILURES)} FAILED: " + "; ".join(FAILURES))
        return 1
    print("ALL EGRESS CHECKS PASSED")
    return 0


def test_egress():
    """pytest entry point."""
    assert asyncio.run(run()) == 0, FAILURES


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
