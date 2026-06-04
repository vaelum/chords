import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

# Send our own diagnostic logs (import timing, browser phases) to stdout at INFO
# so they show up in `docker logs chords`. uvicorn doesn't add a root handler, so
# we attach one to the "chords" logger tree explicitly.
_chords_log = logging.getLogger("chords")
_chords_log.setLevel(logging.INFO)
if not _chords_log.handlers:
    _h = logging.StreamHandler(sys.stdout)
    _h.setFormatter(logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s"))
    _chords_log.addHandler(_h)
    _chords_log.propagate = False

from .startup import init_db, init_secrets, create_admin_if_needed
from .routers.users import router as users_router, auth_router
from .routers.songs import router as songs_router
from .routers.playlists import router as playlists_router
from .routers.inbox import router as inbox_router
from .routers.import_routes import router as import_router
from .routers.invites import router as invites_router
from .routers.transfer import router as transfer_router
from .routers.events import router as events_router
from .routers.public import router as public_router
from .version import BUILD_ID

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

# index.html with this build's id injected, rendered once at import (BUILD_ID is
# constant for the life of the process). The client reads window.__BUILD_ID__ to
# learn which build it loaded, then compares it against the id the /events stream
# reports on (re)connect — a mismatch after a deploy triggers the reload prompt.
_INDEX_HTML = (FRONTEND_DIR / "index.html").read_text(encoding="utf-8").replace(
    "</head>",
    f'  <script>window.__BUILD_ID__ = "{BUILD_ID}";</script>\n</head>',
    1,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    init_secrets()
    create_admin_if_needed()
    yield


app = FastAPI(title="chords API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(songs_router, prefix="/api")
app.include_router(playlists_router, prefix="/api")
app.include_router(inbox_router, prefix="/api")
app.include_router(import_router, prefix="/api")
app.include_router(invites_router, prefix="/api")
app.include_router(transfer_router, prefix="/api")
app.include_router(events_router, prefix="/api")
app.include_router(public_router, prefix="/api")

@app.get("/api/version", include_in_schema=False)
async def version():
    """Current build id, so a client can detect when the server has newer assets
    than the page it loaded."""
    return {"build": BUILD_ID}


# Serve the entry HTML through our own handler so the build id is injected. Must
# be registered before the catch-all static mount below (routes match in order).
@app.get("/", include_in_schema=False)
@app.get("/index.html", include_in_schema=False)
async def index():
    return HTMLResponse(_INDEX_HTML)


# Serve the frontend — must be last so API routes take priority
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
