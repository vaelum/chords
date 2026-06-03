/* Chord engine + mock data.
   Song model:
     song = {
       id, title, artist, ownerId, tags, updatedAt,
       mainVersionId,                  // version shown in library
       versions: [
         { id, name, key, capo, tempo, body, updatedAt,
           playlistId,                 // set if this version is owned by a playlist
         }
       ]
     }
   Playlist model:
     playlist = { id, name, gradient, ownerId, collaborators, shared, updatedAt,
                  entries: [{ songId, versionId }] }
   A playlist always owns its own version of each of its songs (named "{Playlist} version"). */

// ---------- transposition ----------
const NOTES_SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const NOTES_FLAT  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];

function noteToIndex(n) {
  const idx = NOTES_SHARP.indexOf(n);
  if (idx >= 0) return idx;
  const idxF = NOTES_FLAT.indexOf(n);
  if (idxF >= 0) return idxF;
  return -1;
}

function transposeChord(chord, steps, preferFlats = false) {
  if (!chord) return chord;
  const slash = chord.indexOf('/');
  let main = chord, bass = '';
  if (slash >= 0) { main = chord.slice(0, slash); bass = chord.slice(slash + 1); }
  const re = /^([A-G])([#b]?)(.*)$/;
  const m = main.match(re);
  if (!m) return chord;
  const [, root, acc, rest] = m;
  let idx = noteToIndex(root + acc);
  if (idx < 0) return chord;
  const newIdx = ((idx + steps) % 12 + 12) % 12;
  const newRoot = preferFlats ? NOTES_FLAT[newIdx] : NOTES_SHARP[newIdx];
  let out = newRoot + rest;
  if (bass) {
    const bm = bass.match(re);
    if (bm) {
      const [, br, bacc, brest] = bm;
      const bIdx = noteToIndex(br + bacc);
      if (bIdx >= 0) {
        const bNew = (preferFlats ? NOTES_FLAT : NOTES_SHARP)[((bIdx + steps) % 12 + 12) % 12];
        out += '/' + bNew + brest;
      } else { out += '/' + bass; }
    } else { out += '/' + bass; }
  }
  return out;
}

function parseLine(line) {
  if (!line) return { type: 'empty' };
  const t = line.trim();
  if (t.startsWith('{') && t.endsWith('}')) return { type: 'section', name: t.slice(1, -1) };
  const tokens = [];
  let i = 0;
  let pendingChord = null;
  let buf = '';
  while (i < line.length) {
    const c = line[i];
    if (c === '[') {
      if (buf || pendingChord) {
        tokens.push({ chord: pendingChord, text: buf });
        buf = ''; pendingChord = null;
      }
      const close = line.indexOf(']', i);
      if (close < 0) { buf += c; i++; continue; }
      pendingChord = line.slice(i + 1, close);
      i = close + 1;
    } else { buf += c; i++; }
  }
  if (buf || pendingChord) tokens.push({ chord: pendingChord, text: buf });
  const totalText = tokens.map(t => t.text).join('').replace(/\s/g, '');
  const hasChord = tokens.some(t => t.chord);
  if (!totalText && hasChord) return { type: 'instr', tokens };
  // Bar/progression line: chords interspersed with only bar notation
  // (| : x4 ×4 etc.) and no real lyrics — e.g. "| [Am] | [F] | x4". Render
  // inline on a single line ("| Am | F | x4") instead of floating chord chips
  // above the pipe characters.
  if (hasChord && /\|/.test(totalText) && /^[|:x×().%/\-\d]+$/i.test(totalText)) {
    return { type: 'progression', tokens };
  }
  return { type: 'lyric', tokens };
}

function parseSong(body) {
  if (!body) return [];
  return body.split('\n').map(parseLine);
}

function transposeBody(body, steps) {
  if (!body || !steps) return body;
  return body.replace(/\[([^\]]+)\]/g, (_, c) => `[${transposeChord(c, steps)}]`);
}

function extractChords(body) {
  if (!body) return [];
  const seen = new Set();
  body.replace(/\[([^\]]+)\]/g, (_, c) => { seen.add(c); return ''; });
  return Array.from(seen);
}

// ---------- version helpers ----------
function getVersion(song, versionId) {
  if (!song) return null;
  return song.versions.find(v => v.id === versionId) || null;
}
function getMainVersion(song) {
  if (!song) return null;
  return song.versions.find(v => v.id === song.mainVersionId) || song.versions[0];
}

// ---------- mock data ----------
const USERS = [
  { id: 'u_me', name: 'Alex Rivera', handle: '@alex', color: 'av-1', initials: 'AR', me: true },
  { id: 'u_jordan', name: 'Jordan Park', handle: '@jordan', color: 'av-2', initials: 'JP' },
  { id: 'u_sam', name: 'Sam Mendes', handle: '@sam.m', color: 'av-3', initials: 'SM' },
  { id: 'u_priya', name: 'Priya Nair', handle: '@priya', color: 'av-4', initials: 'PN' },
  { id: 'u_taylor', name: 'Taylor Brooks', handle: '@taylorb', color: 'av-5', initials: 'TB' },
  { id: 'u_mika', name: 'Mika Tanaka', handle: '@mika.t', color: 'av-6', initials: 'MT' },
  { id: 'u_devon', name: 'Devon Cole', handle: '@devon', color: 'av-7', initials: 'DC' },
  { id: 'u_lior', name: 'Lior Bensh', handle: '@lior', color: 'av-8', initials: 'LB' },
];

const SONG_LIBRARY_RAW = [
  {
    title: 'Wandering Light', artist: 'The Coastal Hours',
    key: 'G', capo: 0, tempo: 92, tags: ['Acoustic', 'Setlist'],
    body: `{Intro}
[G]  [D]  [Em]  [C]

{Verse 1}
[G]Slow the morning [D]breaks across the [Em]bay,
[C]Boats are humming [G]quiet on their [D]way,
[Em]Children chase the [C]echoes of the [G]waves,
[D]Holding nothing [C]but a song to [G]save.

{Chorus}
Oh the [Em]wandering [C]light,
Through the [G]harbor late at [D]night,
[Em]Carries me [C]home, carries me [G]home.`
  },
  {
    title: 'Cassette Highway', artist: 'Mira Solano',
    key: 'D', capo: 2, tempo: 108, tags: ['Setlist', 'Easy'],
    body: `{Verse 1}
[D]Counting yellow [A]lines along the [Bm]road,
[G]Every mile a [D]story to be [A]told.
[D]Tape deck humming [A]something from be[Bm]fore,
[G]Wind is asking [A]what we're heading [D]for.

{Chorus}
[G]Roll the windows [D]down and let it [A]go,
[G]Cassette highway, [D]radio on [A]low.`
  },
  {
    title: 'Northern Kitchen', artist: 'Hollow Tide',
    key: 'Am', capo: 0, tempo: 72, tags: ['Acoustic', 'Fingerpick'],
    body: `{Verse 1}
[Am]Kettle on the [F]stove and the [C]rain coming [G]down,
[Am]Mother used to [F]hum the only [C]song in [G]town.
[Am]Bread is in the [F]oven and the [C]light is [G]low,
[F]Half the things I [C]carry I will [G]never let [Am]go.

{Bridge}
[Dm]All the maps we [Am]drew with crayons [F]on the wall,
[Dm]Faded into [Am]nothing but I [E]love them all.`
  },
  {
    title: 'Paper Planes & Promises', artist: 'Atlas Quiet',
    key: 'C', capo: 0, tempo: 88, tags: ['Wedding', 'Setlist'],
    body: `{Verse}
[C]Folded up our [G]hopes into a [Am]paper [F]plane,
[C]Threw it from the [G]porch into the [F]summer [G]rain.
[Am]Said whatever [Em]happens we will [F]meet again,
[C]Somewhere past the [G]bend, somewhere past the [C]bend.

{Chorus}
[F]Take my hand, [C]take it slow,
[Am]Promise me where[G]ever we go,
[F]I will keep you [C]close to my [Am]chest,
[Dm]Always and [G]ever, the [C]rest.`
  },
  {
    title: 'Slow Yellow Train', artist: 'Mira Solano',
    key: 'E', capo: 0, tempo: 120, tags: ['Band', 'Setlist'],
    body: `{Verse 1}
[E]Hear it coming [A]down the line,
[B]Slow yellow [E]train.
[E]Carrying my [A]heart and mine,
[B]Through the windy [E]plain.

{Chorus}
[A]Take me back, [E]take me back,
[B]To the place where I [E]began.`
  },
  {
    title: 'Birch & Lantern', artist: 'The Coastal Hours',
    key: 'Em', capo: 4, tempo: 76, tags: ['Acoustic', 'Capo', 'Fingerpick'],
    body: `{Verse 1}
[Em]Birch and lantern, [C]moss and stone,
[G]All the woods I've [D]ever known.
[Em]Quiet steps and [C]quiet rain,
[G]I am here a[D]gain, a[Em]gain.

{Chorus}
[C]Hold my coat and [G]find my way,
[Am]Tell me what the [Em]rivers say.`
  },
  {
    title: 'Cinnamon Apartment', artist: 'Hollow Tide',
    key: 'A', capo: 0, tempo: 96, tags: ['Easy', 'Solo'],
    body: `{Verse 1}
[A]Painted all the [D]walls a cinnamon [E]gold,
[A]Hung the kettle [D]up like grandma [E]told.
[F#m]Records on the [D]shelf in alpha[A]bet,
[E]Half of them are [D]ones I haven't [A]heard yet.

{Chorus}
[D]This is where the [A]quiet finds me [E]now,
[D]Cinnamon apart[A]ment, anyhow.`
  },
  {
    title: 'Letter from the Mountain', artist: 'Atlas Quiet',
    key: 'D', capo: 0, tempo: 84, tags: ['Worship', 'Setlist'],
    body: `{Verse}
[D]Wrote you from the [A]mountain in the [Bm]rain,
[G]Folded up the [D]paper like a [A]plane.
[Bm]Said the world is [F#m]quieter up [G]here,
[D]I am learning [A]how to disap[D]pear.`
  },
  {
    title: 'Tin Roof Lullaby', artist: 'June Halford',
    key: 'G', capo: 3, tempo: 64, tags: ['Acoustic', 'Capo'],
    body: `{Verse}
[G]Rain is on the [Em]tin roof tonight,
[C]Somebody's child is [D]sleeping right,
[G]Lamp is low and [Em]coffee's old,
[C]Outside is [D]getting cold.

{Chorus}
[Em]Sleep, my little [C]one, sleep,
[G]Rivers in the [D]tin roof deep.`
  },
  {
    title: 'Backyard Stars', artist: 'June Halford',
    key: 'C', capo: 0, tempo: 90, tags: ['Campfire', 'Easy'],
    body: `{Verse}
[C]Threw a blanket [G]down on the lawn,
[Am]Watched the dipper [F]carry on.
[C]Counted satel[G]lites and planes,
[F]None of them re[G]membered our [C]names.

{Chorus}
[F]Backyard stars, [C]backyard stars,
[Am]Cheap as soda [G]from a jar.`
  },
];

const EXTRA_TITLES = [
  ['Driftwood Year', 'The Coastal Hours', 'G'],
  ['Map of the Quiet Country', 'Mira Solano', 'D'],
  ['Cobblestone Christmas', 'June Halford', 'C'],
  ['Open Window Hymn', 'Atlas Quiet', 'A'],
  ['Postcards from the Lake', 'Hollow Tide', 'E'],
  ['Wool & Whiskey', 'The Coastal Hours', 'Am'],
  ['Saturday Cathedral', 'Atlas Quiet', 'D'],
  ['Heron at Dawn', 'Mira Solano', 'Em'],
  ['Streetlight Promises', 'June Halford', 'G'],
  ['Margaret in the Garden', 'Hollow Tide', 'C'],
  ['Birthday Card Blues', 'Mira Solano', 'A'],
  ['Pinewood Apartment', 'Atlas Quiet', 'D'],
  ['Saltwater Saints', 'The Coastal Hours', 'Em'],
  ['Library After Hours', 'June Halford', 'C'],
  ['Diner on Route 9', 'Mira Solano', 'G'],
  ['Brown Coat Sunday', 'Hollow Tide', 'Am'],
  ['Twelve Year Letter', 'Atlas Quiet', 'D'],
  ['Bicycles in October', 'The Coastal Hours', 'A'],
  ['Train to Marigold', 'June Halford', 'E'],
  ['Window Seat Hymn', 'Atlas Quiet', 'C'],
  ['Cousin of the Sea', 'The Coastal Hours', 'G'],
  ['Aunt Beverly\u2019s Stove', 'Hollow Tide', 'Am'],
  ['Holiday Inn Goodbye', 'June Halford', 'D'],
  ['Threadbare Sweater', 'Mira Solano', 'Em'],
  ['Crackerjack Sunrise', 'Atlas Quiet', 'G'],
  ['Halfway Across the Lawn', 'The Coastal Hours', 'C'],
  ['Sugar in the Coffee', 'June Halford', 'A'],
  ['Wildflower Telegram', 'Mira Solano', 'D'],
  ['Sunday Boots', 'Hollow Tide', 'G'],
  ['Borrowed Anorak', 'Atlas Quiet', 'Em'],
  ['Lighthouse Calendar', 'The Coastal Hours', 'C'],
  ['Twentieth Spring', 'June Halford', 'D'],
  ['Last Bus to Maple', 'Mira Solano', 'A'],
  ['Pocketful of Stones', 'Hollow Tide', 'Em'],
  ['Smoke on the Kettle', 'Atlas Quiet', 'G'],
  ['River, Recover', 'The Coastal Hours', 'Am'],
  ['Aerial View of June', 'Mira Solano', 'D'],
  ['Christmas Day Off', 'June Halford', 'C'],
  ['Brother of Mine', 'Hollow Tide', 'G'],
  ['Telephone Wires', 'Atlas Quiet', 'A'],
];

const DEFAULT_BODY = `{Verse}
[C]Place a [G]bracket be[Am]fore each [F]syllable,
[C]Edit me to [G]make the song your [F]own. [G]
[Am]Tap transpose to [F]shift the key,
[C]Autoscroll [G]when you can't read [C]free.`;

let _id = 1;
function newId(prefix) { return prefix + '_' + (_id++).toString(36) + Date.now().toString(36).slice(-3); }

function buildSongs() {
  const out = [];
  const now = Date.now();
  SONG_LIBRARY_RAW.forEach((s, i) => {
    const vid = newId('v');
    out.push({
      id: newId('s'),
      title: s.title, artist: s.artist,
      tags: s.tags.slice(),
      ownerId: 'u_me',
      updatedAt: now - i * 86400000,
      mainVersionId: vid,
      versions: [{
        id: vid, name: 'Original',
        key: s.key, capo: s.capo, tempo: s.tempo, body: s.body,
        updatedAt: now - i * 86400000,
        playlistId: null,
      }],
    });
  });
  EXTRA_TITLES.forEach((row, i) => {
    const [title, artist, key] = row;
    const tags = [];
    if (i % 4 === 0) tags.push('Acoustic');
    if (i % 5 === 0) tags.push('Setlist');
    if (i % 7 === 0) tags.push('Practice');
    if (i % 11 === 0) tags.push('Capo');
    if (i % 9 === 0) tags.push('Easy');
    if (i % 13 === 0) tags.push('Fingerpick');
    const vid = newId('v');
    out.push({
      id: newId('s'),
      title, artist,
      tags,
      ownerId: 'u_me',
      updatedAt: now - (i + 10) * 43200000,
      mainVersionId: vid,
      versions: [{
        id: vid, name: 'Original',
        key,
        capo: (i % 11 === 0) ? 2 : 0,
        tempo: 70 + (i * 7) % 80,
        body: DEFAULT_BODY,
        updatedAt: now - (i + 10) * 43200000,
        playlistId: null,
      }],
    });
  });
  return out;
}

// Build playlists. Every playlist owns a unique version per song, named "{Playlist name} version".
// We mutate the songs array to push these owned versions into the song's versions[].
function buildPlaylists(songs) {
  const now = Date.now();
  const raw = [
    { id: 'pl_1', name: 'Friday Set @ Cantine', gradient: 'gradient-1',
      ownerId: 'u_me', collaborators: ['u_me'], shared: false,
      songIdxs: [0, 1, 2, 3], updatedAt: now - 2 * 3600000 },
    { id: 'pl_2', name: 'Wedding — Camille & Theo', gradient: 'gradient-2',
      ownerId: 'u_me', collaborators: ['u_me', 'u_jordan'], shared: true,
      songIdxs: [3, 7, 4, 0, 5], updatedAt: now - 1 * 86400000 },
    { id: 'pl_3', name: 'Practice — Slow', gradient: 'gradient-3',
      ownerId: 'u_me', collaborators: ['u_me'], shared: false,
      songIdxs: [5, 8, 2], updatedAt: now - 3 * 86400000 },
    { id: 'pl_4', name: 'Campfire Standards', gradient: 'gradient-4',
      ownerId: 'u_me', collaborators: ['u_me', 'u_sam', 'u_taylor'], shared: true,
      songIdxs: [9, 6, 4, 1], updatedAt: now - 5 * 86400000 },
    { id: 'pl_5', name: 'Open Mic Rotation', gradient: 'gradient-5',
      ownerId: 'u_jordan', collaborators: ['u_me', 'u_jordan', 'u_priya'], shared: true,
      songIdxs: [2, 6, 8, 9], updatedAt: now - 7 * 86400000 },
    { id: 'pl_6', name: 'Worship Set — November', gradient: 'gradient-6',
      ownerId: 'u_me', collaborators: ['u_me'], shared: false,
      songIdxs: [7, 3], updatedAt: now - 10 * 86400000 },
  ];
  return raw.map(p => {
    const entries = [];
    p.songIdxs.forEach(idx => {
      const song = songs[idx];
      if (!song) return;
      const main = getMainVersion(song);
      const vid = newId('v');
      song.versions.push({
        id: vid, name: `${p.name} version`,
        key: main.key, capo: main.capo, tempo: main.tempo, body: main.body,
        updatedAt: p.updatedAt,
        playlistId: p.id,
      });
      entries.push({ songId: song.id, versionId: vid });
    });
    const { songIdxs, ...rest } = p;
    return { ...rest, entries };
  });
}

const INITIAL_SONGS = buildSongs();
const INITIAL_PLAYLISTS = buildPlaylists(INITIAL_SONGS);

const INITIAL_INBOX = [
  { id: 'in_1', fromUserId: 'u_jordan', kind: 'song', songSnapshot: {
      title: 'Backyard Stars', artist: 'June Halford', key: 'C', capo: 0, tempo: 90,
      tags: ['Campfire', 'Easy'], body: SONG_LIBRARY_RAW[9].body,
      versionName: 'Jordan\u2019s version — Capo 2',
    },
    matchSongId: INITIAL_SONGS.find(s => s.title === 'Backyard Stars')?.id || null,
    unread: true, time: Date.now() - 8 * 60000,
    note: 'Try this for Friday\u2014I added a bridge on the second chorus.',
  },
  { id: 'in_2', fromUserId: 'u_priya', kind: 'song', songSnapshot: {
      title: 'House of Ember', artist: 'Priya Nair', key: 'Em', capo: 0, tempo: 78,
      tags: ['Solo'], body: SONG_LIBRARY_RAW[5].body,
      versionName: 'Demo',
    },
    matchSongId: null,
    unread: true, time: Date.now() - 2 * 3600000,
    note: 'Wrote this on the train. Tell me if the bridge works.',
  },
  { id: 'in_3', fromUserId: 'u_sam', kind: 'playlist', playlistName: 'Camp Trip 2026',
    songCount: 14, unread: false, time: Date.now() - 26 * 3600000,
    note: 'For the Yosemite weekend. Made it a shared playlist.',
  },
  { id: 'in_4', fromUserId: 'u_taylor', kind: 'song', songSnapshot: {
      title: 'Cinnamon Apartment', artist: 'Hollow Tide', key: 'A', capo: 0, tempo: 96,
      tags: ['Easy', 'Solo'], body: SONG_LIBRARY_RAW[6].body,
      versionName: 'Taylor\u2019s key (G)',
    },
    matchSongId: INITIAL_SONGS.find(s => s.title === 'Cinnamon Apartment')?.id || null,
    unread: false, time: Date.now() - 4 * 86400000,
    note: 'I dropped this to G. Easier to sing on a tired night.',
  },
];

window.IT = window.IT || {};
Object.assign(window.IT, {
  NOTES_SHARP, NOTES_FLAT,
  transposeChord, transposeBody, parseSong, parseLine, extractChords,
  USERS,
  INITIAL_SONGS, INITIAL_PLAYLISTS, INITIAL_INBOX,
  newId, getVersion, getMainVersion,
});
