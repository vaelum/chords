"""What the import may make the server's headless browser open.

Any signed-in account can submit a URL to the import routes, and the server
opens it in Chromium and hands back what it rendered. Left unchecked that is a
way to read the server's own files (`file:///chords-data/secrets.json`) and to
reach whatever the box can reach. Only `http` and `https` are fetched.
"""

from __future__ import annotations

from urllib.parse import urlsplit

ALLOWED_SCHEMES = ("http", "https")


def require_http_url(url: str) -> str:
    """The URL, stripped, if it is an absolute http(s) URL; ValueError otherwise."""
    url = (url or "").strip()
    try:
        parts = urlsplit(url)
    except ValueError as e:
        raise ValueError(f"not a valid URL: {e}") from None
    if parts.scheme.lower() not in ALLOWED_SCHEMES:
        raise ValueError("only http:// and https:// URLs can be imported")
    if not parts.hostname:
        raise ValueError("the URL has no host")
    return url

