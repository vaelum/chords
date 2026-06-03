import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


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

# Serve the frontend — must be last so API routes take priority
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
