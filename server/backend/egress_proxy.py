"""The only way out for the import's headless browser.

Any signed-in account chooses the page the browser opens, and that page chooses
what the browser loads next: redirects, images and scripts, its own fetch() and
WebSocket calls. A check on the submitted URL (url_policy.py) sees none of
those, and a Playwright route handler misses redirect hops. So the browser is
launched with this proxy as its only route to the network (web_fetch.py), and
the proxy decides on every connection:

  * it resolves the host itself, and refuses the connection if any address is
    not a public one (loopback, private, link-local — Hetzner's metadata service
    at 169.254.169.254 among them — CGNAT, multicast, reserved), or is one of
    CHORDS_FETCH_DENY (the server's own public addresses);
  * it connects to the address it checked, so a name that resolves differently
    a moment later (DNS rebinding) gains nothing.

HTTPS goes through as a CONNECT tunnel, so the site sees Chrome's own TLS, and
anti-bot checks see nothing different. Plain HTTP is forwarded one request per
connection.
"""

from __future__ import annotations

import asyncio
import contextlib
import ipaddress
import logging
import os
import socket
from typing import Optional
from urllib.parse import urlsplit

logger = logging.getLogger("chords.egress")

_HEAD_LIMIT = 64 * 1024
_CONNECT_TIMEOUT = 10.0
_HOP_HEADERS = {b"proxy-connection", b"proxy-authorization", b"connection", b"keep-alive"}

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address


def _deny_list() -> list:
    """CHORDS_FETCH_DENY: addresses, networks or host names, comma or space
    separated. A name is resolved once, when the fetcher starts, to every
    address it has then; the server's own addresses change rarely, and a name
    keeps them out of the repository."""
    nets = []
    for item in os.environ.get("CHORDS_FETCH_DENY", "").replace(",", " ").split():
        try:
            nets.append(ipaddress.ip_network(item, strict=False))
            continue
        except ValueError:
            pass
        try:
            infos = socket.getaddrinfo(item, None, type=socket.SOCK_STREAM)
        except OSError as e:
            logger.error("CHORDS_FETCH_DENY: cannot resolve %r, so it is NOT refused: %s", item, e)
            continue
        for info in infos:
            nets.append(ipaddress.ip_network(info[4][0].split("%")[0]))
    return list(dict.fromkeys(nets))


DENY = _deny_list()

# (address, port) pairs let through although they are not public. For tests,
# which have no public server to fetch from; nothing else sets it.
_exempt: set[tuple[str, int]] = set()


def refusal(ip: IPAddress, port: int = 0) -> Optional[str]:
    """Why the browser may not connect to `ip`, or None if it may."""
    if (str(ip), port) in _exempt:
        return None
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    if any(ip in net for net in DENY):
        return "this server's own address"
    if not ip.is_global or ip.is_multicast:
        return "not a public address"
    return None


async def _resolve(host: str, port: int) -> list[IPAddress]:
    try:
        return [ipaddress.ip_address(host)]
    except ValueError:
        pass
    infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    # Drop an IPv6 zone ("fe80::1%eth0"); the address alone decides.
    return list(dict.fromkeys(ipaddress.ip_address(info[4][0].split("%")[0]) for info in infos))


class Refused(Exception):
    """A destination the browser may not reach. `reason` is what the page is
    told; the message, with the addresses it resolved to, is for the log only,
    since the page's text goes back to whoever submitted the URL."""

    def __init__(self, message: str, reason: str):
        super().__init__(message)
        self.reason = reason


async def _open(host: str, port: int):
    """Connect to `host`, but only if every address it resolves to is allowed."""
    try:
        addrs = await _resolve(host, port)
    except OSError as e:
        raise Refused(f"cannot resolve {host}: {e}", "the name does not resolve") from None
    if not addrs:
        raise Refused(f"cannot resolve {host}", "the name does not resolve")
    for ip in addrs:
        why = refusal(ip, port)
        if why:
            raise Refused(f"{host} is {ip}, {why}", why)
    last: Optional[Exception] = None
    for ip in addrs:
        try:
            return await asyncio.wait_for(asyncio.open_connection(str(ip), port),
                                          timeout=_CONNECT_TIMEOUT)
        except (OSError, asyncio.TimeoutError) as e:
            last = e
    raise ConnectionError(f"cannot connect to {host}:{port}: {last}")


def _split_host_port(authority: str, default_port: int) -> tuple[str, int]:
    parts = urlsplit("//" + authority)
    if not parts.hostname:
        raise ValueError(f"no host in {authority!r}")
    return parts.hostname, parts.port or default_port


async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
    except (ConnectionError, OSError):
        pass


async def _splice(a: tuple, b: tuple) -> None:
    """Copy both ways until either side is done, then close both."""
    (ar, aw), (br, bw) = a, b
    tasks = [asyncio.ensure_future(_pipe(ar, bw)), asyncio.ensure_future(_pipe(br, aw))]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()
        for w in (aw, bw):
            with contextlib.suppress(Exception):
                w.close()


async def _answer(writer: asyncio.StreamWriter, status: str, text: str) -> None:
    body = text.encode() + b"\n"
    writer.write(f"HTTP/1.1 {status}\r\nContent-Type: text/plain\r\n"
                 f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode() + body)
    with contextlib.suppress(Exception):
        await writer.drain()
        writer.close()


async def _handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        head = await reader.readuntil(b"\r\n\r\n")
    except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, ConnectionError):
        writer.close()
        return
    line, _, rest = head.partition(b"\r\n")
    try:
        method, target, version = line.decode("latin-1").split(" ", 2)
    except ValueError:
        return await _answer(writer, "400 Bad Request", "bad request line")

    try:
        if method.upper() == "CONNECT":
            host, port = _split_host_port(target, 443)
            upstream = await _open(host, port)
            writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            await writer.drain()
            return await _splice((reader, writer), upstream)

        url = urlsplit(target)
        if url.scheme.lower() != "http" or not url.hostname:
            return await _answer(writer, "400 Bad Request", f"not proxied: {target[:200]}")
        host, port = url.hostname, url.port or 80
        upstream = await _open(host, port)
    except Refused as e:
        logger.info("refused %s %s: %s", method, target[:200], e)
        return await _answer(writer, "403 Forbidden",
                             f"The import does not open this address: {e.reason}.")
    except (ValueError, ConnectionError) as e:
        return await _answer(writer, "502 Bad Gateway", str(e))

    # Plain HTTP: origin-form request line, hop-by-hop headers dropped, and one
    # request per connection, so the response ends when the server closes.
    path = url.path or "/"
    if url.query:
        path += "?" + url.query
    headers = [h for h in rest.split(b"\r\n")
               if h and h.split(b":", 1)[0].strip().lower() not in _HOP_HEADERS]
    ur, uw = upstream
    uw.write(f"{method} {path} {version}\r\n".encode("latin-1")
             + b"".join(h + b"\r\n" for h in headers) + b"Connection: close\r\n\r\n")
    await _splice((reader, writer), (ur, uw))


_server: Optional[asyncio.base_events.Server] = None


async def ensure_started() -> int:
    """Start the proxy on a loopback port, once per event loop; return the port."""
    global _server
    if _server is None or not _server.is_serving():
        _server = await asyncio.start_server(_handle, "127.0.0.1", 0, limit=_HEAD_LIMIT)
        port = _server.sockets[0].getsockname()[1]
        logger.info("egress proxy on 127.0.0.1:%d (deny list: %s)", port,
                    ", ".join(map(str, DENY)) or "none")
    return _server.sockets[0].getsockname()[1]
