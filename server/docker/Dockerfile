# Two images from one file. `app` is the chords backend and frontend; it holds
# the data directory and has no browser. `fetcher` is the headless browser the
# import opens pages in (backend/fetcher.py); it has no data directory and only
# the code it runs. See the fetcher service in docker-compose.yml.

FROM python:3.12-slim AS base

# Optional fast Debian mirror for the apt steps below — e.g. Hetzner's internal
# "mirror.hetzner.com" when building on a Hetzner host (much faster + free, but
# only reachable from Hetzner IPs). Empty by default so builds work anywhere; the
# rewrite persists in the image so the later `playwright --with-deps` apt also
# uses it. trixie ships the deb822 sources file; older images use sources.list.
ARG APT_MIRROR=

# Apply the mirror rewrite up front so the later `playwright --with-deps` apt
# run uses it too. ca-certificates is needed for the outbound HTTPS calls to
# OpenRouter.
RUN if [ -n "$APT_MIRROR" ]; then \
      for f in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do \
        if [ -f "$f" ]; then \
          sed -i \
            -e "s|http://deb.debian.org/debian-security|http://${APT_MIRROR}/debian/security|g" \
            -e "s|http://deb.debian.org/debian|http://${APT_MIRROR}/debian/packages|g" \
            "$f"; \
        fi; \
      done; \
    fi \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Create non-root user with UID/GID 1000 to match the typical host user
RUN groupadd --gid 1000 chords \
 && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash chords

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# --------------------------------------------------------------------------- #
FROM base AS fetcher

# Playwright browser cache lives in a shared location so it's reachable by the
# non-root container user without re-installing browsers as that user.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
RUN playwright install --with-deps chromium \
 && chmod -R a+rX /opt/playwright-browsers

# Only what the fetcher runs: nothing here reads chords' data.
COPY --chown=1000:1000 backend/__init__.py backend/fetcher.py backend/web_fetch.py \
                       backend/egress_proxy.py backend/url_policy.py ./backend/

# The Playwright profile directory. It must exist in the IMAGE with the right
# owner: Docker seeds a fresh named volume from the image path it is mounted
# over, so without this the volume is created root-owned and the container —
# which runs as UID 1000 — cannot write its browser profile, and every import
# fails.
RUN mkdir -p /chords-browser-profile && chown 1000:1000 /chords-browser-profile
ENV CHORDS_BROWSER_PROFILE_DIR=/chords-browser-profile

USER 1000:1000

EXPOSE 8001

# Deliberately a SINGLE uvicorn worker, and it must stay that way.
# backend/web_fetch.py keeps the Playwright browser context in module globals
# and launches it with a persistent user_data_dir. Chromium takes an exclusive
# lock on that directory, so with --workers N only the first worker could launch
# a browser; the rest would fail, and imports would succeed or fail depending on
# which worker happened to serve the request.
CMD ["uvicorn", "backend.fetcher:app", "--host", "0.0.0.0", "--port", "8001"]

# --------------------------------------------------------------------------- #
# Last, so a build without --target is the app.
FROM base AS app

# Copy source
COPY --chown=1000:1000 backend/ ./backend/
COPY --chown=1000:1000 frontend/ ./frontend/

# Data directory — mount a host volume here
RUN mkdir -p /chords-data && chown 1000:1000 /chords-data
VOLUME ["/chords-data"]

ENV CHORDS_DATA_DIR=/chords-data

USER 1000:1000

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
