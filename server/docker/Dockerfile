FROM python:3.12-slim

# Optional fast Debian mirror for the apt steps below — e.g. Hetzner's internal
# "mirror.hetzner.com" when building on a Hetzner host (much faster + free, but
# only reachable from Hetzner IPs). Empty by default so builds work anywhere; the
# rewrite persists in the image so the later `playwright --with-deps` apt also
# uses it. trixie ships the deb822 sources file; older images use sources.list.
ARG APT_MIRROR=

# Install Node.js (needed by the Claude Code CLI) and curl for NodeSource setup.
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
 && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# Claude Code CLI — invoked under the hood by the Python agent SDK
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user with UID/GID 1000 to match the typical host user
RUN groupadd --gid 1000 chords \
 && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash chords

WORKDIR /app

# Playwright browser cache lives in a shared location so it's reachable by the
# non-root container user without re-installing browsers as that user.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers

# Install Python deps, then the Playwright Chromium browser + its system deps.
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && playwright install --with-deps chromium \
 && chmod -R a+rX /opt/playwright-browsers

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
