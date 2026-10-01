/* The follower's half of a playlist session, without React or the DOM.

   Two things decide whether a follower is where the leader is, and both live
   here so they can be run under node against a network that drops, delays and
   reorders (server/tests/session-sync.sim.js):

     - what a follower does with what it is told: an event from the stream, or a
       snapshot fetched from the server (app.jsx dispatches, this decides);
     - the follower's clock: one frame's step toward the leader's anchor
       (stage-view.jsx runs it every animation frame).

   A classic script like the rest of the frontend: it defines one global,
   `SessionSync`, and exports the same object to node. Plain JS, so it needs no
   build step. */

(function (root) {
  'use strict';

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
  // The longest frame the clock will take in one step: a backgrounded tab must
  // not lurch.
  const MAX_DT = 0.1;

  // ---------------------------------------------------------------- the map --

  // Stamp a session with the local time its line was measured: when it
  // arrived, less the `age` the server says the line already had. The wire also
  // carries the server's `since`, but subtracting one machine's clock from
  // another's is how you get a song that starts four seconds in.
  function stamp(session, nowMs) {
    if (!session) return session;
    const age = (session.now && session.now.age) || 0;
    return { ...session, at: nowMs - age * 1000 };
  }

  // Whether `b` is the same running session as `a` — not one that was ended and
  // started again, whose version counts from 1 once more.
  function sameRun(a, b) {
    return !!a && !!b && a.startedAt === b.startedAt;
  }

  // Whether `incoming` would take `held` backwards: an answer that was
  // overtaken on the way. Versions only compare within one run of a session.
  // Strictly older: an older server moves the line without bumping the
  // version, so an equal one is not proof of an equal position.
  function older(held, incoming) {
    return sameRun(held, incoming) && typeof held.version === 'number'
      && typeof incoming.version === 'number' && incoming.version < held.version;
  }

  function index(list, nowMs) {
    const out = {};
    (list || []).forEach(s => { out[s.playlistId] = stamp(s, nowMs); });
    return out;
  }

  // A snapshot from the server (a GET, or the answer to the leader's own PUT).
  // One no newer than what is held is dropped: a slow GET must not undo a tick
  // that overtook it.
  function applySnapshot(map, id, session, nowMs) {
    if (older(map[id], session)) return map;
    return { ...map, [id]: stamp(session, nowMs) };
  }

  // The answer to GET /sessions after a reconnect: every live session there is.
  // Ones not in it have ended while this device was not listening.
  function reconcile(map, list, nowMs) {
    const out = {};
    (list || []).forEach(s => {
      const id = s.playlistId;
      out[id] = older(map[id], s) ? map[id] : stamp(s, nowMs);
    });
    return out;
  }

  function remove(map, id) {
    if (!(id in map)) return map;
    const n = { ...map };
    delete n[id];
    return n;
  }

  // The `session-tick` event: move the anchor of a session we already hold.
  // It carries the whole position, so everything the clock runs on — line,
  // playing, speed — comes from it, and the version moves with it. A tick from
  // an older server (no version) moves the line and the playing flag only.
  function applyTick(map, evt, nowMs) {
    const cur = map[evt.id];
    if (!cur || !cur.now) return map;
    const versioned = typeof evt.version === 'number';
    if (versioned && typeof cur.version === 'number' && evt.version <= cur.version) return map;
    const now = { ...cur.now, line: evt.line, playing: evt.playing };
    if (typeof evt.speed === 'number') now.speed = evt.speed;
    return {
      ...map,
      [evt.id]: { ...cur, now, at: nowMs - (evt.age || 0) * 1000,
                  ...(versioned ? { version: evt.version } : {}) },
    };
  }

  // What to do about one event from the stream. `online` is whether this device
  // thought it was online when the event arrived, `held` the session it holds
  // for the event's playlist. The caller carries the action out:
  //   { kind: 'resync' }            reload everything (the device was offline)
  //   { kind: 'resync-sessions' }   re-fetch the live sessions
  //   { kind: 'refetch', id }       re-fetch one session
  //   { kind: 'tick', evt }         applyTick(evt)
  //   null                          nothing
  function onEvent(evt, { online, held } = {}) {
    if (!evt || !evt.type) return null;
    // Every (re)connect: whatever was published while the stream was down is
    // gone (nothing is buffered), and a stream that ended cleanly or failed with
    // an HTTP error — a deploy — never told this device it was offline.
    if (evt.type === 'hello') return online ? { kind: 'resync-sessions' } : { kind: 'resync' };
    if (evt.type === 'session' && evt.id) return { kind: 'refetch', id: evt.id };
    if (evt.type === 'session-tick' && evt.id) {
      if (typeof evt.version !== 'number') return { kind: 'tick', evt };   // an older server
      if (!held || !held.now) return { kind: 'refetch', id: evt.id };
      if (typeof held.version === 'number') {
        if (evt.version <= held.version) return null;                     // already past it
        // A gap: something between what is held and this tick was missed.
        if (evt.version > held.version + 1) return { kind: 'refetch', id: evt.id };
      }
      if (!held.now.song || held.now.song.id !== evt.songId) return { kind: 'refetch', id: evt.id };
      return { kind: 'tick', evt };
    }
    return null;
  }

  // -------------------------------------------------------------- the clock --

  // The anchor the clock steers toward, from the session as held.
  function anchorOf(session) {
    const now = session && session.now;
    if (!now) return null;
    return { line: now.line, playing: !!now.playing, speed: now.speed || 1,
             at: session.at, song: now.song && now.song.id };
  }

  // Where the leader is at `nowMs`, by the anchor.
  function wanted(a, nowMs) {
    const pace = a.speed * 0.5;
    return a.playing ? a.line + ((nowMs - a.at) / 1000) * pace : a.line;
  }

  // One frame. `clock` is { line, song } and is updated in place; `dt` is the
  // real time since the previous frame, in seconds.
  //
  //   playing — run our own clock at the shared pace and correct toward the
  //             leader only FORWARD. The leader's reported line is always a
  //             little behind ours (it is measured, then travels), so "catch
  //             up" in both directions means twitching against the network.
  //   paused  — glide toward the anchor, so the few anchors a second of a hand
  //             scroll read as one movement.
  //
  // A jump only happens when the follower is really somewhere else: the leader
  // jumped (a fling back to the top), or this device fell far behind (it joined
  // mid-song, or its tab was asleep). That is BACK_JUMP lines either way, and
  // snaps deliberately. A new song always starts where the leader is on it:
  // the old song's line means nothing in the new one.
  function step(clock, a, dt, nowMs) {
    if (!a) return clock.line;
    dt = Math.min(MAX_DT, dt);
    const pace = a.speed * 0.5;
    const want = wanted(a, nowMs);
    if (clock.song !== a.song) {
      clock.song = a.song;
      clock.line = want;
      return want;
    }
    let line = clock.line;
    const diff = want - line;
    if (a.playing) {
      line += dt * pace;
      if (diff > BACK_JUMP || diff < -BACK_JUMP) line = want;
      else if (diff > DRIFT_LINES) line += Math.min(diff - DRIFT_LINES, dt * pace * CATCHUP);
    } else if (Math.abs(diff) > BACK_JUMP) {
      line = want;
    } else {
      line += diff * Math.min(1, dt * GLIDE);
    }
    clock.line = line;
    return line;
  }

  const SessionSync = {
    DRIFT_LINES, CATCHUP, GLIDE, BACK_JUMP, MAX_DT,
    stamp, index, applySnapshot, reconcile, remove, applyTick, onEvent,
    anchorOf, wanted, step,
  };
  root.SessionSync = SessionSync;
  if (typeof module !== 'undefined' && module.exports) module.exports = SessionSync;
})(typeof window !== 'undefined' ? window : globalThis);
