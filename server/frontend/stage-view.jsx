/* The follower's screen in a playlist session: read-only, and it shows whatever
   the controlling device has OPEN — not only what it is playing.

   Why this is its own component rather than a mode of SongView: SongView's
   scroll loop is entangled with density mode, count-in, manual-pause and the
   local overrides (transpose, speed, gaps). None of that applies to a follower,
   which has exactly one job — be where the controller is — and parameterising
   that loop to also mean "obey someone else" would make the hard-to-reason-about
   part of this app harder. This is ~40 lines of constant-rate ticker instead.

   The sync is in *lines*, never pixels: pace is `speed * 0.5` lines per second
   on every device (song-view.jsx), so a phone and a laptop with different
   widths, fonts and wrapping agree without exchanging a single coordinate. */

const { useState: useStateST, useEffect: useEffectST, useRef: useRefST,
        useMemo: useMemoST, useCallback: useCallbackST } = React;

// How far the anchor line sits down the screen. Matches SongView's READ_ANCHOR,
// so the controller and the follower are reading at the same place on the page.
const STAGE_ANCHOR = 0.35;

// Drift beyond this many lines is corrected; below it, left alone. A follower
// that snapped to every tick would twitch six times a minute for no reason.
const DRIFT_LINES = 1.5;
const EASE_MS = 400;

function StageView({ playlist, session, store, onBack,
                    lyricSize, setLyricSize, sideSpace, setSideSpace }) {
  const scrollRef = useRefST(null);
  const contentRef = useRefST(null);
  const lineTopsRef = useRefST([]);
  const linesHRef = useRefST(0);
  const rafRef = useRefST(0);
  // The follower's own clock: which line it believes it is on, as a float.
  const lineRef = useRefST(0);
  const easeRef = useRefST(null);     // {from, to, start} while catching up

  const now = session ? session.now : null;
  const song = now ? now.song : null;
  const playing = !!(now && now.playing);
  const speed = now ? (now.speed || 1) : 1;
  const controllerIsMe = !!(session && session.controllerUserId === (store.currentUser || {}).id);
  const following = !session ? ''
    : controllerIsMe ? 'your other device'
    : session.controllerName;

  const parsedLines = useMemoST(
    () => window.IT.parseSong((song && song.body) || ''),
    [song && song.body]
  );

  // Keep the screen awake unconditionally here. A follower is a music stand:
  // nobody taps it for the length of a set, which is exactly when a phone
  // decides you have gone away.
  useEffectST(() => {
    if (!('wakeLock' in navigator)) return;
    let sentinel = null, cancelled = false;
    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen');
        sentinel.addEventListener('release', () => { sentinel = null; });
      } catch (e) { /* denied or not permitted — nothing to do */ }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !sentinel && !cancelled) acquire();
    };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (sentinel) { sentinel.release().catch(() => {}); sentinel = null; }
    };
  }, []);

  // Same measurement as SongView's measureLines: every line's top, scroll
  // invariant, so line → pixels costs no DOM work per frame.
  const measure = useCallbackST(() => {
    const el = scrollRef.current, cont = contentRef.current;
    if (!el || !cont) return;
    const elTop = el.getBoundingClientRect().top;
    const sTop = el.scrollTop;
    const kids = cont.children;
    const tops = new Array(kids.length);
    for (let k = 0; k < kids.length; k++) {
      tops[k] = kids[k].getBoundingClientRect().top - elTop + sTop;
    }
    lineTopsRef.current = tops;
    linesHRef.current = cont.scrollHeight;
  }, []);

  useEffectST(() => {
    measure();
    const cont = contentRef.current;
    if (!cont || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(cont);
    return () => ro.disconnect();
  }, [parsedLines, lyricSize, measure]);

  // line (float) → scrollTop, interpolating between the two lines it falls
  // between so the page moves smoothly rather than a line at a time.
  const scrollToLine = useCallbackST((line) => {
    const el = scrollRef.current, tops = lineTopsRef.current;
    if (!el || !tops.length) return;
    const i = Math.max(0, Math.min(tops.length - 1, Math.floor(line)));
    const next = i + 1 < tops.length ? tops[i + 1] : tops[i] + (linesHRef.current / tops.length);
    const y = tops[i] + (next - tops[i]) * (line - i);
    el.scrollTop = Math.max(0, y - el.clientHeight * STAGE_ANCHOR);
  }, []);

  // A new anchor arrived (a song opened, play, pause, a tick, or this screen
  // just opened). `session.at` is when THIS device heard it — never the
  // server's `since`, which belongs to another machine's clock.
  useEffectST(() => {
    if (!now) return;
    const elapsed = playing ? Math.max(0, (Date.now() - (session.at || Date.now())) / 1000) : 0;
    const remote = now.line + elapsed * (speed * 0.5);
    const local = lineRef.current;
    // Snap on a song change or a big jump; ease a small correction so ordinary
    // play never visibly jerks.
    if (!playing || Math.abs(remote - local) > DRIFT_LINES * 4) {
      lineRef.current = remote;
      easeRef.current = null;
      scrollToLine(remote);
    } else if (Math.abs(remote - local) > DRIFT_LINES) {
      easeRef.current = { from: local, to: remote, start: performance.now() };
    }
  }, [now && now.since, now && now.song && now.song.id, playing, session && session.at]);

  // The clock. Runs only while the controller is playing — a follower parked on
  // an open song must cost nothing and must not creep.
  useEffectST(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      return;
    }
    let last = 0;
    const tick = (ts) => {
      if (!last) last = ts;
      const dt = (ts - last) / 1000;
      last = ts;
      const ease = easeRef.current;
      if (ease) {
        const t = Math.min(1, (ts - ease.start) / EASE_MS);
        // The target keeps moving while we catch up to it, so add the pace.
        const to = ease.to + ((ts - ease.start) / 1000) * (speed * 0.5);
        lineRef.current = ease.from + (to - ease.from) * t;
        if (t >= 1) easeRef.current = null;
      } else {
        lineRef.current += dt * (speed * 0.5);
      }
      scrollToLine(lineRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = 0; };
  }, [playing, speed, scrollToLine]);

  // The same per-device tweaks the song view uses, so a phone that likes big
  // text keeps it here. Two controls and no more: this screen is for reading.
  const setSize = (n) => setLyricSize(Math.max(12, Math.min(34, n)));
  const setSide = (n) => setSideSpace(Math.max(0, Math.min(120, n)));

  const title = playlist ? playlist.name : 'Session';

  // Ended: say so and leave the screen standing. Closing it under someone
  // mid-song is worse than a dead end with a way out.
  if (!session) {
    return (
      <div className="stage-shell">
        <div className="stage-head">
          <IconBtn icon="back" label="Back" onClick={onBack} />
          <div className="stage-head-text"><div className="stage-title">{title}</div></div>
        </div>
        <Empty icon="broadcast" title="Session ended"
               desc="The controlling device stopped the session."
               action={<Btn variant="primary" onClick={onBack}>Back to playlist</Btn>} />
      </div>
    );
  }

  return (
    <div className="stage-shell">
      <div className="stage-head">
        <IconBtn icon="back" label="Leave" onClick={onBack} />
        <div className="stage-head-text">
          <div className="stage-title">{song ? song.title : title}</div>
          <div className="stage-sub">
            {song && song.artist ? <span>{song.artist} · </span> : null}
            <span className="stage-following">Following {following}</span>
            {song && !playing ? <span className="stage-paused"> · paused</span> : null}
          </div>
        </div>
        <div className="stage-actions">
          {store.online === false && <OfflinePill />}
          <IconBtn icon="minus" label="Smaller text" onClick={() => setSize(lyricSize - 1)} />
          <IconBtn icon="plus" label="Bigger text" onClick={() => setSize(lyricSize + 1)} />
          <IconBtn icon="spacing" label="Margins"
                   onClick={() => setSide(sideSpace >= 96 ? 0 : sideSpace + 24)} />
        </div>
      </div>

      {!song && (
        <Empty icon="broadcast" title="Waiting for the first song"
               desc={`${following === 'your other device' ? 'Your other device' : following} hasn't opened a song yet.`} />
      )}

      {song && (
        <div className="sv-scroll stage-scroll" ref={scrollRef}
             style={{ '--side-space': sideSpace + 'px' }}>
          {/* No onChordTap: a follower's screen is read-only, and a popup would
              sit there while the song scrolled out from under it. */}
          <SongBody lines={parsedLines} lyricSize={lyricSize} contentRef={contentRef} />
        </div>
      )}
    </div>
  );
}

window.StageView = StageView;
