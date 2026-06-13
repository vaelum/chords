// AUTO-GENERATED from song-view.jsx by server/scripts/build-frontend.js — do not edit.
/* Chord-aware lyric renderer + song view screen with transpose, autoscroll, font size.
   surfaces playlist context when present. */

const {
  useState: useStateSV,
  useEffect: useEffectSV,
  useRef: useRefSV,
  useMemo: useMemoSV,
  useCallback: useCallbackSV
} = React;

// Density-aware autoscroll tuning. Each line gets a weight from its chord count;
// the scroller spends time on a line in proportion to its weight, so a line with
// more chords scrolls slower than a sparse one. Weights are normalised against
// the song's average, so the speed slider still sets the overall pace and a song
// of uniform density scrolls exactly as it did before.
const DENSITY_STRENGTH = 0.6; // extra weight per chord on a line
const FACTOR_MIN = 0.55; // densest lines never slower than ~55% of base
const FACTOR_MAX = 1.7; // sparse/blank lines never faster than ~170%
const FACTOR_SMOOTH = 4; // per-second lerp toward the target factor
const READ_ANCHOR = 0.35; // viewport fraction treated as the line being read

// Constant vs. adaptive (density-aware) autoscroll is a per-device preference.
const SCROLL_DENSITY_KEY = 'chords.scrollDensity';
function loadDensityMode() {
  try {
    const v = localStorage.getItem(SCROLL_DENSITY_KEY);
    if (v === '0') return false;
    if (v === '1') return true;
  } catch (e) {}
  return true; // adaptive on by default
}
function SongBody({
  body,
  lines: linesProp,
  lyricSize = 16,
  contentRef
}) {
  const lines = useMemoSV(() => linesProp || window.IT.parseSong(body || ''), [linesProp, body]);
  return /*#__PURE__*/React.createElement("div", {
    className: "sv-content",
    ref: contentRef,
    style: {
      '--lyric-size': lyricSize + 'px'
    }
  }, lines.map((l, i) => /*#__PURE__*/React.createElement(LineView, {
    key: i,
    line: l
  })));
}
function LineView({
  line
}) {
  if (line.type === 'empty') return /*#__PURE__*/React.createElement("div", {
    className: "line lyric",
    style: {
      height: '1em'
    }
  }, "\xA0");
  if (line.type === 'section') return /*#__PURE__*/React.createElement("span", {
    className: "section-tag"
  }, line.name);
  // Bar/progression line ("| [Am] | [F] | x4") — chord chips inline with the
  // bar markers, all on one row (same chip badge style as chords over lyrics).
  if (line.type === 'progression') return /*#__PURE__*/React.createElement(ProgressionLine, {
    tokens: line.tokens
  });
  // Chord-only lines ('instr') render with the same chord-chip style as
  // chord+lyric lines — the chips sit above blank space instead of literal
  // [C] text.
  return /*#__PURE__*/React.createElement(ChipLine, {
    tokens: line.tokens
  });
}
function ProgressionLine({
  tokens
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "line prog-line"
  }, tokens.map((t, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, t.chord && /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, t.chord), t.text && /*#__PURE__*/React.createElement("span", {
    className: "prog-text"
  }, t.text))));
}
function ChipLine({
  tokens
}) {
  const anyChord = tokens.some(t => t.chord);
  return /*#__PURE__*/React.createElement("div", {
    className: "line chip-line"
  }, tokens.map((t, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: `chip-token ${anyChord && !t.chord ? 'no-chip' : ''}`
  }, t.chord && /*#__PURE__*/React.createElement("span", {
    className: "chip"
  }, t.chord), /*#__PURE__*/React.createElement("span", {
    className: "lyric"
  }, t.text || '\u00A0'))));
}
function shiftKey(key, steps) {
  return window.IT.transposeChord(key, steps);
}
function SongView({
  song,
  playlist,
  store,
  onBack,
  openShare,
  openAddToPlaylist,
  onEdit,
  onPrev,
  onNext,
  lyricSize,
  setLyricSize,
  sideSpace = 0,
  setSideSpace = null,
  keepAwake,
  chordColor = 'orange',
  metronome = false,
  metronomeBeats = 4,
  barAtTop = false,
  readOnly = false,
  gaps = {
    top: 0,
    bottom: 0
  },
  setGaps = null
}) {
  const [speed, setSpeed] = useStateSV(song.scrollSpeed || 1.0);
  // In read-only mode (public share link) key/capo/tempo changes are kept as
  // local-only overrides — they never persist. In normal mode these stay null
  // and the controls write through to the store as before.
  const [locKey, setLocKey] = useStateSV(null);
  const [locCapo, setLocCapo] = useStateSV(null);
  const [locTempo, setLocTempo] = useStateSV(null);
  const [locBody, setLocBody] = useStateSV(null);
  const [autoscroll, setAutoscroll] = useStateSV(false);
  const [countIn, setCountIn] = useStateSV(false); // metronome count-in: flashing, not yet scrolling
  const [densityMode, setDensityMode] = useStateSV(loadDensityMode); // adaptive vs constant
  const [modePopOpen, setModePopOpen] = useStateSV(false);
  const [fontPopOpen, setFontPopOpen] = useStateSV(false);
  const [sectionsOpen, setSectionsOpen] = useStateSV(false);
  const [chordsOpen, setChordsOpen] = useStateSV(false);
  const [chordsOverflow, setChordsOverflow] = useStateSV(false);
  const [keyPopOpen, setKeyPopOpen] = useStateSV(false);
  const [capoPopOpen, setCapoPopOpen] = useStateSV(false);
  const [tempoPopOpen, setTempoPopOpen] = useStateSV(false);
  const [spacingOpen, setSpacingOpen] = useStateSV(false);
  const chordsListRef = useRefSV(null);
  const scrollRef = useRefSV(null);
  const contentRef = useRefSV(null);
  const rafRef = useRefSV(null);
  const lastTsRef = useRefSV(0);
  const accumRef = useRefSV(0);
  const pausedRef = useRefSV(false); // manual scroll temporarily pauses auto
  const resumeTimerRef = useRefSV(null);
  const lineTopsRef = useRefSV(null); // measured y of each line within the scroll content
  const contentHRef = useRefSV(0); // measured total scrollable height (incl. top/bottom padding)
  const linesHRef = useRefSV(0); // measured height of just the lyric lines (excl. padding)
  const factorRef = useRefSV(1); // smoothed density speed factor
  const densityModeRef = useRefSV(densityMode); // read live in the rAF tick
  const toast = useToast();
  const [menuEl, setMenuEl] = useStateSV(null);

  // Effective (display) values: a local override if the viewer changed it,
  // otherwise the song's stored value.
  const vKey = locKey != null ? locKey : song.key;
  const vCapo = locCapo != null ? locCapo : song.capo || 0;
  const vTempo = locTempo != null ? locTempo : song.tempo || 90;
  const vBody = locBody != null ? locBody : song.body;

  // Metronome count-in: how many beats to flash, and the per-beat period from
  // the song's tempo. Shared by the count-in timer and the bar's flash animation.
  const beatCount = Math.min(16, Math.max(1, metronomeBeats || 4));
  const beatPeriodMs = 60000 / Math.min(300, Math.max(20, vTempo));

  // Device-only edge gaps are applied app-wide at the root (see AppShell). The
  // ⋮ menu opens a shared SpacingPopup so the user can tune them live here.

  async function addToLibrary() {
    try {
      await store.copySongToLibrary(song.id);
      toast({
        title: 'Added to library',
        desc: song.title,
        icon: 'check'
      });
    } catch (e) {
      toast({
        title: "Couldn't add to library",
        desc: e.message || String(e),
        tone: 'destructive'
      });
    }
  }
  async function removeFromPlaylist() {
    if (!playlist) return;
    try {
      await store.removeFromPlaylist(song.id, playlist.id);
      toast({
        title: 'Removed from playlist',
        desc: song.title,
        tone: 'destructive',
        icon: 'trash'
      });
      onBack(); // the playlist-owned copy is gone — return to the playlist
    } catch (e) {
      toast({
        title: "Couldn't remove",
        desc: e.message || String(e),
        tone: 'destructive'
      });
    }
  }

  // reset speed + local overrides + stop autoscroll when the song changes
  useEffectSV(() => {
    setAutoscroll(false);
    setCountIn(false);
    setSpeed(song.scrollSpeed || 1.0);
    setLocKey(null);
    setLocCapo(null);
    setLocTempo(null);
    setLocBody(null);
  }, [song.id]);

  // Keep the screen awake while a song is open (Screen Wake Lock API). The
  // lock is dropped by the browser when the tab is hidden, so re-acquire it
  // when the page becomes visible again.
  useEffectSV(() => {
    if (!keepAwake || !('wakeLock' in navigator)) return;
    let sentinel = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen');
        sentinel.addEventListener('release', () => {
          sentinel = null;
        });
      } catch (e) {/* denied, low battery, or not permitted — ignore */}
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !sentinel && !cancelled) acquire();
    };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (sentinel) {
        sentinel.release().catch(() => {});
        sentinel = null;
      }
    };
  }, [keepAwake, song.id]);
  const effectiveBody = useMemoSV(() => window.IT.transposeBody(vBody, 0), [vBody]);
  const parsedLines = useMemoSV(() => window.IT.parseSong(effectiveBody), [effectiveBody]);
  const chords = useMemoSV(() => window.IT.extractChords(effectiveBody), [effectiveBody]);

  // Detect whether the chords row overflows its container
  useEffectSV(() => {
    const el = chordsListRef.current;
    if (!el) {
      setChordsOverflow(false);
      return;
    }
    setChordsOverflow(el.scrollWidth > el.clientWidth);
  }, [chords]);
  const sections = useMemoSV(() => {
    if (!vBody) return [];
    return vBody.split('\n').map(l => l.trim()).filter(l => l.startsWith('{') && l.endsWith('}')).map(l => l.slice(1, -1));
  }, [vBody]);

  // Per-line scroll-speed weight, driven by how many chords the line carries.
  const lineWeights = useMemoSV(() => parsedLines.map(l => 1 + DENSITY_STRENGTH * (l.tokens ? l.tokens.reduce((a, t) => a + (t.chord ? 1 : 0), 0) : 0)), [parsedLines]);
  const avgWeight = useMemoSV(() => lineWeights.length ? lineWeights.reduce((a, w) => a + w, 0) / lineWeights.length : 1, [lineWeights]);

  // The tick reads the mode from a ref so toggling mid-scroll eases the pace
  // toward the new target instead of restarting the loop.
  useEffectSV(() => {
    densityModeRef.current = densityMode;
  }, [densityMode]);
  function setDensity(on) {
    setDensityMode(on);
    try {
      localStorage.setItem(SCROLL_DENSITY_KEY, on ? '1' : '0');
    } catch (e) {}
  }

  // Measure each rendered line's position within the scroll content (and the
  // total height) so the tick can map scrollTop → "line being read" without
  // touching the DOM every frame. Positions are stored scroll-invariant, so it's
  // safe to measure at any scroll offset.
  const measureLines = useCallbackSV(() => {
    const el = scrollRef.current,
      cont = contentRef.current;
    if (!el || !cont) return;
    const elTop = el.getBoundingClientRect().top;
    const sTop = el.scrollTop;
    const kids = cont.children;
    const tops = new Array(kids.length);
    for (let k = 0; k < kids.length; k++) {
      tops[k] = kids[k].getBoundingClientRect().top - elTop + sTop;
    }
    lineTopsRef.current = tops;
    contentHRef.current = el.scrollHeight;
    linesHRef.current = cont.scrollHeight; // lines only — el adds the 1/3-vh padding
  }, []);

  // Re-measure when the content reflows: new song, font-size change, or any
  // resize (window width changes line wrapping, hence heights).
  useEffectSV(() => {
    measureLines();
    const cont = contentRef.current;
    if (!cont || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measureLines());
    ro.observe(cont);
    return () => ro.disconnect();
  }, [parsedLines, lyricSize, measureLines]);
  useEffectSV(() => {
    // While the metronome count-in is running we hold position — scrolling only
    // begins once the count-in finishes (countIn flips false and this re-runs).
    if (!autoscroll || countIn) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTsRef.current = 0;
      accumRef.current = 0;
      return;
    }
    measureLines(); // fresh metrics for this run
    factorRef.current = 1; // start at base pace, then ease toward density target
    const tick = ts => {
      const el = scrollRef.current;
      if (!el) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      // Paused by a manual scroll — keep ticking but don't advance, and keep
      // the clock fresh so we don't lurch when auto resumes.
      if (pausedRef.current) {
        lastTsRef.current = ts;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;

      // speed is a multiplier: 1x = 0.5 lps. Pace is derived from the lyric
      // lines' own height (linesH), not the padded scroll height (contentH), so
      // the 1/3-vh blank lead-in/out doesn't speed up the per-line scroll rate.
      const lineCount = Math.max(1, parsedLines.length);
      const contentH = contentHRef.current || (contentRef.current ? contentRef.current.scrollHeight : lineCount * 26);
      const linesH = linesHRef.current || contentH;
      const basePxPerSec = speed * 0.5 * (linesH / lineCount);

      // Adaptive mode: make the TIME spent on a line scale with its chord count,
      // independent of the line's pixel height. The density factor (avgWeight/w)
      // slows chord-heavy lines and speeds up sparse ones; multiplying by the
      // line's height / average height cancels height out of the dwell time, so a
      // SHORT but chord-dense line (e.g. an instrumental "| Am | F | C | G |")
      // still lingers instead of whizzing past a tall wrapped lyric line.
      // Without this, dwell = height/(base·factor) made short dense lines scroll
      // *faster* — the inverted behaviour. Constant mode eases the factor to 1.
      let target = 1;
      const tops = lineTopsRef.current;
      if (densityModeRef.current && tops && tops.length) {
        const anchorY = el.scrollTop + el.clientHeight * READ_ANCHOR;
        let idx = 0,
          lo = 0,
          hi = tops.length - 1;
        while (lo <= hi) {
          const mid = lo + hi >> 1;
          if (tops[mid] <= anchorY) {
            idx = mid;
            lo = mid + 1;
          } else hi = mid - 1;
        }
        const w = lineWeights[Math.min(idx, lineWeights.length - 1)] || 1;
        const density = Math.max(FACTOR_MIN, Math.min(FACTOR_MAX, avgWeight / w));
        // Stay in the lines-only frame (exclude the 1/3-vh padding) so the
        // padding doesn't skew per-line dwell. tops[0] is the first line's top
        // (≈ the top padding), so tops[0] + linesH is the lyrics' bottom edge.
        const avgH = linesH / lineCount;
        const linesBottom = tops[0] + linesH;
        const lineH = (idx + 1 < tops.length ? tops[idx + 1] : linesBottom) - tops[idx];
        const heightFactor = avgH > 0 && lineH > 0 ? Math.max(0.4, Math.min(3, lineH / avgH)) : 1;
        target = Math.max(0.3, Math.min(3.5, density * heightFactor));
      }
      factorRef.current += (target - factorRef.current) * Math.min(1, dt * FACTOR_SMOOTH);
      const pxPerSec = basePxPerSec * factorRef.current;
      accumRef.current += dt * pxPerSec;
      if (accumRef.current >= 1) {
        const px = Math.floor(accumRef.current);
        el.scrollTop += px;
        accumRef.current -= px;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
          setAutoscroll(false);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [autoscroll, countIn, speed, parsedLines]);

  // Metronome count-in: once it starts, hold for the configured number of beats
  // at the song's tempo, then drop countIn so the scroll loop above kicks in.
  useEffectSV(() => {
    if (!autoscroll || !countIn) return;
    const id = setTimeout(() => setCountIn(false), beatCount * beatPeriodMs);
    return () => clearTimeout(id);
  }, [autoscroll, countIn, beatCount, beatPeriodMs]);

  // Manual scrolling takes over briefly: while the user scrolls by hand we
  // pause the auto-advance, then resume from the new position shortly after
  // they stop. The rAF loop fires 'scroll' events itself, so we only react to
  // direct user gestures (wheel / touch).
  useEffectSV(() => {
    if (!autoscroll) {
      pausedRef.current = false;
      if (resumeTimerRef.current) {
        clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    const onManual = () => {
      pausedRef.current = true;
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = setTimeout(() => {
        pausedRef.current = false;
        lastTsRef.current = 0; // fresh clock so auto resumes smoothly
      }, 1200);
    };
    el.addEventListener('wheel', onManual, {
      passive: true
    });
    el.addEventListener('touchmove', onManual, {
      passive: true
    });
    return () => {
      el.removeEventListener('wheel', onManual);
      el.removeEventListener('touchmove', onManual);
      if (resumeTimerRef.current) {
        clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
    };
  }, [autoscroll]);
  useEffectSV(() => {
    const h = e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === ' ') {
        e.preventDefault();
        toggleAutoscroll();
      }
      if (e.key === '+' || e.key === '=') handleTranspose(1);
      if (e.key === '-') handleTranspose(-1);
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onBack, song.key, song.body, autoscroll]);

  // Bottom-bar popovers (Sections, scroll mode, Text size) dismiss on a click or
  // tap outside them — the centred Key/Capo/Tempo popups already do this via an
  // overlay, these are anchored to the bar so we test the target instead. A
  // toggle button and its popover card both live inside the same .popover-anchor,
  // so pressing a button (to close/switch) or dragging the size slider counts as
  // "inside" and is left to the element's own handler.
  useEffectSV(() => {
    if (!sectionsOpen && !modePopOpen && !fontPopOpen) return;
    const onDown = e => {
      if (e.target.closest && e.target.closest('.popover-anchor')) return;
      setSectionsOpen(false);
      setModePopOpen(false);
      setFontPopOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [sectionsOpen, modePopOpen, fontPopOpen]);
  function toggleAutoscroll() {
    if (!autoscroll) {
      setModePopOpen(false);
      setFontPopOpen(false);
      setSectionsOpen(false);
      setChordsOpen(false);
      setKeyPopOpen(false);
      setCapoPopOpen(false);
      setTempoPopOpen(false);
      // Starting: when the metronome is on, flash a count-in first; the scroll
      // loop waits until countIn clears. Without it, scrolling begins at once.
      setCountIn(metronome);
      setAutoscroll(true);
    } else {
      setCountIn(false);
      setAutoscroll(false);
    }
  }
  function handleTranspose(delta) {
    const newKey = shiftKey(vKey, delta);
    const newBody = window.IT.transposeBody(vBody, delta);
    if (readOnly) {
      setLocKey(newKey);
      setLocBody(newBody);
    } else store.updateSong(song.id, {
      key: newKey,
      body: newBody
    });
  }
  function handleCapo(delta) {
    const newCapo = Math.min(11, Math.max(0, vCapo + delta));
    if (readOnly) setLocCapo(newCapo);else store.updateSong(song.id, {
      capo: newCapo
    });
  }
  function handleTempo(delta) {
    const newTempo = Math.min(300, Math.max(20, vTempo + delta));
    if (readOnly) setLocTempo(newTempo);else store.updateSong(song.id, {
      tempo: newTempo
    });
  }
  function handleSpeed(delta) {
    // delta is in display units (0.1x); stored value is half the displayed value
    const newSpeed = Math.round(Math.min(5.0, Math.max(0.1, speed + delta / 2)) * 20) / 20;
    setSpeed(newSpeed);
    // Speed is always a local view preference here; only persist it when not read-only.
    if (!readOnly) store.updateSong(song.id, {
      scrollSpeed: newSpeed
    });
  }
  function scrollToTop() {
    const el = scrollRef.current;
    if (!el) return;
    // Explicit smooth scroll — the container itself is scroll-behavior:auto so the
    // autoscroll rAF loop's per-frame scrollTop writes aren't animated (which
    // stalls scrolling on iOS Safari).
    el.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
    lastTsRef.current = 0;
    accumRef.current = 0;
  }
  function jumpToSection(domIndex) {
    const container = scrollRef.current;
    if (!container) {
      setSectionsOpen(false);
      return;
    }
    const tags = container.querySelectorAll('.section-tag');
    if (tags[domIndex]) {
      const containerRect = container.getBoundingClientRect();
      const tagRect = tags[domIndex].getBoundingClientRect();
      const top = container.scrollTop + tagRect.top - containerRect.top - 16;
      container.scrollTo({
        top,
        behavior: 'smooth'
      });
      lastTsRef.current = 0;
      accumRef.current = 0;
    }
    setSectionsOpen(false);
  }
  const collabs = (playlist && playlist.collaborators || []).map(id => window.IT.USERS.find(u => u.id === id)).filter(Boolean);

  // Popover vertical anchoring: cards open upward off a bottom bar, downward off
  // a top bar. Spread into each popover-card so they never open off-screen.
  const popVert = barAtTop ? {
    top: '100%',
    bottom: 'auto',
    marginTop: 6,
    marginBottom: 0
  } : {
    bottom: '100%'
  };

  // Playback / autoscroll bar. Rendered either at the top or bottom of the shell
  // depending on the barAtTop preference; `at-top` flips its border + safe-area
  // padding in CSS.
  const autoscrollBar = /*#__PURE__*/React.createElement("div", {
    className: `autoscroll-bar${barAtTop ? ' at-top' : ''}${autoscroll ? ' playing' : ''}${countIn ? ' metronome' : ''}`,
    style: countIn ? {
      '--beat-period': beatPeriodMs + 'ms',
      '--beat-count': beatCount
    } : undefined
  }, /*#__PURE__*/React.createElement("div", {
    className: `as-left${autoscroll ? ' as-hidden' : ''}`
  }, sections.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "popover-anchor"
  }, /*#__PURE__*/React.createElement("button", {
    className: `as-icon-btn ${sectionsOpen ? 'on' : ''}`,
    onClick: () => {
      setSectionsOpen(v => !v);
      setFontPopOpen(false);
      setModePopOpen(false);
    },
    "aria-label": "Jump to section"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "list",
    size: 16
  })), sectionsOpen && /*#__PURE__*/React.createElement("div", {
    className: "popover-card",
    style: {
      minWidth: 160,
      left: 0,
      right: 'auto',
      ...popVert
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: 'var(--muted-foreground)',
      textTransform: 'uppercase',
      letterSpacing: '.06em',
      marginBottom: 6
    }
  }, "Sections"), sections.map((name, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    onClick: () => jumpToSection(i),
    className: "section-jump-btn"
  }, name)))), /*#__PURE__*/React.createElement("button", {
    className: "as-icon-btn",
    onClick: scrollToTop,
    "aria-label": "Scroll to top"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "arrowUp",
    size: 16
  }))), /*#__PURE__*/React.createElement("div", {
    className: "as-group"
  }, /*#__PURE__*/React.createElement("div", {
    className: "popover-anchor"
  }, /*#__PURE__*/React.createElement("button", {
    className: `as-icon-btn ${modePopOpen ? 'on' : ''}`,
    onClick: () => {
      setModePopOpen(v => !v);
      setFontPopOpen(false);
      setSectionsOpen(false);
    },
    "aria-label": "Scroll speed mode",
    title: "Scroll speed mode"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "metronome",
    size: 16
  })), modePopOpen && /*#__PURE__*/React.createElement("div", {
    className: "popover-card",
    style: {
      minWidth: 210,
      left: '50%',
      right: 'auto',
      transform: 'translateX(-50%)',
      ...popVert
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: 'var(--muted-foreground)',
      textTransform: 'uppercase',
      letterSpacing: '.06em',
      marginBottom: 8
    }
  }, "Scroll speed"), /*#__PURE__*/React.createElement("div", {
    className: "seg-switch",
    style: {
      width: '100%',
      marginBottom: 0
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: `seg-item ${!densityMode ? 'on' : ''}`,
    style: {
      flex: 1
    },
    onClick: () => setDensity(false)
  }, "Constant"), /*#__PURE__*/React.createElement("button", {
    className: `seg-item ${densityMode ? 'on' : ''}`,
    style: {
      flex: 1
    },
    onClick: () => setDensity(true)
  }, "Adaptive")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      fontSize: 11,
      lineHeight: 1.4,
      color: 'var(--muted-foreground)'
    }
  }, "Adaptive slows down on chord-heavy lines and speeds up on sparse ones."))), /*#__PURE__*/React.createElement("div", {
    className: "as-divider"
  }), /*#__PURE__*/React.createElement("button", {
    className: "as-icon-btn",
    onClick: () => handleSpeed(-0.1),
    "aria-label": "Slower"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "minus",
    size: 14
  })), /*#__PURE__*/React.createElement("span", {
    className: "as-speed-val"
  }, (speed * 2).toFixed(1), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      marginLeft: 2,
      opacity: .6
    }
  }, "x")), /*#__PURE__*/React.createElement("button", {
    className: "as-icon-btn",
    onClick: () => handleSpeed(0.1),
    "aria-label": "Faster"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 14
  })), /*#__PURE__*/React.createElement("div", {
    className: "as-divider"
  }), /*#__PURE__*/React.createElement("button", {
    className: "as-play",
    onClick: toggleAutoscroll,
    "aria-label": autoscroll ? 'Stop autoscroll' : 'Play autoscroll'
  }, /*#__PURE__*/React.createElement(Icon, {
    name: autoscroll ? 'pause' : 'play',
    size: 16
  }))), /*#__PURE__*/React.createElement("div", {
    className: `as-right${autoscroll ? ' as-hidden' : ''}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "popover-anchor"
  }, /*#__PURE__*/React.createElement("button", {
    className: `as-icon-btn ${fontPopOpen ? 'on' : ''}`,
    onClick: () => {
      setFontPopOpen(v => !v);
      setSectionsOpen(false);
      setModePopOpen(false);
    },
    "aria-label": "Text size"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "textSize",
    size: 18
  })), fontPopOpen && /*#__PURE__*/React.createElement("div", {
    className: "popover-card",
    style: popVert
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-small"
  }, "Text size"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color: 'var(--muted-foreground)'
    }
  }, lyricSize, "px")), /*#__PURE__*/React.createElement("input", {
    type: "range",
    className: "as-slider",
    min: "12",
    max: "32",
    step: "1",
    value: lyricSize,
    onChange: e => setLyricSize(+e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      marginTop: 12
    }
  }, [14, 16, 20, 24].map(s => /*#__PURE__*/React.createElement("button", {
    key: s,
    className: "btn btn-outline btn-sm",
    style: {
      flex: 1,
      padding: 0
    },
    onClick: () => setLyricSize(s)
  }, s))), setSideSpace && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      margin: '16px 0 10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-small"
  }, "Side margins"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color: 'var(--muted-foreground)'
    }
  }, sideSpace, "px")), /*#__PURE__*/React.createElement("input", {
    type: "range",
    className: "as-slider",
    min: "0",
    max: "80",
    step: "2",
    value: sideSpace,
    onChange: e => setSideSpace(+e.target.value)
  }))))));
  return /*#__PURE__*/React.createElement("div", {
    className: "sv-shell",
    "data-chord-color": chordColor
  }, !autoscroll && /*#__PURE__*/React.createElement("div", {
    className: "sv-header"
  }, /*#__PURE__*/React.createElement(IconBtn, {
    icon: "back",
    label: "Back",
    onClick: onBack
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sv-title"
  }, song.title), /*#__PURE__*/React.createElement("div", {
    className: "sv-artist"
  }, song.artist)), /*#__PURE__*/React.createElement("div", {
    className: "sv-actions"
  }, !readOnly && /*#__PURE__*/React.createElement(IconBtn, {
    icon: "more",
    label: "More",
    onClick: e => setMenuEl(e.currentTarget)
  }))), !readOnly && /*#__PURE__*/React.createElement(Menu, {
    open: !!menuEl,
    anchor: menuEl,
    onClose: () => setMenuEl(null),
    items: [{
      label: 'Edit song',
      icon: 'edit',
      onSelect: onEdit
    }, {
      label: 'Share',
      icon: 'share2',
      onSelect: openShare
    }, {
      label: 'Add to playlist',
      icon: 'list',
      onSelect: openAddToPlaylist
    }, ...(setGaps ? [{
      label: 'Adjust spacing',
      icon: 'spacing',
      onSelect: () => setSpacingOpen(true)
    }] : []), ...(playlist ? [{
      label: 'Add to library',
      icon: 'plus',
      onSelect: addToLibrary
    }, {
      sep: true
    }, {
      label: 'Remove from playlist',
      icon: 'trash',
      destructive: true,
      onSelect: removeFromPlaylist
    }] : [])]
  }), !autoscroll && playlist && /*#__PURE__*/React.createElement("div", {
    className: "sv-playlist-banner"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "list",
    size: 14
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 500
    }
  }, playlist.name), playlist.shared && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted-foreground)'
    }
  }, "\xB7"), /*#__PURE__*/React.createElement("div", {
    className: "collab-avatars"
  }, collabs.slice(0, 4).map(u => /*#__PURE__*/React.createElement("span", {
    key: u.id,
    className: `av ${u.color}`,
    style: {
      width: 20,
      height: 20,
      fontSize: 9
    }
  }, u.initials))), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted-foreground)'
    }
  }, "Edits sync to ", collabs.length, " collaborators")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    size: "sm",
    disabled: !onPrev,
    onClick: () => onPrev && onPrev()
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "back",
    size: 14
  }), " Prev"), /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    size: "sm",
    disabled: !onNext,
    onClick: () => onNext && onNext()
  }, "Next ", /*#__PURE__*/React.createElement(Icon, {
    name: "back",
    size: 14,
    style: {
      transform: 'scaleX(-1)'
    }
  })))), !autoscroll && /*#__PURE__*/React.createElement("div", {
    className: "sv-meta-bar"
  }, /*#__PURE__*/React.createElement("button", {
    className: `meta-pop-btn${keyPopOpen ? ' on' : ''}`,
    onClick: () => {
      setKeyPopOpen(v => !v);
      setCapoPopOpen(false);
      setTempoPopOpen(false);
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "label"
  }, "Key"), /*#__PURE__*/React.createElement("span", {
    className: "val"
  }, vKey)), /*#__PURE__*/React.createElement("button", {
    className: `meta-pop-btn${capoPopOpen ? ' on' : ''}`,
    onClick: () => {
      setCapoPopOpen(v => !v);
      setKeyPopOpen(false);
      setTempoPopOpen(false);
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "label"
  }, "Capo"), /*#__PURE__*/React.createElement("span", {
    className: "val"
  }, vCapo)), /*#__PURE__*/React.createElement("button", {
    className: `meta-pop-btn${tempoPopOpen ? ' on' : ''}`,
    onClick: () => {
      setTempoPopOpen(v => !v);
      setKeyPopOpen(false);
      setCapoPopOpen(false);
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "label"
  }, "BPM"), /*#__PURE__*/React.createElement("span", {
    className: "val"
  }, vTempo)), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto'
    }
  })), keyPopOpen && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 49
    },
    onClick: () => setKeyPopOpen(false)
  }), /*#__PURE__*/React.createElement("div", {
    className: "sv-center-popup"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sv-center-popup-head"
  }, /*#__PURE__*/React.createElement("span", null, "Transpose key"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-ghost btn-icon btn-sm",
    onClick: () => setKeyPopOpen(false)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "close",
    size: 14
  }))), /*#__PURE__*/React.createElement("div", {
    className: "meta-stepper-row"
  }, /*#__PURE__*/React.createElement("button", {
    className: "as-icon-btn",
    onClick: () => handleTranspose(-1),
    "aria-label": "Transpose down"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "minus",
    size: 16
  })), /*#__PURE__*/React.createElement("span", {
    className: "meta-stepper-val"
  }, vKey), /*#__PURE__*/React.createElement("button", {
    className: "as-icon-btn",
    onClick: () => handleTranspose(1),
    "aria-label": "Transpose up"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 16
  }))))), capoPopOpen && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 49
    },
    onClick: () => setCapoPopOpen(false)
  }), /*#__PURE__*/React.createElement("div", {
    className: "sv-center-popup"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sv-center-popup-head"
  }, /*#__PURE__*/React.createElement("span", null, "Capo fret"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-ghost btn-icon btn-sm",
    onClick: () => setCapoPopOpen(false)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "close",
    size: 14
  }))), /*#__PURE__*/React.createElement("div", {
    className: "meta-stepper-row"
  }, /*#__PURE__*/React.createElement("button", {
    className: "as-icon-btn",
    onClick: () => handleCapo(-1),
    "aria-label": "Capo down",
    disabled: !vCapo
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "minus",
    size: 16
  })), /*#__PURE__*/React.createElement("span", {
    className: "meta-stepper-val"
  }, vCapo), /*#__PURE__*/React.createElement("button", {
    className: "as-icon-btn",
    onClick: () => handleCapo(1),
    "aria-label": "Capo up"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 16
  }))))), tempoPopOpen && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 49
    },
    onClick: () => setTempoPopOpen(false)
  }), /*#__PURE__*/React.createElement("div", {
    className: "sv-center-popup"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sv-center-popup-head"
  }, /*#__PURE__*/React.createElement("span", null, "Tempo"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-ghost btn-icon btn-sm",
    onClick: () => setTempoPopOpen(false)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "close",
    size: 14
  }))), /*#__PURE__*/React.createElement("div", {
    className: "meta-stepper-row"
  }, /*#__PURE__*/React.createElement("button", {
    className: "as-icon-btn",
    onClick: () => handleTempo(-5),
    "aria-label": "Tempo down"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "minus",
    size: 16
  })), /*#__PURE__*/React.createElement("span", {
    className: "meta-stepper-val"
  }, vTempo), /*#__PURE__*/React.createElement("button", {
    className: "as-icon-btn",
    onClick: () => handleTempo(5),
    "aria-label": "Tempo up"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 16
  }))))), !autoscroll && chords.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: `sv-chords-bar${chordsOverflow ? ' has-overflow' : ''}`,
    onClick: () => setChordsOpen(true)
  }, /*#__PURE__*/React.createElement("span", {
    className: "sv-chords-label"
  }, "Used"), /*#__PURE__*/React.createElement("div", {
    className: "sv-chords-list",
    ref: chordsListRef
  }, chords.map(c => /*#__PURE__*/React.createElement("span", {
    key: c,
    className: "sv-chord-chip"
  }, c))), chordsOverflow && /*#__PURE__*/React.createElement("span", {
    className: "sv-chords-ellipsis"
  }, "\xB7\xB7\xB7")), chordsOpen && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 49
    },
    onClick: () => setChordsOpen(false)
  }), /*#__PURE__*/React.createElement("div", {
    className: "sv-center-popup",
    style: {
      minWidth: 260
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sv-center-popup-head"
  }, /*#__PURE__*/React.createElement("span", null, "Chords used"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-ghost btn-icon btn-sm",
    onClick: () => setChordsOpen(false)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "close",
    size: 14
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, chords.map(c => /*#__PURE__*/React.createElement("span", {
    key: c,
    className: "sv-chord-chip",
    style: {
      fontSize: 14,
      padding: '4px 10px'
    }
  }, c))))), /*#__PURE__*/React.createElement(SpacingPopup, {
    open: spacingOpen,
    onClose: () => setSpacingOpen(false),
    gaps: gaps,
    setGaps: setGaps
  }), barAtTop && autoscrollBar, /*#__PURE__*/React.createElement("div", {
    className: "sv-scroll",
    ref: scrollRef,
    style: {
      '--side-space': sideSpace + 'px'
    }
  }, /*#__PURE__*/React.createElement(SongBody, {
    lines: parsedLines,
    lyricSize: lyricSize,
    contentRef: contentRef
  })), !barAtTop && autoscrollBar);
}
window.SongView = SongView;
window.SongBody = SongBody;