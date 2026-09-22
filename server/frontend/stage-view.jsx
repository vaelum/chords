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
// that answered every tick would twitch six times a minute for no reason.
const DRIFT_LINES = 1.5;
// How much faster than the song's own pace a correction may run: a catch-up is
// meant to be unnoticeable, so half again as fast, not a lurch.
const CATCHUP = 0.5;
// Per-second lerp toward a paused anchor. ~6 covers a hand-scroll's worth of
// movement in a couple of hundred milliseconds without ever looking abrupt.
const GLIDE = 6;
// Beyond this the leader did not drift, they MOVED — a new song, a fling back
// to the top — and following means going there at once rather than gliding.
const BACK_JUMP = 8;

function StageView({ playlist, session, store, onBack,
                    lyricSize, setLyricSize, sideSpace, setSideSpace }) {
  const scrollRef = useRefST(null);
  const contentRef = useRefST(null);
  const lineTopsRef = useRefST([]);
  const linesHRef = useRefST(0);
  const rafRef = useRefST(0);
  // The follower's own clock: which line it believes it is on, as a float.
  const lineRef = useRefST(0);

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
  // between so the page moves by fractions of a line rather than a line at a
  // time. Always a direct write: no CSS smooth-scroll anywhere on this screen,
  // because the loop below writes scrollTop every frame and a smooth scroll
  // restarts its own animation on every write — two animations fighting, which
  // is the "runs on, then jumps back" the follower used to show.
  const scrollToLine = useCallbackST((line) => {
    const el = scrollRef.current, tops = lineTopsRef.current;
    if (!el || !tops.length) return;
    const i = Math.max(0, Math.min(tops.length - 1, Math.floor(line)));
    const next = i + 1 < tops.length ? tops[i + 1] : tops[i] + (linesHRef.current / tops.length);
    const y = tops[i] + (next - tops[i]) * (line - i);
    el.scrollTop = Math.max(0, y - el.clientHeight * STAGE_ANCHOR);
  }, []);

  // The last anchor heard, kept in a ref so the loop reads it without being
  // torn down and restarted on every tick. `at` is when THIS device heard it —
  // never the server's `since`, which is another machine's clock.
  const anchorRef = useRefST(null);
  useEffectST(() => {
    anchorRef.current = now
      ? { line: now.line, playing, speed, at: session.at || Date.now(),
          song: now.song && now.song.id }
      : null;
  }, [now && now.since, now && now.line, now && now.song && now.song.id,
      playing, speed, session && session.at]);

  // One loop for both states, which is what makes the follow smooth: there is
  // no second code path that can write a conflicting scrollTop.
  //
  //   playing — run our own clock at the shared pace and correct toward the
  //             leader only FORWARD. A correction backwards is what reads as a
  //             jump: the leader's reported line is always a little behind ours
  //             (it is measured, then travels), so "catch up" in both
  //             directions means twitching against the network. Being a
  //             fraction of a line early is invisible; going back a line is not.
  //   paused  — glide toward the anchor. The leader scrolling a paused song by
  //             hand sends a few anchors a second, and gliding turns those into
  //             one continuous movement instead of a flick-book.
  //
  // A jump back only happens when the leader really did jump: a new song, or a
  // fling back to the top. That is BACK_JUMP lines away and snaps deliberately.
  useEffectST(() => {
    if (!song) return;
    let last = 0;
    const tick = (ts) => {
      rafRef.current = requestAnimationFrame(tick);
      const a = anchorRef.current;
      if (!a) return;
      if (!last) last = ts;
      const dt = Math.min(0.1, (ts - last) / 1000);   // a backgrounded tab must not lurch
      last = ts;
      const pace = a.speed * 0.5;
      const want = a.playing ? a.line + ((Date.now() - a.at) / 1000) * pace : a.line;
      let line = lineRef.current;
      const diff = want - line;
      if (a.playing) {
        line += dt * pace;                       // our own clock, at the shared pace
        if (diff > DRIFT_LINES) line += Math.min(diff - DRIFT_LINES, dt * pace * CATCHUP);
        else if (diff < -BACK_JUMP) line = want; // the leader went back on purpose
      } else if (Math.abs(diff) > BACK_JUMP) {
        line = want;                             // a new song, or a fling
      } else {
        line += diff * Math.min(1, dt * GLIDE);
      }
      lineRef.current = line;
      scrollToLine(line);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = 0; };
  }, [song && song.id, scrollToLine]);

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

      {/* This element is not the viewer's to move: it mirrors another device.
          CSS keeps gestures out (.stage-scroll is overflow:hidden with
          touch-action:none), and the loop above is the only thing that ever
          writes scrollTop. */}
      {song && (
        <div className="sv-scroll stage-scroll" ref={scrollRef} tabIndex={-1}
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
