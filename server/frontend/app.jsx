/* chords app shell — state store + routing + sidebar/bottom nav + tweaks integration */

const { useState: useStateA, useEffect: useEffectA, useMemo: useMemoA, useCallback: useCallbackA, useRef: useRefA } = React;

// The build id baked into this page by the server (main.py injects it). The
// /events stream reports the server's current build on every connect; when it
// no longer matches this — i.e. we reconnected after a deploy — useStore flips
// updateReady and we surface a reload prompt. Null in the native Tauri shell
// (which serves its own bundle, not through the backend), where we never prompt.
const LOADED_BUILD = window.__BUILD_ID__ || null;

// Turn a song/playlist title into a tidy download filename (no extension).
function safeFileName(name) {
  const cleaned = String(name).trim().replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.toLowerCase() || 'chords-export';
}

// ---------- LoginScreen ----------
function LoginScreen({ onLogin }) {
  const [handle, setHandle] = useStateA('');
  const [password, setPassword] = useStateA('');
  const [error, setError] = useStateA('');
  const [busy, setBusy] = useStateA(false);

  // Native (Tauri) builds have no same-origin backend, so the user picks the
  // server here. On the web this stays hidden and requests go to the same origin.
  const native = window.IT.isNative();
  const [server, setServerInput] = useStateA(window.IT.getServer());

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (native) window.IT.setServer(server);
      await onLogin(handle.trim(), password);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: 'var(--background)',
    }}>
      <form onSubmit={submit} style={{
        width: '100%', maxWidth: 360, padding: 32,
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="assets/svg/chords-icon-dark.svg" alt="" width="36" height="36"
                 style={{ borderRadius: 8, display: 'block' }} />
            <div style={{ fontWeight: 700, fontSize: 22 }}>chords</div>
          </div>
          <div className="t-muted" style={{ marginTop: 8 }}>Sign in to your library</div>
        </div>
        {native && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 500 }}>Server</label>
            <input
              className="input"
              value={server}
              onChange={e => setServerInput(e.target.value)}
              placeholder="https://your-chords-server"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 500 }}>Handle or email</label>
          <input
            className="input"
            value={handle}
            onChange={e => setHandle(e.target.value)}
            placeholder="@handle or email"
            autoComplete="username"
            required
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 500 }}>Password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            required
          />
        </div>
        {error && <div style={{ color: 'var(--destructive)', fontSize: 13 }}>{error}</div>}
        <Btn variant="primary" type="submit" disabled={busy || (native && !server.trim())}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Btn>
      </form>
    </div>
  );
}

// ---------- LoadingScreen ----------
function LoadingScreen() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: 'var(--background)', color: 'var(--muted-foreground)',
    }}>
      Loading…
    </div>
  );
}

// ---------- InviteSignupScreen ----------
function InviteSignupScreen({ token, onSetSession }) {
  const [invite, setInvite] = useStateA(null);
  const [error, setError] = useStateA('');
  const [busy, setBusy] = useStateA(true);

  const [name, setName] = useStateA('');
  const [handle, setHandle] = useStateA('');
  const [email, setEmail] = useStateA('');
  const [password, setPassword] = useStateA('');

  useEffectA(() => {
    window.IT.api(`/invites/${token}`)
      .then(info => {
        if (!info.valid) {
          setError(info.reason || 'Invalid invite link.');
        } else {
          setInvite(info);
          if (info.email) setEmail(info.email);
        }
      })
      .catch(err => setError('Could not check invite.'))
      .finally(() => setBusy(false));
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await window.IT.api(`/invites/${token}/accept`, {
        method: 'POST',
        body: { name, handle: handle.trim(), email: email.trim(), password }
      });
      await onSetSession(data);
      window.history.replaceState({}, '', window.location.pathname);
    } catch (err) {
      setError(err.message || 'Signup failed');
      setBusy(false);
    }
  }

  if (busy && !invite && !error) {
    return <LoadingScreen />;
  }

  if (error && !invite) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--background)' }}>
        <div style={{ maxWidth: 360, padding: 32, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 8, color: 'var(--destructive)' }}>Invite invalid</div>
          <div style={{ fontSize: 14 }}>{error}</div>
          <Btn variant="outline" style={{ marginTop: 16, width: '100%' }} onClick={() => window.location.href = '/'}>Go to Login</Btn>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: 'var(--background)', padding: 16
    }}>
      <form onSubmit={submit} style={{
        width: '100%', maxWidth: 380, padding: 32,
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 22 }}>Join chords</div>
          <div className="t-muted" style={{ marginTop: 4 }}>Create your account</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 500 }}>Name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Jamie Rivera" required />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 500 }}>Handle</label>
          <input className="input" value={handle} onChange={e => setHandle(e.target.value)} placeholder="jamie" required />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 500 }}>Email</label>
          <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jamie@example.com" disabled={!!invite.email} required />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 500 }}>Password</label>
          <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" minLength={6} required />
        </div>
        {error && <div style={{ color: 'var(--destructive)', fontSize: 13 }}>{error}</div>}
        <Btn variant="primary" type="submit" disabled={busy || password.length < 6}>
          {busy ? 'Creating account…' : 'Sign up'}
        </Btn>
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <a href="/" style={{ fontSize: 13, color: 'var(--muted-foreground)', textDecoration: 'none' }}>Already have an account? Sign in</a>
        </div>
      </form>
    </div>
  );
}

// ---------- store hook ----------
function useStore() {
  const [loading, setLoading] = useStateA(true);
  const [currentUser, setCurrentUser] = useStateA(null);
  const [songs, setSongs] = useStateA([]);
  const [playlists, setPlaylists] = useStateA([]);
  const [inbox, setInbox] = useStateA([]);
  // Flips true when the SSE stream reports a build id newer than the one this
  // page loaded (see LOADED_BUILD) — i.e. a deploy happened under us.
  const [updateReady, setUpdateReady] = useStateA(false);

  function _normalizeUsers(users, meId) {
    const normalized = users.map(u => ({ ...u, handle: '@' + u.handle, me: u.id === meId }));
    window.IT.USERS = normalized;
    return normalized;
  }

  function _normalizeInbox(items) {
    // Map createdAt → time so screens can use item.time
    return items.map(i => ({ ...i, time: i.createdAt }));
  }

  const _loadAll = useCallbackA(async (me) => {
    const [songsData, playlistsData, inboxData, usersData] = await Promise.all([
      window.IT.api('/songs'),
      window.IT.api('/playlists'),
      window.IT.api('/inbox'),
      window.IT.api('/users'),
    ]);
    _normalizeUsers(usersData, me.id);
    setSongs(songsData);
    setPlaylists(playlistsData);
    setInbox(_normalizeInbox(inboxData));
  }, []);

  useEffectA(() => {
    if (!window.IT.getToken()) { setLoading(false); return; }
    window.IT.api('/auth/me')
      .then(me => { setCurrentUser(me); return _loadAll(me); })
      .catch(err => { if (err.status === 401) window.IT.clearToken(); })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallbackA(async (handle, password) => {
    const data = await window.IT.api('/auth/login', { method: 'POST', body: { handle, password } });
    window.IT.setToken(data.accessToken);
    setCurrentUser(data.user);
    await _loadAll(data.user);
    setLoading(false);
  }, [_loadAll]);

  const setSession = useCallbackA(async (data) => {
    window.IT.setToken(data.accessToken);
    setCurrentUser(data.user);
    await _loadAll(data.user);
    setLoading(false);
  }, [_loadAll]);

  const logout = useCallbackA(() => {
    window.IT.clearToken();
    setCurrentUser(null);
    setSongs([]); setPlaylists([]); setInbox([]);
    window.IT.USERS = [];
  }, []);

  // ---------------------------------------------------------------------------
  // Songs
  // ---------------------------------------------------------------------------

  const createSong = useCallbackA(async (draft) => {
    const song = await window.IT.api('/songs', {
      method: 'POST',
      body: {
        title: draft.title || 'Untitled',
        artist: draft.artist || 'Unknown',
        tags: draft.tags || [],
        key: draft.key || 'C',
        capo: +draft.capo || 0,
        tempo: +draft.tempo || 90,
        body: draft.body || '',
      },
    });
    setSongs(s => [song, ...s]);
    return song.id;
  }, []);

  // A song can live in the library (in `songs`) and/or be a playlist-owned copy
  // (embedded in a playlist's entries). These helpers keep both places in sync.
  const _syncSong = useCallbackA((updated) => {
    setSongs(s => s.map(sg => sg.id === updated.id ? updated : sg));
    setPlaylists(ps => ps.map(p => ({
      ...p,
      entries: p.entries.map(e => e.songId === updated.id ? { ...e, song: updated } : e),
    })));
  }, []);

  const _patchSong = useCallbackA((id, patch) => {
    const stamp = Date.now();
    setSongs(s => s.map(sg => sg.id === id ? { ...sg, ...patch, updatedAt: stamp } : sg));
    setPlaylists(ps => ps.map(p => ({
      ...p,
      entries: p.entries.map(e => e.songId === id ? { ...e, song: { ...e.song, ...patch, updatedAt: stamp } } : e),
    })));
  }, []);

  const updateSongMeta = useCallbackA(async (id, patch) => {
    const song = await window.IT.api(`/songs/${id}`, { method: 'PUT', body: patch });
    _syncSong(song);
  }, [_syncSong]);

  // Optimistic — called on every key/capo/tempo tap in song view.
  const updateSong = useCallbackA((songId, patch) => {
    _patchSong(songId, patch);
    window.IT.api(`/songs/${songId}`, { method: 'PUT', body: patch })
      .then(updated => _syncSong(updated))
      .catch(console.error);
  }, [_patchSong, _syncSong]);

  const saveEdit = useCallbackA(async (songId, draft) => {
    const updatedSong = await window.IT.api(`/songs/${songId}`, { method: 'PUT', body: {
      title: draft.title, artist: draft.artist, tags: draft.tags,
      key: draft.key, capo: +draft.capo, tempo: +draft.tempo, body: draft.body,
    }});
    _syncSong(updatedSong);
  }, [_syncSong]);

  const deleteSong = useCallbackA(async (id) => {
    setSongs(s => s.filter(sg => sg.id !== id));
    setPlaylists(ps => ps.map(p => ({ ...p, entries: p.entries.filter(e => e.songId !== id) })));
    await window.IT.api(`/songs/${id}`, { method: 'DELETE' }).catch(console.error);
  }, []);

  const duplicateSong = useCallbackA(async (song) => {
    const copy = await window.IT.api(`/songs/${song.id}/duplicate`, { method: 'POST' });
    setSongs(s => [copy, ...s]);
  }, []);

  // Copy a song (typically a playlist-owned one) into the library as an
  // independent song.
  const copySongToLibrary = useCallbackA(async (songId) => {
    const copy = await window.IT.api(`/songs/${songId}/copy-to-library`, { method: 'POST' });
    setSongs(s => [copy, ...s]);
    return copy;
  }, []);

  // ---------------------------------------------------------------------------
  // Import / export (portable JSON files)
  // ---------------------------------------------------------------------------

  const exportSong = useCallbackA(async (song) => {
    const bundle = await window.IT.api(`/transfer/song/${song.id}`);
    window.IT.downloadJSON(safeFileName(song.title || 'song'), bundle);
  }, []);

  const exportLibrary = useCallbackA(async () => {
    const bundle = await window.IT.api('/transfer/songs');
    window.IT.downloadJSON('chords-library', bundle);
    return bundle.songs.length;
  }, []);

  const exportPlaylist = useCallbackA(async (pl) => {
    const bundle = await window.IT.api(`/transfer/playlist/${pl.id}`);
    window.IT.downloadJSON(safeFileName(pl.name || 'playlist'), bundle);
  }, []);

  // Pick a .json file, import it server-side, then fold the result into state.
  // Resolves null if the picker was cancelled.
  const importFromFile = useCallbackA(async () => {
    const bundle = await window.IT.pickJSONFile();
    if (!bundle) return null;
    const result = await window.IT.api('/transfer/import', { method: 'POST', body: bundle });
    if (result.kind === 'playlist') {
      setPlaylists(ps => [result.playlist, ...ps]);
      return { kind: 'playlist', playlist: result.playlist };
    }
    setSongs(s => [...result.songs, ...s]);
    return { kind: 'songs', count: result.songs.length };
  }, []);

  // ---------------------------------------------------------------------------
  // Playlists
  // ---------------------------------------------------------------------------

  const createPlaylist = useCallbackA(async (name) => {
    const pl = await window.IT.api('/playlists', { method: 'POST', body: { name } });
    setPlaylists(ps => [pl, ...ps]);
    return pl.id;
  }, []);

  // Add an existing library song to a playlist — the playlist gets its own
  // independent copy (no link back to the library song).
  const addToPlaylist = useCallbackA(async (songId, playlistId) => {
    const pl = await window.IT.api(`/playlists/${playlistId}/songs`, {
      method: 'POST', body: { songId },
    });
    setPlaylists(ps => ps.map(p => p.id === playlistId ? pl : p));
  }, []);

  // Create a brand-new playlist-owned song from an imported/extracted payload.
  const importSongToPlaylist = useCallbackA(async (song, playlistId) => {
    const pl = await window.IT.api(`/playlists/${playlistId}/songs`, {
      method: 'POST', body: { song },
    });
    setPlaylists(ps => ps.map(p => p.id === playlistId ? pl : p));
  }, []);

  const removeFromPlaylist = useCallbackA(async (songId, playlistId) => {
    const pl = await window.IT.api(`/playlists/${playlistId}/songs/${songId}`, { method: 'DELETE' });
    setPlaylists(ps => ps.map(p => p.id === playlistId ? pl : p));
  }, []);

  // "Send a copy" — lands in each recipient's inbox; they get their own
  // independent copy once they accept (mirrors how song sharing works).
  const sharePlaylist = useCallbackA(async (pl, userIds, note) => {
    await window.IT.api('/inbox/share-playlist', {
      method: 'POST', body: { playlistId: pl.id, userIds, note },
    });
  }, []);

  // "Shared mode" — sends an invite to each recipient's inbox; accepting it
  // makes them a collaborator on the same (live) playlist.
  const sharePlaylistShared = useCallbackA(async (pl, userIds) => {
    await window.IT.api('/inbox/share-playlist', {
      method: 'POST', body: { playlistId: pl.id, userIds, mode: 'shared' },
    });
  }, []);

  const updatePlaylist = useCallbackA(async (id, patch) => {
    const updated = await window.IT.api(`/playlists/${id}`, { method: 'PUT', body: patch });
    setPlaylists(ps => ps.map(p => p.id === id ? updated : p));
  }, []);

  const deletePlaylist = useCallbackA(async (id) => {
    setPlaylists(ps => ps.filter(p => p.id !== id));
    try {
      return await window.IT.api(`/playlists/${id}`, { method: 'DELETE' });
    } catch (e) { console.error(e); return null; }
  }, []);

  // Read-only public share link (owner only). Returns the updated playlist.
  const createShareLink = useCallbackA(async (id) => {
    const updated = await window.IT.api(`/playlists/${id}/share-link`, { method: 'POST' });
    setPlaylists(ps => ps.map(p => p.id === id ? updated : p));
    return updated;
  }, []);

  const removeShareLink = useCallbackA(async (id) => {
    const updated = await window.IT.api(`/playlists/${id}/share-link`, { method: 'DELETE' });
    setPlaylists(ps => ps.map(p => p.id === id ? updated : p));
    return updated;
  }, []);

  const reorderPlaylist = useCallbackA(async (id, songIds) => {
    // Optimistic: reorder the embedded entries immediately.
    setPlaylists(ps => ps.map(p => {
      if (p.id !== id) return p;
      const byId = new Map(p.entries.map(e => [e.songId, e]));
      const entries = songIds.map((sid, i) => ({ ...byId.get(sid), songId: sid, position: i }))
                             .filter(e => byId.has(e.songId));
      return { ...p, entries };
    }));
    const pl = await window.IT.api(`/playlists/${id}/reorder`, { method: 'PUT', body: { songIds } });
    setPlaylists(ps => ps.map(p => p.id === id ? pl : p));
  }, []);

  const shareSong = useCallbackA(async (song, userIds, note) => {
    await window.IT.api('/inbox/share-song', {
      method: 'POST', body: { songId: song.id, userIds, note },
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Inbox
  // ---------------------------------------------------------------------------

  const dismissInbox = useCallbackA(async (id) => {
    setInbox(i => i.filter(x => x.id !== id));
    await window.IT.api(`/inbox/${id}`, { method: 'DELETE' }).catch(console.error);
  }, []);

  const markAllRead = useCallbackA(async () => {
    setInbox(i => i.map(x => ({ ...x, unread: false })));
    await window.IT.api('/inbox/read-all', { method: 'PUT' }).catch(console.error);
  }, []);

  const acceptSong = useCallbackA(async (item) => {
    if (!item || item.kind !== 'song') return;
    const { songId } = await window.IT.api(`/inbox/${item.id}/accept`, { method: 'POST' });
    setInbox(i => i.filter(x => x.id !== item.id));
    const song = await window.IT.api(`/songs/${songId}`);
    setSongs(s => [song, ...s]);
  }, []);

  const acceptPlaylist = useCallbackA(async (item) => {
    const { playlistId } = await window.IT.api(`/inbox/${item.id}/accept`, { method: 'POST' });
    setInbox(i => i.filter(x => x.id !== item.id));
    const pl = await window.IT.api(`/playlists/${playlistId}`);
    setPlaylists(ps => [pl, ...ps.filter(p => p.id !== pl.id)]);
  }, []);

  const replaceWithIncoming = useCallbackA(async (item) => {
    await window.IT.api(`/inbox/${item.id}/replace`, { method: 'POST' });
    setInbox(i => i.filter(x => x.id !== item.id));
    const song = await window.IT.api(`/songs/${item.matchSongId}`);
    setSongs(s => s.map(sg => sg.id === item.matchSongId ? song : sg));
  }, []);

    // ---------------------------------------------------------------------------
  // Account / admin
  // ---------------------------------------------------------------------------

  const updateMe = useCallbackA(async (patch) => {
    const updated = await window.IT.api('/users/me', { method: 'PUT', body: patch });
    setCurrentUser(updated);
    // Update the entry in window.IT.USERS too so other screens see fresh data
    window.IT.USERS = window.IT.USERS.map(u =>
      u.id === updated.id ? { ...updated, handle: '@' + updated.handle, me: true } : u);
    return updated;
  }, []);

  const changePassword = useCallbackA(async (currentPassword, newPassword) => {
    await window.IT.api('/users/me/password', {
      method: 'PUT', body: { currentPassword, newPassword },
    });
  }, []);


  const getPlaylist = useCallbackA((id) => playlists.find(p => p.id === id), [playlists]);
  const getSong = useCallbackA((id) => songs.find(s => s.id === id), [songs]);

  // ---------------------------------------------------------------------------
  // Live updates (SSE)
  // The server pushes tiny signals over /events; we react by re-fetching just
  // the affected slice so inbox items and shared-playlist edits show up without
  // a reload. See backend/events.py.
  // ---------------------------------------------------------------------------
  useEffectA(() => {
    if (!currentUser) return;

    const refetchInbox = () => window.IT.api('/inbox')
      .then(items => setInbox(_normalizeInbox(items)))
      .catch(() => {});
    const refetchSongs = () => window.IT.api('/songs')
      .then(setSongs)
      .catch(() => {});
    // A song may be a library song and/or a playlist-owned copy — sync wherever
    // its id lives. (Deletes come through as a 'songs' list refetch instead.)
    const refetchSong = (id) => window.IT.api(`/songs/${id}`)
      .then(_syncSong)
      .catch(() => {});
    const refetchPlaylists = () => window.IT.api('/playlists')
      .then(setPlaylists)
      .catch(() => {});
    const refetchPlaylist = (id) => window.IT.api(`/playlists/${id}`)
      .then(pl => setPlaylists(ps => ps.some(p => p.id === pl.id)
        ? ps.map(p => p.id === pl.id ? pl : p)
        : [pl, ...ps]))
      .catch(err => { if (err.status === 404) setPlaylists(ps => ps.filter(p => p.id !== id)); });

    const onEvent = (evt) => {
      if (!evt || !evt.type) return;
      // First frame of every (re)connect: the server's current build id. If it
      // differs from what we loaded, a new version is live — prompt to reload.
      // (Once true it stays true; reconnect churn can't unset it.)
      if (evt.type === 'hello') {
        if (LOADED_BUILD && evt.build && evt.build !== LOADED_BUILD) setUpdateReady(true);
        return;
      }
      // Skip the echo of a change this very tab made (it already updated locally).
      if (evt.origin && evt.origin === window.IT.clientId) return;
      if (evt.type === 'inbox') refetchInbox();
      else if (evt.type === 'song' && evt.id) refetchSong(evt.id);
      else if (evt.type === 'songs') refetchSongs();
      else if (evt.type === 'playlist' && evt.id) refetchPlaylist(evt.id);
      else if (evt.type === 'playlists') refetchPlaylists();
    };

    const ac = new AbortController();
    let stopped = false;
    let backoff = 1000;
    (async () => {
      while (!stopped) {
        try {
          await window.IT.openEventStream('/events', onEvent, ac.signal);
          backoff = 1000;   // clean server close → reconnect promptly
        } catch (err) {
          if (ac.signal.aborted || err.status === 401) return;
        }
        if (stopped) return;
        await new Promise(r => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 15000);
      }
    })();

    return () => { stopped = true; ac.abort(); };
  }, [currentUser?.id]);

  const stubs = { openEditor: () => {}, openShareFor: () => {}, openAddToPlaylist: () => {} };

  return useMemoA(() => ({
    loading, currentUser, login, logout, setSession,
    songs, playlists, inbox,
    unreadCount: inbox.filter(i => i.unread).length,
    createSong, updateSongMeta, updateSong, saveEdit,
    deleteSong, duplicateSong, copySongToLibrary,
    exportSong, exportLibrary, exportPlaylist, importFromFile,
    createPlaylist, sharePlaylist, sharePlaylistShared, shareSong, addToPlaylist, importSongToPlaylist, removeFromPlaylist, updatePlaylist, deletePlaylist, reorderPlaylist,
    createShareLink, removeShareLink,
    acceptSong, acceptPlaylist, dismissInbox, markAllRead,
    replaceWithIncoming, 
    updateMe, changePassword,
    getPlaylist, getSong,
    updateReady,
    ...stubs,
  }), [loading, currentUser, songs, playlists, inbox, updateReady]);
}

// ---------- theme mapping ----------
const THEME_MAP = {
  zinc:   { light: 'zinc-light',   dark: 'zinc-dark' },
  blue:   { light: 'blue-light',   dark: 'blue-dark' },
  orange: { light: 'orange-light', dark: 'stone-dark' },
  green:  { light: 'green-light',  dark: 'zinc-dark' },
};

const DEFAULTS = /*EDITMODE-BEGIN*/{
  "palette": "zinc",
  "mode": "dark",
  "lyricSize": 16,
  "keepAwake": true,
  "chordColor": "orange",
  "metronome": false,
  "metronomeBeats": 4,
  "barAtTop": false
}/*EDITMODE-END*/;

// Lyric text size is a per-device preference, persisted client-side.
const LYRIC_SIZE_KEY = 'chords.lyricSize';
function loadLyricSize() {
  try {
    const v = parseInt(localStorage.getItem(LYRIC_SIZE_KEY), 10);
    if (!isNaN(v) && v >= 12 && v <= 32) return v;
  } catch (e) {}
  return DEFAULTS.lyricSize;
}

// Chord chip color in song view — 'orange' (brand accent) or 'grey' (neutral,
// higher-contrast). Per-device preference, persisted client-side like the size.
const CHORD_COLOR_KEY = 'chords.chordColor';
function loadChordColor() {
  try {
    const v = localStorage.getItem(CHORD_COLOR_KEY);
    if (v === 'orange' || v === 'grey') return v;
  } catch (e) {}
  return DEFAULTS.chordColor;
}

// Metronome — blink the playback bar to the song's tempo while autoscrolling.
// Per-device preference, persisted client-side.
const METRONOME_KEY = 'chords.metronome';
function loadMetronome() {
  try {
    const v = localStorage.getItem(METRONOME_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch (e) {}
  return DEFAULTS.metronome;
}

// How many count-in beats the metronome flashes before scrolling begins.
const METRONOME_BEATS_KEY = 'chords.metronomeBeats';
function loadMetronomeBeats() {
  try {
    const v = parseInt(localStorage.getItem(METRONOME_BEATS_KEY), 10);
    if (!isNaN(v) && v >= 1 && v <= 16) return v;
  } catch (e) {}
  return DEFAULTS.metronomeBeats;
}

// Autoscroll bar position — render the playback controls at the top of the song
// view instead of the bottom. Per-device preference, persisted client-side.
const BAR_AT_TOP_KEY = 'chords.barAtTop';
function loadBarAtTop() {
  try {
    const v = localStorage.getItem(BAR_AT_TOP_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch (e) {}
  return DEFAULTS.barAtTop;
}

// ---------- Public read-only playlist (shared link) ----------
function PublicPlaylistView({ token, tweaks, setTweaks }) {
  const [data, setData] = useStateA(null);   // { name, gradient, songs: [...] }
  const [error, setError] = useStateA('');
  const [openId, setOpenId] = useStateA(null);

  useEffectA(() => {
    let alive = true;
    window.IT.api('/public/playlists/' + encodeURIComponent(token))
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(e.message || 'This shared playlist link is not available.'); });
    return () => { alive = false; };
  }, [token]);

  const setLyricSize = (n) => {
    setTweaks(t => ({ ...t, lyricSize: n }));
    try { localStorage.setItem(LYRIC_SIZE_KEY, String(n)); } catch (e) {}
  };
  const toggleMode = () => setTweaks(t => ({ ...t, mode: t.mode === 'dark' ? 'light' : 'dark' }));

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--background)', padding: 16 }}>
        <div style={{ maxWidth: 380, textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 8 }}>Link unavailable</div>
          <div className="t-muted" style={{ fontSize: 14 }}>{error}</div>
          <Btn variant="outline" style={{ marginTop: 16 }} onClick={() => (window.location.href = '/')}>Go to chords</Btn>
        </div>
      </div>
    );
  }
  if (!data) return <LoadingScreen />;

  const songs = data.songs || [];

  // A song is open → read-only SongView with playlist context for prev/next.
  if (openId) {
    const idx = songs.findIndex(s => s.id === openId);
    const song = songs[idx];
    if (!song) { setOpenId(null); return null; }
    const plCtx = {
      id: 'public', name: data.name, shared: false, collaborators: [],
      entries: songs.map((s, i) => ({ songId: s.id, position: i, song: s })),
    };
    const prevId = idx > 0 ? songs[idx - 1].id : null;
    const nextId = idx < songs.length - 1 ? songs[idx + 1].id : null;
    return (
      <ToastProvider>
        <div className="app no-chrome">
          <main className="main">
            <div className="scroll" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <SongView
                song={song}
                playlist={plCtx}
                store={null}
                readOnly
                onBack={() => setOpenId(null)}
                onPrev={prevId ? () => setOpenId(prevId) : null}
                onNext={nextId ? () => setOpenId(nextId) : null}
                lyricSize={tweaks.lyricSize}
                setLyricSize={setLyricSize}
                keepAwake={tweaks.keepAwake}
                chordColor={tweaks.chordColor}
                metronome={tweaks.metronome}
                metronomeBeats={tweaks.metronomeBeats}
                barAtTop={tweaks.barAtTop}
              />
            </div>
          </main>
        </div>
      </ToastProvider>
    );
  }

  // Playlist listing.
  return (
    <ToastProvider>
      <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          <img className="brand-mark" src="assets/svg/chords-icon-dark.svg" alt="chords" width="32" height="32" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em' }}>{data.name}</div>
            <div className="t-muted" style={{ fontSize: 12 }}>
              Shared playlist · read-only · {songs.length} {songs.length === 1 ? 'song' : 'songs'}
            </div>
          </div>
          <IconBtn icon={tweaks.mode === 'dark' ? 'sun' : 'moon'} label="Toggle mode" onClick={toggleMode} />
        </div>
        <div className="page" style={{ maxWidth: 760, margin: '0 auto' }}>
          {songs.length === 0 ? (
            <Empty icon="music" title="Empty playlist" />
          ) : (
            <div className="song-list pl-song-list">
              {songs.map((s, i) => (
                <div key={s.id} className="song-row pl-song-row" onClick={() => setOpenId(s.id)}>
                  <span className="pl-index">{(i + 1).toString().padStart(2, '0')}</span>
                  <div className="sr-content">
                    <div className="sr-meta">
                      <div className="sr-title">{s.title}</div>
                      <div className="sr-artist">{s.artist}</div>
                    </div>
                    <div className="sr-key"><strong>{s.key}</strong>{s.capo > 0 ? ` · Capo ${s.capo}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="t-muted" style={{ textAlign: 'center', fontSize: 12, marginTop: 24 }}>
            Powered by <a href="/" style={{ color: 'var(--muted-foreground)' }}>chords</a>
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}

// ---------- main App ----------
function App() {
  const store = useStore();
  const [tweaks, setTweaks] = useStateA(() => ({ ...DEFAULTS, lyricSize: loadLyricSize(), chordColor: loadChordColor(), metronome: loadMetronome(), metronomeBeats: loadMetronomeBeats(), barAtTop: loadBarAtTop() }));

  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get('invite');
  const shareToken = params.get('playlist');

  // apply theme attribute on root
  useEffectA(() => {
    const themeName = THEME_MAP[tweaks.palette || 'zinc'][tweaks.mode || 'dark'] || 'zinc-dark';
    document.documentElement.setAttribute('data-theme', themeName);
  }, [tweaks.palette, tweaks.mode]);

  // Drive the app-shell height from the *actually visible* viewport. iOS Safari's
  // `100vh` is the toolbar-hidden height (too tall — the bottom bar lands behind
  // the toolbar / home indicator) and `100dvh` is unreliable across iOS/iPadOS
  // versions, split-view, and the toolbar show/hide transition. visualViewport
  // reports the real visible height; CSS falls back to 100dvh/100vh before this
  // runs. scroll fires too because hiding the toolbar changes the visible height.
  useEffectA(() => {
    const vv = window.visualViewport;
    const setH = () => {
      const h = (vv && vv.height) || window.innerHeight;
      document.documentElement.style.setProperty('--app-height', h + 'px');
    };
    setH();
    if (vv) {
      vv.addEventListener('resize', setH);
      vv.addEventListener('scroll', setH);
    }
    window.addEventListener('resize', setH);
    window.addEventListener('orientationchange', setH);
    return () => {
      if (vv) {
        vv.removeEventListener('resize', setH);
        vv.removeEventListener('scroll', setH);
      }
      window.removeEventListener('resize', setH);
      window.removeEventListener('orientationchange', setH);
    };
  }, []);

  // A read-only public share link takes precedence over everything — it works
  // logged-out, and even a logged-in user lands in the read-only view (so they
  // can't edit a playlist they opened via someone's share link).
  if (shareToken) {
    return <PublicPlaylistView token={shareToken} tweaks={tweaks} setTweaks={setTweaks} />;
  }

  if (store.loading) return <LoadingScreen />;
  if (!store.currentUser) {
    if (inviteToken) {
      return <InviteSignupScreen token={inviteToken} onSetSession={store.setSession} />;
    }
    return <LoginScreen onLogin={store.login} />;
  }

  return <AppShell store={store} tweaks={tweaks} setTweaks={setTweaks} />;
}

// Shown when the server has deployed a newer build than this page loaded. We
// prompt rather than auto-reload so we never discard unsaved work or yank the
// user mid-song; reloading fetches the fresh index.html and assets.
function UpdateBanner() {
  return (
    <div role="status" style={{
      position: 'fixed', zIndex: 200, left: '50%',
      bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
      transform: 'translateX(-50%)',
      display: 'flex', alignItems: 'center', gap: 12,
      maxWidth: 'calc(100vw - 24px)',
      padding: '10px 10px 10px 16px',
      background: 'var(--popover)', color: 'var(--popover-foreground)',
      border: '1px solid var(--border)', borderRadius: 12,
      boxShadow: '0 8px 28px rgba(0,0,0,.35)',
    }}>
      <Icon name="refresh" size={16} />
      <span style={{ fontSize: 14, whiteSpace: 'nowrap' }}>A new version is available.</span>
      <Btn variant="primary" size="sm" onClick={() => window.location.reload()}>Reload</Btn>
    </div>
  );
}

function AppShell({ store, tweaks, setTweaks }) {
  // route shapes:
  //   { name: 'library' | 'playlists' | 'inbox' | 'settings' }
  //   { name: 'song', songId, playlistId? }
  //   { name: 'playlist', playlistId }
  const [route, setRoute] = useStateA({ name: 'library' });
  // editor state: { song, isNew }
  const [editor, setEditor] = useStateA(null);
    const [shareSong, setShareSong] = useStateA(null);
  const [addToPlaylistFor, setAddToPlaylistFor] = useStateA(null); // song

  // Tweaks panel host protocol
  useEffectA(() => {
    const onMsg = (e) => {
      if (!e || !e.data) return;
      if (e.data.type === '__activate_edit_mode') window.__setTweaksOpen && window.__setTweaksOpen(true);
      if (e.data.type === '__deactivate_edit_mode') window.__setTweaksOpen && window.__setTweaksOpen(false);
    };
    window.addEventListener('message', onMsg);
    try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch (e) {}
    return () => window.removeEventListener('message', onMsg);
  }, []);

  function setTweak(k, v) {
    const edits = typeof k === 'object' ? k : { [k]: v };
    setTweaks(t => ({ ...t, ...edits }));
    // Lyric text size persists across reloads on this device.
    if ('lyricSize' in edits) {
      try { localStorage.setItem(LYRIC_SIZE_KEY, String(edits.lyricSize)); } catch (e) {}
    }
    // Chord color is likewise a per-device preference.
    if ('chordColor' in edits) {
      try { localStorage.setItem(CHORD_COLOR_KEY, String(edits.chordColor)); } catch (e) {}
    }
    if ('metronome' in edits) {
      try { localStorage.setItem(METRONOME_KEY, edits.metronome ? '1' : '0'); } catch (e) {}
    }
    if ('metronomeBeats' in edits) {
      try { localStorage.setItem(METRONOME_BEATS_KEY, String(edits.metronomeBeats)); } catch (e) {}
    }
    if ('barAtTop' in edits) {
      try { localStorage.setItem(BAR_AT_TOP_KEY, edits.barAtTop ? '1' : '0'); } catch (e) {}
    }
    try { window.parent.postMessage({ type: '__edit_mode_set_keys', edits }, '*'); } catch (e) {}
  }

  // wire up store action handlers
  const storeWithActions = useMemoA(() => ({
    ...store,
    openEditor: (song) => setEditor({ song, isNew: false }),
    openShareFor: (song) => setShareSong(song),
    
    openAddToPlaylist: (song) => setAddToPlaylistFor(song),
  }), [store]);

  // Active song + version (when route is 'song')
  const currentPlaylistForSong = route.name === 'song' && route.playlistId
    ? store.playlists.find(p => p.id === route.playlistId) : null;
  // A song opened inside a playlist is the playlist-owned copy, carried in the
  // playlist's entries. Otherwise it's a library song.
  const currentSong = route.name !== 'song' ? null
    : (currentPlaylistForSong
        ? (currentPlaylistForSong.entries.find(e => e.songId === route.songId)?.song
           || store.songs.find(s => s.id === route.songId))
        : store.songs.find(s => s.id === route.songId));
  
  const currentPlaylist = currentPlaylistForSong;

  const goLibrary = () => setRoute({ name: 'library' });
  const goSong = (s) => setRoute({ name: 'song', songId: s.id });
  const goSongPlaylist = (songId, playlistId) => setRoute({ name: 'song', songId, playlistId });
  const goPlaylist = (p) => setRoute({ name: 'playlist', playlistId: p.id });

  const navItems = [
    { key: 'library',  label: 'Library',   icon: 'library' },
    { key: 'playlists',label: 'Playlists', icon: 'list' },
    { key: 'import',   label: 'Import',    icon: 'download' },
    { key: 'inbox',    label: 'Inbox',     icon: 'inbox', count: store.unreadCount || 0 },
    { key: 'settings', label: 'Settings',  icon: 'settings' },
  ];

  const activeNav = route.name === 'playlist' ? 'playlists' :
                    route.name === 'song' ? (route.playlistId ? 'playlists' : 'library') :
                    route.name;

  const noChrome = route.name === 'song';

  const me = store.currentUser;

  return (
    <ToastProvider>
      {store.updateReady && <UpdateBanner />}
      <div className={`app ${noChrome ? 'no-chrome' : ''}`}>
        <aside className="sidebar">
          <div className="sidebar-brand">
            <img className="brand-mark" src="assets/svg/chords-icon-dark.svg" alt="chords" width="44" height="44" />
            <div className="brand-name">chords</div>
          </div>
          {navItems.map(n => (
            <div key={n.key} className={`nav-item ${activeNav === n.key ? 'active' : ''}`}
                 onClick={() => setRoute({ name: n.key })}>
              <span className="icon"><Icon name={n.icon} size={16} /></span>
              <span>{n.label}</span>
              {n.count > 0 && <span className="count">{n.count}</span>}
            </div>
          ))}

          <div className="sidebar-bottom">
            <Avatar user={me} size={32} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sb-user-name">{me.name}</div>
              <div className="sb-user-handle">@{me.handle}</div>
            </div>
            <IconBtn icon="logout" label="Sign out" onClick={store.logout} />
          </div>
        </aside>

        <main className="main">
          {!noChrome && (
            <div className="topbar">
              <div className="topbar-left">
                {route.name === 'library' && <>
                  <h1>Library</h1>
                  <span className="sub">· {store.songs.length} songs</span>
                </>}
                {route.name === 'playlists' && <h1>Playlists</h1>}
                {route.name === 'playlist' && <>
                  <Btn variant="ghost" size="sm" onClick={() => setRoute({ name: 'playlists' })}><Icon name="back" size={14} /></Btn>
                  <h1>{(store.playlists.find(p => p.id === route.playlistId) || {}).name || 'Playlist'}</h1>
                </>}
                {route.name === 'inbox' && <>
                  <h1>Inbox</h1>
                  {store.unreadCount > 0 && <Badge variant="primary">{store.unreadCount} new</Badge>}
                </>}
                {route.name === 'settings' && <h1>Settings</h1>}
              </div>
              <div className="topbar-right">
                <IconBtn icon={tweaks.mode === 'dark' ? 'sun' : 'moon'} label="Toggle mode"
                         onClick={() => setTweak('mode', tweaks.mode === 'dark' ? 'light' : 'dark')} />
                <div className="mobile-user">
                  <Avatar user={me} size={28} />
                  <div style={{ minWidth: 0, lineHeight: 1.3 }}>
                    <div className="sb-user-name">{me.name}</div>
                    <div className="sb-user-handle">@{me.handle}</div>
                  </div>
                  <IconBtn icon="logout" label="Sign out" onClick={store.logout} />
                </div>
              </div>
            </div>
          )}

          <div className="scroll" style={ noChrome ? { padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' } : {}}>
            {route.name === 'library' && (
              <LibraryScreen store={storeWithActions}
                             onOpen={(song, playlistId) => playlistId ? goSongPlaylist(song.id, playlistId) : goSong(song)}
                             onNewSong={() => setEditor({ isNew: true })} />
            )}
            {route.name === 'playlists' && (
              <PlaylistsScreen store={storeWithActions} onOpen={goPlaylist} />
            )}
            {route.name === 'import' && (
              <ImportScreen store={storeWithActions} onDone={goLibrary} />
            )}
            {route.name === 'playlist' && (() => {
              const pl = store.playlists.find(p => p.id === route.playlistId);
              if (!pl) return <div className="page"><Empty icon="list" title="Playlist not found" /></div>;
              return <PlaylistDetail playlist={pl} store={storeWithActions}
                                     onOpenSong={(songId) => goSongPlaylist(songId, pl.id)}
                                     onBack={() => setRoute({ name: 'playlists' })} />;
            })()}
            {route.name === 'inbox' && (
              <InboxScreen store={storeWithActions} />
            )}
            {route.name === 'settings' && (
              <SettingsScreen store={storeWithActions} tweaks={tweaks} setTweak={setTweak} />
            )}
            {route.name === "song" && currentSong && (() => {
              const plEntries = currentPlaylist ? currentPlaylist.entries : [];
              const idx = currentPlaylist ? plEntries.findIndex(e => e.songId === currentSong.id) : -1;
              const prevId = idx > 0 ? plEntries[idx - 1].songId : null;
              const nextId = idx >= 0 && idx < plEntries.length - 1 ? plEntries[idx + 1].songId : null;
              return (
              <SongView
                song={currentSong}
                playlist={currentPlaylist}
                store={storeWithActions}
                onBack={() => currentPlaylist ? setRoute({ name: "playlist", playlistId: currentPlaylist.id }) : goLibrary()}
                openShare={() => setShareSong(currentSong)}
                openAddToPlaylist={() => setAddToPlaylistFor(currentSong)}
                onEdit={() => setEditor({ song: currentSong, isNew: false })}
                onPrev={prevId ? () => goSongPlaylist(prevId, currentPlaylist.id) : null}
                onNext={nextId ? () => goSongPlaylist(nextId, currentPlaylist.id) : null}
                lyricSize={tweaks.lyricSize}
                setLyricSize={(n) => setTweak("lyricSize", n)}
                keepAwake={tweaks.keepAwake}
                chordColor={tweaks.chordColor}
                metronome={tweaks.metronome}
                metronomeBeats={tweaks.metronomeBeats}
                barAtTop={tweaks.barAtTop}
              />
              );
            })()}
            {route.name === 'song' && !currentSong && (
              <div className="page"><Empty icon="music" title="Song not found" action={<Btn variant="primary" onClick={goLibrary}>Back to library</Btn>} /></div>
            )}
          </div>
        </main>

        <nav className="bottom-nav">
          {navItems.map(n => (
            <button key={n.key} className={`bn-item ${activeNav === n.key ? 'active' : ''}`}
                    onClick={() => setRoute({ name: n.key })}>
              <Icon name={n.icon} size={20} />
              <span>{n.label}</span>
              {n.count > 0 && <span className="bn-dot"></span>}
            </button>
          ))}
        </nav>
      </div>

      {editor && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'var(--background)', overflowY: 'auto' }}>
          <EditorScreen
            song={editor.song || null}
            store={storeWithActions}
            onCancel={() => setEditor(null)}
            onSaved={() => setEditor(null)}
          />
        </div>
      )}


      <ShareSongDialog
        open={!!shareSong}
        song={shareSong}
        store={storeWithActions}
        onClose={() => setShareSong(null)}
      />

      <AddToPlaylistDialog
        open={!!addToPlaylistFor}
        song={addToPlaylistFor}
        store={storeWithActions}
        onClose={() => setAddToPlaylistFor(null)}
      />

      <CHORDSTweaksPanel tweaks={tweaks} setTweak={setTweak} />
    </ToastProvider>
  );
}

// ---------- Tweaks panel ----------
function CHORDSTweaksPanel({ tweaks, setTweak }) {
  const [open, setOpen] = useStateA(false);
  useEffectA(() => { window.__setTweaksOpen = setOpen; return () => { window.__setTweaksOpen = null; }; }, []);
  if (!open) return null;
  return (
    <TweaksPanel onClose={() => { setOpen(false); try { window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*'); } catch (e) {} }}>
      <TweakSection title="Theme">
        <TweakRadio label="Mode" value={tweaks.mode}
          options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
          onChange={(v) => setTweak('mode', v)} />
      </TweakSection>
      <TweakSection title="Song view">
        <TweakSlider label="Text size" value={tweaks.lyricSize} min={12} max={32} step={1} unit="px"
          onChange={(v) => setTweak('lyricSize', v)} />
      </TweakSection>
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById('app')).render(<App />);
