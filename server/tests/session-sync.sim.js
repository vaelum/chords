#!/usr/bin/env node
/*
 * The follower's half of a playlist session, run against a network that drops,
 * delays and reorders — on a fake clock, so a minute of song takes a
 * millisecond and every run is the same run.
 *
 * What runs is the real frontend/session-sync.js: the decisions app.jsx carries
 * out for each event and snapshot, and the per-frame step stage-view.jsx takes
 * toward the leader. Around it the script models the rest:
 *
 *   - a server holding the session, speaking the protocol planned in
 *     p-129695 ("full-tick"): every change bumps `version`, a tick names its
 *     song and carries the speed, and a snapshot says how old its line is
 *     (`age`). The server's own half is tested in test_session_sync.py;
 *   - a leader whose true position is known exactly;
 *   - an event stream that delivers in order (it is one TCP connection) after a
 *     latency, and that can go down; GETs with a latency of their own each way;
 *   - a follower that renders at 60 frames a second, unless its tab is
 *     throttled.
 *
 * Each scenario checks, every 100 ms over a window after the disturbance, that
 * the follower shows the leader's song and is within DRIFT_LINES of its line.
 *
 * Usage:  node server/tests/session-sync.sim.js [scenario …]
 * Exits 1 if any scenario fails.
 */
'use strict';

const path = require('path');
const SS = require(path.join(__dirname, '..', 'frontend', 'session-sync.js'));

const PL = 'pl-1';
const PACE = (speed) => speed * 0.5;       // lines per second, as on every device

// ------------------------------------------------------------ the fake world --

class World {
  constructor() {
    this.t = 0;                 // ms
    this.queue = [];            // [{t, n, fn}], kept sorted
    this.n = 0;
  }
  at(t, fn) {
    const ev = { t: Math.max(t, this.t), n: this.n++, fn };
    let i = this.queue.length;
    while (i > 0 && (this.queue[i - 1].t > ev.t ||
           (this.queue[i - 1].t === ev.t && this.queue[i - 1].n > ev.n))) i--;
    this.queue.splice(i, 0, ev);
  }
  after(ms, fn) { this.at(this.t + ms, fn); }
  run(until) {
    while (this.queue.length && this.queue[0].t <= until) {
      const ev = this.queue.shift();
      this.t = ev.t;
      ev.fn();
    }
    this.t = until;
  }
}

class Server {
  constructor(world) {
    this.w = world;
    this.version = 1;
    this.now = null;            // {song, line, speed, playing, since}
    this.stream = null;         // the follower's connection, when up
  }
  publish(evt) { if (this.stream) this.stream.send(evt); }
  setNow(song, line, speed, playing) {
    this.version++;
    this.now = { song: { id: song }, line, speed, playing, since: this.w.t };
    this.publish({ type: 'session', id: PL });
  }
  tick(song, line, speed, playing) {
    if (!this.now || this.now.song.id !== song) return false;   // refused: 409
    this.version++;
    Object.assign(this.now, { line, speed, playing, since: this.w.t });
    this.publish({ type: 'session-tick', id: PL, songId: song, version: this.version,
                   speed, line, playing, age: 0 });
    return true;
  }
  snapshot() {
    const n = this.now;
    return {
      playlistId: PL, version: this.version, startedAt: 0,
      now: n && { ...n, song: { ...n.song }, age: (this.w.t - n.since) / 1000 },
    };
  }
}

// An SSE stream: in order, after a latency.
class Stream {
  constructor(world, latency, deliver) {
    this.w = world; this.latency = latency; this.deliver = deliver; this.last = 0;
  }
  send(evt) {
    const t = Math.max(this.last, this.w.t + this.latency);
    this.last = t;
    const copy = JSON.parse(JSON.stringify(evt));
    this.w.at(t, () => this.deliver(copy));
  }
}

// The leader: where it truly is, and what it tells the server.
class Leader {
  constructor(world, server, { latency = 40 } = {}) {
    this.w = world; this.s = server; this.latency = latency;
    this.song = null; this.speed = 1; this.playing = false;
    this.line0 = 0; this.t0 = 0; this.beacon = null;
  }
  line(t = this.w.t) {
    return this.playing ? this.line0 + ((t - this.t0) / 1000) * PACE(this.speed) : this.line0;
  }
  _rebase(line) { this.line0 = line; this.t0 = this.w.t; }
  // The PUT is debounced 150 ms on the leader (app.jsx), then travels.
  open(song, { playing = true, speed = this.speed } = {}) {
    this._rebase(0);
    Object.assign(this, { song, playing, speed });
    const snap = { song, line: 0, speed, playing };
    this.w.after(150 + this.latency, () => this.s.setNow(snap.song, snap.line, snap.speed, snap.playing));
    this._beacons();
  }
  setSpeed(speed) {
    this._rebase(this.line());
    this.speed = speed;
    this.sendTick();
  }
  // A hand scroll while paused: the line moves, a tick goes out (250 ms
  // coalescing on the leader is left out: one call is one tick).
  scrollTo(line, { latency = this.latency } = {}) {
    this._rebase(line);
    this.sendTick({ latency });
  }
  sendTick({ latency = this.latency } = {}) {
    if (this.silent) return;
    const m = { song: this.song, line: this.line(), speed: this.speed, playing: this.playing };
    this.w.after(latency, () => this.s.tick(m.song, m.line, m.speed, m.playing));
  }
  _beacons() {
    if (this.beacon) this.beacon.stop = true;
    const b = { stop: false };
    this.beacon = b;
    const loop = () => {
      if (b.stop) return;
      if (this.playing) this.sendTick();
      this.w.after(10000, loop);
    };
    this.w.after(10000, loop);
  }
}

// The follower: app.jsx's dispatch around SessionSync, and stage-view's loop.
class Follower {
  constructor(world, server, { latency = 60, getLatency = 80 } = {}) {
    this.w = world; this.s = server;
    this.latency = latency; this.getLatency = getLatency;
    this.map = {};
    this.online = true;
    this.clock = { line: 0, song: null };
    this.lastFrame = null;
    this.throttledUntil = 0;
    this.frames = false;
  }
  // Open the stage view: connect, and GET the session outright (app.jsx).
  join() {
    this.connect();
    this.refetch(PL);
    this.startFrames();
  }
  connect() {
    this.s.stream = new Stream(this.w, this.latency, (e) => this.onEvent(e));
    this.s.publish({ type: 'hello' });
  }
  // How the stream went away decides what the client believes: only a
  // network error sets `online` to false (app.jsx, api.js isOffline).
  drop(how) {
    this.s.stream = null;
    if (how === 'offline') this.online = false;
  }
  // GET /sessions: every live session (one, here).
  refetchAll() {
    this.w.after(this.getLatency, () => {
      const list = this.s.now ? [this.s.snapshot()] : [];
      this.w.after(this.getLatency, () => { this.map = SS.reconcile(this.map, list, this.w.t); });
    });
  }
  refetch(id, { requestDelay = this.getLatency, responseDelay = this.getLatency } = {}) {
    this.w.after(requestDelay, () => {
      const snap = this.s.snapshot();
      this.w.after(responseDelay, () => {
        this.map = SS.applySnapshot(this.map, id, snap, this.w.t);
      });
    });
  }
  onEvent(evt) {
    const act = SS.onEvent(evt, { online: this.online, held: this.map[evt.id] });
    if (evt.type === 'hello') this.online = true;
    if (!act) return;
    if (act.kind === 'resync' || act.kind === 'resync-sessions') this.refetchAll();
    else if (act.kind === 'refetch') this.refetch(act.id);
    else if (act.kind === 'tick') this.map = SS.applyTick(this.map, act.evt, this.w.t);
  }
  startFrames() {
    if (this.frames) return;
    this.frames = true;
    const frame = () => {
      if (this.w.t >= this.throttledUntil) {
        const a = SS.anchorOf(this.map[PL]);
        const dt = this.lastFrame == null ? 0 : (this.w.t - this.lastFrame) / 1000;
        this.lastFrame = this.w.t;
        SS.step(this.clock, a, dt, this.w.t);
      }
      this.w.after(1000 / 60, frame);
    };
    this.w.after(0, frame);
  }
  throttle(ms) { this.throttledUntil = this.w.t + ms; }
  song() { const s = this.map[PL]; return s && s.now && s.now.song && s.now.song.id; }
}

// Checks the follower against the leader every 100 ms over [from, to] seconds.
function watch(world, leader, follower, from, to, errors) {
  for (let t = from * 1000; t <= to * 1000; t += 100) {
    world.at(t, () => {
      if (errors.length >= 3) return;
      const want = leader.line(), got = follower.clock.line;
      if (follower.song() !== leader.song) {
        errors.push(`t=${(world.t / 1000).toFixed(1)}s shows ${follower.song()}, leader is on ${leader.song}`);
      } else if (Math.abs(want - got) > SS.DRIFT_LINES) {
        errors.push(`t=${(world.t / 1000).toFixed(1)}s at line ${got.toFixed(2)}, leader at ${want.toFixed(2)}`);
      }
    });
  }
}

function setup(opts = {}) {
  const w = new World();
  const s = new Server(w);
  const leader = new Leader(w, s, opts.leader);
  const follower = new Follower(w, s, opts.follower);
  return { w, s, leader, follower, errors: [] };
}

// ---------------------------------------------------------------- scenarios --

const SCENARIOS = {
  // Nothing goes wrong: the baseline every other scenario departs from.
  'steady'() {
    const x = setup();
    x.leader.open('song-1');
    x.w.at(500, () => x.follower.join());
    watch(x.w, x.leader, x.follower, 2, 60, x.errors);
    x.w.run(60000);
    return x.errors;
  },

  // Joining 8 s after the last beacon: the snapshot's line is 8 s old.
  'join mid-song'() {
    const x = setup();
    x.leader.open('song-1');
    x.w.at(28000, () => x.follower.join());
    watch(x.w, x.leader, x.follower, 30, 40, x.errors);
    x.w.run(40000);
    return x.errors;
  },

  // A new song 10 s into the old one: 5 lines in, less than a jump back.
  'song change'() {
    const x = setup();
    x.leader.open('song-1');
    x.w.at(100, () => x.follower.join());
    x.w.at(10000, () => x.leader.open('song-2'));
    watch(x.w, x.leader, x.follower, 11.5, 20, x.errors);
    x.w.run(20000);
    return x.errors;
  },

  // The leader speeds up; the tick says so.
  'speed change'() {
    const x = setup();
    x.leader.open('song-1');
    x.w.at(100, () => x.follower.join());
    x.w.at(10000, () => x.leader.setSpeed(2));
    watch(x.w, x.leader, x.follower, 11, 30, x.errors);
    x.w.run(30000);
    return x.errors;
  },

  // The follower's connection goes for 30 s while the leader changes song and
  // speed, three ways. Only a network error makes the client think it was
  // offline; a clean close and an HTTP error (a 502 during a deploy) do not.
  ...Object.fromEntries(['clean close', 'HTTP 502', 'offline'].map(how => [
    `reconnect after ${how}`, () => {
      const x = setup();
      x.leader.open('song-1');
      x.w.at(100, () => x.follower.join());
      x.w.at(10000, () => x.follower.drop(how === 'offline' ? 'offline' : 'status'));
      x.w.at(20000, () => x.leader.open('song-2'));
      x.w.at(25000, () => x.leader.setSpeed(1.5));
      x.w.at(40000, () => x.follower.connect());
      watch(x.w, x.leader, x.follower, 42, 60, x.errors);
      x.w.run(60000);
      return x.errors;
    },
  ])),

  // Paused, the leader scrolls by hand. A GET the follower sent earlier comes
  // back slowly, after a newer tick has already landed, and must not win.
  // (Two of the leader's own writes handled out of order is the server's to
  // refuse, by `seq`: test_session_sync.py. The stream itself is in order.)
  'slow snapshot after a newer tick'() {
    const x = setup();
    x.leader.open('song-1', { playing: false });
    x.w.at(100, () => x.follower.join());
    x.w.at(1000, () => x.leader.scrollTo(5));
    x.w.at(2000, () => x.follower.refetch(PL, { requestDelay: 50, responseDelay: 3000 }));
    x.w.at(2500, () => x.leader.scrollTo(20));
    watch(x.w, x.leader, x.follower, 4, 8, x.errors);
    x.w.run(8000);
    return x.errors;
  },

  // The leader's device loses its network mid-song and keeps playing: no more
  // beacons. A follower keeps scrolling on its own clock at the last pace
  // (amos, 2026-09-30: "keep", not an out-of-reach state).
  'leader goes quiet'() {
    const x = setup();
    x.leader.open('song-1');
    x.w.at(100, () => x.follower.join());
    x.w.at(10500, () => { x.leader.silent = true; });
    watch(x.w, x.leader, x.follower, 12, 60, x.errors);
    x.w.run(60000);
    return x.errors;
  },

  // The follower's tab is throttled for a minute (screen off, app in the
  // background): events still arrive, frames do not.
  'throttled tab'() {
    const x = setup();
    x.leader.open('song-1');
    x.w.at(100, () => x.follower.join());
    x.w.at(10000, () => x.follower.throttle(60000));
    watch(x.w, x.leader, x.follower, 72, 80, x.errors);
    x.w.run(80000);
    return x.errors;
  },
};

// ------------------------------------------------------------------- runner --

function main(argv) {
  const names = argv.length ? argv : Object.keys(SCENARIOS);
  let failed = 0;
  for (const name of names) {
    const fn = SCENARIOS[name];
    if (!fn) { console.error(`no scenario "${name}"`); return 2; }
    const errors = fn();
    if (errors.length) {
      failed++;
      console.log(`  FAIL  ${name}: ${errors[0]}`);
    } else {
      console.log(`  ok    ${name}`);
    }
  }
  console.log(`session sync (simulated): ${names.length - failed}/${names.length} passed`);
  return failed ? 1 : 0;
}

process.exit(main(process.argv.slice(2)));
