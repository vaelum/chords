/* Guitar voicings for a chord name.

   Turns "Am7", "F#sus4" or "C/G" into one or more fingerings for standard
   tuning (E A D G B e), used by the tap-a-chord diagram in the song view.

   Two sources feed it:
     - OPEN_VOICINGS — the handful of open-position chords that no movable
       shape produces (C, D, G, B7 …). Always preferred when one exists.
     - SHAPES — movable E-shape (root on string 6) and A-shape (root on
       string 5) templates, written at their open position and slid up the
       neck by the root's distance from E or A. Sliding a template turns its
       open strings into an index barre, which is exactly how these are
       played, so the finger numbers shift up by one and the index takes the
       barre.

   Frets are low-E-first; -1 means "don't play this string", 0 means open.
   Fingers use 1=index … 4=pinky, 0 = no finger (open or muted). */

const CS_OPEN_PC = [4, 9, 2, 7, 11, 4];             // pitch class of each open string
const CS_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CS_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const X = -1;

// Spoken names for the qualities we know, for the popup's subtitle.
const CS_QUALITY_NAMES = {
  maj: 'major', min: 'minor', '5': 'power chord (no third)',
  '7': 'dominant 7th', m7: 'minor 7th', maj7: 'major 7th',
  '6': 'major 6th', m6: 'minor 6th',
  sus2: 'suspended 2nd', sus4: 'suspended 4th', '7sus4': 'dominant 7 sus4',
  '9': 'dominant 9th', maj9: 'major 9th', m9: 'minor 9th', add9: 'added 9th',
  '13': 'dominant 13th',
  dim: 'diminished', dim7: 'diminished 7th', m7b5: 'half-diminished',
  aug: 'augmented',
};

// Chord suffix as written → the quality key used everywhere below. Looked up
// case-sensitively first ("M7" is not "m7"), then lower-cased.
const CS_ALIASES = {
  '': 'maj', 'maj': 'maj', 'M': 'maj', 'major': 'maj', 'ma': 'maj',
  'm': 'min', 'mi': 'min', 'min': 'min', '-': 'min', 'minor': 'min',
  '5': '5', 'no3': '5', 'power': '5',
  '7': '7', 'dom7': '7', 'dom': '7',
  'm7': 'm7', 'mi7': 'm7', 'min7': 'm7', '-7': 'm7',
  'maj7': 'maj7', 'M7': 'maj7', 'ma7': 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7', 'j7': 'maj7',
  '6': '6', 'maj6': '6', 'M6': '6',
  'm6': 'm6', 'min6': 'm6', '-6': 'm6',
  'sus': 'sus4', 'sus4': 'sus4', '4': 'sus4',
  'sus2': 'sus2', '2': 'sus2',
  '7sus4': '7sus4', '7sus': '7sus4', '11': '7sus4',
  '9': '9', 'add9': 'add9', 'add2': 'add9', 'madd9': 'm9',
  'm9': 'm9', 'min9': 'm9', '-9': 'm9',
  'maj9': 'maj9', 'M9': 'maj9',
  '13': '13', '7(13)': '13',
  'dim': 'dim', 'o': 'dim', '°': 'dim',
  'dim7': 'dim7', 'o7': 'dim7', '°7': 'dim7',
  'm7b5': 'm7b5', 'min7b5': 'm7b5', 'm7-5': 'm7b5', 'ø': 'm7b5', 'ø7': 'm7b5',
  'aug': 'aug', '+': 'aug', '+5': 'aug', 'aug5': 'aug', '#5': 'aug', '7#5': 'aug',
};

// Movable templates, written at their open position (offset 0 = E chord for
// the E-shape, A chord for the A-shape). Every template keeps the root as its
// lowest sounding string, so sliding one never turns the chord into an
// inversion — including the symmetric ones (dim7, aug), which could otherwise
// be dropped to a lower fret only by changing which tone is in the bass.
const CS_SHAPES = {
  E: {
    maj:    { frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] },
    min:    { frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0] },
    '7':    { frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0] },
    m7:     { frets: [0, 2, 0, 0, 0, 0], fingers: [0, 2, 0, 0, 0, 0] },
    maj7:   { frets: [0, 2, 1, 1, 0, 0], fingers: [0, 3, 1, 2, 0, 0] },
    '6':    { frets: [0, 2, 2, 1, 2, 0], fingers: [0, 2, 3, 1, 4, 0] },
    m6:     { frets: [0, 2, 2, 0, 2, 0], fingers: [0, 2, 3, 0, 4, 0] },
    sus4:   { frets: [0, 2, 2, 2, 0, 0], fingers: [0, 1, 2, 3, 0, 0] },
    sus2:   { frets: [0, 2, 4, 4, 0, 0], fingers: [0, 1, 3, 4, 0, 0] },
    '7sus4':{ frets: [0, 2, 0, 2, 0, 0], fingers: [0, 2, 0, 3, 0, 0] },
    '9':    { frets: [0, 2, 0, 1, 0, 2], fingers: [0, 2, 0, 1, 0, 3] },
    m9:     { frets: [0, 2, 0, 0, 0, 2], fingers: [0, 2, 0, 0, 0, 3] },
    add9:   { frets: [0, 2, 2, 1, 0, 2], fingers: [0, 2, 3, 1, 0, 4] },
    aug:    { frets: [0, 3, 2, 1, 1, 0], fingers: [0, 3, 2, 1, 1, 0] },
    '5':    { frets: [0, 2, 2, X, X, X], fingers: [0, 1, 3, 0, 0, 0] },
  },
  A: {
    maj:    { frets: [X, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0] },
    min:    { frets: [X, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] },
    '7':    { frets: [X, 0, 2, 0, 2, 0], fingers: [0, 0, 1, 0, 2, 0] },
    m7:     { frets: [X, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0] },
    maj7:   { frets: [X, 0, 2, 1, 2, 0], fingers: [0, 0, 3, 1, 2, 0] },
    '6':    { frets: [X, 0, 2, 2, 2, 2], fingers: [0, 0, 1, 2, 3, 4] },
    m6:     { frets: [X, 0, 2, 2, 1, 2], fingers: [0, 0, 2, 3, 1, 4] },
    sus4:   { frets: [X, 0, 2, 2, 3, 0], fingers: [0, 0, 1, 2, 3, 0] },
    sus2:   { frets: [X, 0, 2, 2, 0, 0], fingers: [0, 0, 1, 2, 0, 0] },
    '7sus4':{ frets: [X, 0, 2, 0, 3, 0], fingers: [0, 0, 1, 0, 3, 0] },
    '9':    { frets: [X, 0, 2, 4, 2, 3], fingers: [0, 0, 1, 3, 2, 4] },
    maj9:   { frets: [X, 0, 2, 1, 0, 0], fingers: [0, 0, 2, 1, 0, 0] },
    m9:     { frets: [X, 0, 2, 4, 1, 3], fingers: [0, 0, 1, 4, 2, 3] },
    add9:   { frets: [X, 0, 2, 4, 2, 0], fingers: [0, 0, 1, 3, 2, 0] },
    '13':   { frets: [X, 0, 2, 0, 2, 2], fingers: [0, 0, 2, 0, 3, 4] },
    dim:    { frets: [X, 0, 1, 2, 1, X], fingers: [0, 0, 1, 3, 2, 0] },
    dim7:   { frets: [X, 0, 1, 2, 1, 2], fingers: [0, 0, 1, 3, 2, 4] },
    m7b5:   { frets: [X, 0, 1, 2, 1, 3], fingers: [0, 0, 1, 3, 2, 4] },
    aug:    { frets: [X, 0, 3, 2, 2, 1], fingers: [0, 0, 4, 2, 3, 1] },
    '5':    { frets: [X, 0, 2, X, X, X], fingers: [0, 0, 1, 0, 0, 0] },
  },
};

// Open-position chords the movable shapes can't reach. Keyed by
// "<sharp root><quality>", e.g. "Cmaj", "Dmin", "G7", "Cmaj/G".
const CS_OPEN_VOICINGS = {
  'Cmaj':  { frets: [X, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] },
  'Cmaj7': { frets: [X, 3, 2, 0, 0, 0], fingers: [0, 3, 2, 0, 0, 0] },
  'C7':    { frets: [X, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0] },
  'Cadd9': { frets: [X, 3, 2, 0, 3, 0], fingers: [0, 2, 1, 0, 4, 0] },
  'Dmaj':  { frets: [X, X, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] },
  'Dmin':  { frets: [X, X, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1] },
  'D7':    { frets: [X, X, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3] },
  'Dm7':   { frets: [X, X, 0, 2, 1, 1], fingers: [0, 0, 0, 2, 1, 1] },
  'Dmaj7': { frets: [X, X, 0, 2, 2, 2], fingers: [0, 0, 0, 1, 2, 3] },
  'Dsus2': { frets: [X, X, 0, 2, 3, 0], fingers: [0, 0, 0, 1, 3, 0] },
  'Dsus4': { frets: [X, X, 0, 2, 3, 3], fingers: [0, 0, 0, 1, 2, 3] },
  'Fmaj7': { frets: [X, X, 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0] },
  'Gmaj':  { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3] },
  'G7':    { frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1] },
  'Gmaj7': { frets: [3, 2, 0, 0, 0, 2], fingers: [3, 1, 0, 0, 0, 2] },
  'B7':    { frets: [X, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4] },
  'Cmaj/G':  { frets: [3, 3, 2, 0, 1, 0], fingers: [3, 4, 2, 0, 1, 0] },
  'Dmaj/F#': { frets: [2, 0, 0, 2, 3, 2], fingers: [1, 0, 0, 2, 3, 4] },
  'Gmaj/B':  { frets: [X, 2, 0, 0, 3, 3], fingers: [0, 1, 0, 0, 3, 4] },
  'Amin/G':  { frets: [3, 0, 2, 2, 1, 0], fingers: [3, 0, 2, 4, 1, 0] },
};

function csNoteToPc(name) {
  const i = CS_SHARP.indexOf(name);
  if (i >= 0) return i;
  const f = CS_FLAT.indexOf(name);
  return f >= 0 ? f : -1;
}

// "F#m7/C#" → { root: 'F#', pc, quality: 'm7' → 'min7' key, bass, flats }
function csParseChord(name) {
  if (!name) return null;
  const clean = String(name).trim().replace(/\s+/g, '');
  const m = clean.match(/^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/);
  if (!m) return null;
  const [, letter, acc, suffix, bassLetter, bassAcc] = m;
  const pc = csNoteToPc(letter + acc);
  if (pc < 0) return null;
  let quality = CS_ALIASES[suffix];
  let approximate = false;
  if (!quality) quality = CS_ALIASES[suffix.toLowerCase()];
  if (!quality) {
    // Something we don't have a shape for (7b9, 6/9, 11#5 …): fall back to the
    // closest chord we do know and say so in the popup.
    approximate = true;
    if (/^(m|min|-)(?!aj)/.test(suffix)) quality = /7|9|11|13/.test(suffix) ? 'm7' : 'min';
    else if (/maj|M7|Δ/.test(suffix)) quality = 'maj7';
    else if (/7|9|11|13/.test(suffix)) quality = '7';
    else quality = 'maj';
  }
  const flats = acc === 'b';
  return {
    name: clean,
    root: (flats ? CS_FLAT : CS_SHARP)[pc],
    pc,
    quality,
    approximate,
    flats,
    bass: bassLetter ? bassLetter + bassAcc : null,
    key: CS_SHARP[pc] + quality,
    slashKey: bassLetter ? CS_SHARP[pc] + quality + '/' + bassLetter + bassAcc : null,
  };
}

// Slide a template up the neck. Open strings in the template become the index
// barre at the new position, and every other finger moves up one.
function csApplyShape(tpl, offset, shapeName) {
  const frets = tpl.frets.map(f => (f < 0 ? X : f + offset));
  let fingers;
  let barre = null;
  if (offset === 0) {
    fingers = tpl.fingers.slice();
  } else {
    // Every finger moves up one to free the index for the barre. If that would
    // ask for a fifth finger the shift is a guess, so the numbers are dropped
    // and the diagram shows plain dots rather than an unplayable fingering.
    const needsFifthFinger = tpl.frets.some((f, i) => f > 0 && (tpl.fingers[i] || 1) + 1 > 4);
    fingers = tpl.frets.map((f, i) => {
      if (f < 0) return 0;
      if (f === 0) return 1;                                       // now under the barre
      return needsFifthFinger ? 0 : (tpl.fingers[i] || 1) + 1;
    });
    const barred = [];
    tpl.frets.forEach((f, i) => { if (f === 0) barred.push(i); });
    if (barred.length > 1) {
      barre = { fret: offset, from: barred[0], to: barred[barred.length - 1] };
    }
  }
  return { frets, fingers, barre, shape: shapeName, offset };
}

function csVoicingFor(pc, quality, shapeName) {
  const tpl = CS_SHAPES[shapeName] && CS_SHAPES[shapeName][quality];
  if (!tpl) return null;
  const rootPc = shapeName === 'E' ? 4 : 9;
  const offset = ((pc - rootPc) % 12 + 12) % 12;
  return csApplyShape(tpl, offset, shapeName);
}

// Pitch classes actually sounding, low string first, for the "Notes" line.
function csNotesOf(frets, flats) {
  const names = flats ? CS_FLAT : CS_SHARP;
  const seen = [];
  frets.forEach((f, i) => {
    if (f < 0) return;
    const n = names[(CS_OPEN_PC[i] + f) % 12];
    if (seen.indexOf(n) < 0) seen.push(n);
  });
  return seen;
}

// Pitch class of the lowest string actually played.
function csBassPc(frets) {
  for (let i = 0; i < frets.length; i++) {
    if (frets[i] >= 0) return (CS_OPEN_PC[i] + frets[i]) % 12;
  }
  return -1;
}

function csSameFrets(a, b) {
  return a.frets.every((f, i) => f === b.frets[i]);
}

function csLowestFret(v) {
  const played = v.frets.filter(f => f > 0);
  return played.length ? Math.min.apply(null, played) : 0;
}

function csDescribe(v) {
  if (v.open || v.offset === 0) return 'open position';
  if (v.barre) return `barre · ${v.barre.fret}fr`;
  const low = csLowestFret(v);
  return low ? `${low}fr` : 'open position';
}

/* Voicings for a chord name, best first. Returns null when the name isn't a
   chord we can read (lyrics junk, "N.C.", a chart typo). */
function chordVoicings(name) {
  const parsed = csParseChord(name);
  if (!parsed) return null;

  const out = [];
  const openEntry = CS_OPEN_VOICINGS[parsed.slashKey] || CS_OPEN_VOICINGS[parsed.key];
  if (openEntry) {
    out.push({ frets: openEntry.frets.slice(), fingers: openEntry.fingers.slice(),
               barre: null, open: true, shape: 'open', offset: 0 });
  }

  const movable = [csVoicingFor(parsed.pc, parsed.quality, 'E'),
                   csVoicingFor(parsed.pc, parsed.quality, 'A')].filter(Boolean);
  movable.sort((a, b) => csLowestFret(a) - csLowestFret(b));
  for (const v of movable) {
    if (!out.some(o => csSameFrets(o, v))) out.push(v);
  }
  if (!out.length) return null;

  const voicings = out.slice(0, 3).map(v => ({
    ...v,
    label: csDescribe(v),
    notes: csNotesOf(v.frets, parsed.flats),
    bassPc: csBassPc(v.frets),
  }));

  // A slash chord only gets its written bass note if a voicing happens to put
  // it on the lowest string (the hand-written C/G, D/F# … entries do).
  const wantBassPc = parsed.bass ? csNoteToPc(parsed.bass) : -1;

  return {
    name: parsed.name,
    root: parsed.root,
    quality: parsed.quality,
    qualityName: CS_QUALITY_NAMES[parsed.quality] || parsed.quality,
    bass: parsed.bass,
    bassHandled: wantBassPc >= 0 && voicings[0].bassPc === wantBassPc,
    approximate: parsed.approximate,
    voicings,
  };
}

window.IT = window.IT || {};
Object.assign(window.IT, { chordVoicings, parseChordName: csParseChord });
