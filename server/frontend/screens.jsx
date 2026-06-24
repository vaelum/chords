/* Library, Playlists, Inbox, Settings, Editor, Versions drawer, Share & Add-to-playlist dialogs */

const { useState: useStateS, useEffect: useEffectS, useMemo: useMemoS, useRef: useRefS, useCallback: useCallbackS } = React;


// ===========================================================================
// LIBRARY
// ===========================================================================
function LibraryScreen({ store, onOpen, onNewSong }) {
  const [q, setQ] = useStateS('');
  // Multi-select filter chips. Each selected key is either `tag:<name>` or
  // `pl:<playlistId>`; an item matches if it satisfies ANY selected chip.
  const [selected, setSelected] = useStateS(() => new Set());
  const [sort, setSort] = useStateS('recent');
  const [showPlaylistSongs, setShowPlaylistSongs] = useStateS(true);
  const [moreFor, setMoreFor] = useStateS(null);      // library song: { song, el }
  const [plMoreFor, setPlMoreFor] = useStateS(null);   // playlist song: { song, playlist, el }
  const [confirmDel, setConfirmDel] = useStateS(null); // song pending delete
  const toast = useToast();
  const menu = useMenu();

  // Unified list: library songs (playlist = null) plus each playlist's own
  // copies, each tagged with the playlist it belongs to.
  const items = useMemoS(() => {
    const lib = store.songs.map(s => ({ song: s, playlist: null }));
    if (!showPlaylistSongs) return lib;
    const fromPlaylists = store.playlists.flatMap(p =>
      p.entries.filter(e => e.song).map(e => ({ song: e.song, playlist: p })));
    return lib.concat(fromPlaylists);
  }, [store.songs, store.playlists, showPlaylistSongs]);

  const hasPlaylistSongs = useMemoS(
    () => store.playlists.some(p => p.entries.some(e => e.song)),
    [store.playlists]);

  const allTags = useMemoS(() => {
    const s = new Set();
    items.forEach(it => it.song.tags.forEach(t => s.add(t)));
    return Array.from(s).sort();
  }, [items]);

  // Playlists that currently contribute songs to the list — shown as colored
  // filter chips. Respects the "show playlist songs" toggle via `items`.
  const playlistChips = useMemoS(() => {
    const seen = new Map();
    items.forEach(({ playlist: p }) => { if (p && !seen.has(p.id)) seen.set(p.id, p); });
    return Array.from(seen.values());
  }, [items]);

  function toggleChip(key) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const filtered = useMemoS(() => {
    let r = items.slice();
    if (q) {
      const ql = q.toLowerCase();
      r = r.filter(({ song: s, playlist: p }) =>
        s.title.toLowerCase().includes(ql) || s.artist.toLowerCase().includes(ql) ||
        s.tags.some(t => t.toLowerCase().includes(ql)) ||
        (p && p.name.toLowerCase().includes(ql)));
    }
    if (selected.size) {
      r = r.filter(({ song: s, playlist: p }) => {
        for (const key of selected) {
          if (key.startsWith('pl:')) { if (p && p.id === key.slice(3)) return true; }
          else if (s.tags.includes(key.slice(4))) return true;
        }
        return false;
      });
    }
    if (sort === 'title') r.sort((a, b) => a.song.title.localeCompare(b.song.title));
    else if (sort === 'artist') r.sort((a, b) => a.song.artist.localeCompare(b.song.artist));
    else r.sort((a, b) => b.song.updatedAt - a.song.updatedAt);
    return r;
  }, [items, q, selected, sort]);

  return (
    <div className="page">
      <div className="lib-toolbar">
        <div className="search"><SearchInput value={q} onChange={setQ} placeholder="Search songs, artists, tags..." /></div>
        <Btn variant="outline" size="sm" onClick={(e) => menu.openOn(e.currentTarget)}>
          <Icon name="sort" size={14} /> Sort: {sort === 'recent' ? 'Recent' : sort === 'title' ? 'Title' : 'Artist'}
        </Btn>
        <Btn variant="primary" size="sm" onClick={onNewSong}>
          <Icon name="plus" size={14} /> New song
        </Btn>
      </div>

      <Menu open={menu.open} anchor={menu.anchor} onClose={menu.close} items={[
        { label: 'Recently updated', icon: 'history', onSelect: () => setSort('recent') },
        { label: 'Title A → Z', icon: 'type', onSelect: () => setSort('title') },
        { label: 'Artist A → Z', icon: 'user', onSelect: () => setSort('artist') },
      ]} />

      <div className="tag-bar">
        <button className={`tag-chip ${selected.size === 0 ? 'on' : ''}`} onClick={() => setSelected(new Set())}>All</button>
        {playlistChips.map(p => {
          const key = 'pl:' + p.id;
          return (
            <button key={key} className={`tag-chip tag-chip-pl ${selected.has(key) ? 'on' : ''}`}
                    onClick={() => toggleChip(key)}>
              <Icon name="list" size={11} /> {p.name}
            </button>
          );
        })}
        {allTags.map(t => {
          const key = 'tag:' + t;
          return (
            <button key={key} className={`tag-chip ${selected.has(key) ? 'on' : ''}`}
                    onClick={() => toggleChip(key)}>{t}</button>
          );
        })}
      </div>

      <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span className="t-muted">{filtered.length} {filtered.length === 1 ? 'song' : 'songs'}</span>
        {hasPlaylistSongs && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <span className="t-muted" style={{ fontSize: 13 }}>Show playlist songs</span>
            <Switch on={showPlaylistSongs} onChange={setShowPlaylistSongs} />
          </label>
        )}
      </div>

      {filtered.length === 0 ? (
        <Empty icon="music" title="No songs match"
               desc="Try clearing the filter."
               action={<Btn variant="primary" onClick={onNewSong}><Icon name="plus" size={14} /> New song</Btn>} />
      ) : (
        <div className="song-list">
          {filtered.map(({ song, playlist }) => (
            <SongRow key={`${playlist ? playlist.id : 'lib'}:${song.id}`} song={song} playlist={playlist} onOpen={onOpen}
                     onMore={(el) => playlist ? setPlMoreFor({ song, playlist, el }) : setMoreFor({ song, el })} />
          ))}
        </div>
      )}

      <SongMoreMenu state={moreFor} onClose={() => setMoreFor(null)} store={store}
                    onDelete={(song) => setConfirmDel(song)} />
      <PlaylistSongMoreMenu state={plMoreFor} onClose={() => setPlMoreFor(null)} store={store} onOpen={onOpen} />

      <Dialog open={!!confirmDel} onClose={() => setConfirmDel(null)}>
        <div className="dialog-title">Delete “{confirmDel?.title}”?</div>
        <div className="dialog-desc">This removes the song from your library. This can’t be undone.</div>
        <div className="dialog-footer">
          <Btn variant="outline" onClick={() => setConfirmDel(null)}>Cancel</Btn>
          <Btn variant="destructive" onClick={() => {
            const s = confirmDel;
            store.deleteSong(s.id);
            setConfirmDel(null);
            toast({ title: 'Song deleted', desc: s.title, tone: 'destructive', icon: 'trash' });
          }}><Icon name="trash" size={14} /> Delete</Btn>
        </div>
      </Dialog>
    </div>
  );
}

function SongRow({ song, playlist, onOpen, onMore }) {
  return (
    <div className="song-row sr-lib" onClick={() => onOpen(song, playlist ? playlist.id : undefined)}>
      <div className="sr-content">
        <div className="sr-meta">
          <div className="sr-title">{song.title}</div>
          <div className="sr-artist">{song.artist}</div>
        </div>
        <div className="sr-tags">
          {playlist && (
            <span className="tag-pill sr-pl-pill" title={`In playlist “${playlist.name}”`}>
              <Icon name="list" size={10} /> {playlist.name}
            </span>
          )}
          {song.tags.slice(0, playlist ? 2 : 3).map(t => <span key={t} className="tag-pill">{t}</span>)}
        </div>
        <div className="sr-key"><strong>{song.key}</strong>{song.capo > 0 ? ` · Capo ${song.capo}` : ''}</div>
      </div>
      <IconBtn icon="more" label="More" onClick={(e) => { e.stopPropagation(); onMore(e.currentTarget); }} />
    </div>
  );
}

function SongMoreMenu({ state, onClose, store, onDelete }) {
  const toast = useToast();
  if (!state) return null;
  return (
    <Menu open={true} anchor={state.el} onClose={onClose} items={[
      { label: 'Open in editor', icon: 'edit', onSelect: () => store.openEditor(state.song) },
      { label: 'Add to playlist', icon: 'list', onSelect: () => store.openAddToPlaylist(state.song) },
      { label: 'Share', icon: 'share2', onSelect: () => store.openShareFor(state.song) },
            { label: 'Duplicate', icon: 'copy', onSelect: () => { store.duplicateSong(state.song); toast({ title: 'Song duplicated', desc: state.song.title }); } },
      { label: 'Export', icon: 'download', onSelect: async () => {
          try { await store.exportSong(state.song); }
          catch (e) { toast({ title: 'Export failed', desc: e.message, tone: 'destructive' }); }
        } },
      { sep: true },
      { label: 'Delete', icon: 'trash', destructive: true, onSelect: () => onDelete(state.song) },
    ]} />
  );
}

// More-menu for a playlist-owned song shown in the library. Mirrors the
// playlist detail row menu — these actions act on the playlist's copy, not a
// library song.
function PlaylistSongMoreMenu({ state, onClose, store, onOpen }) {
  const toast = useToast();
  if (!state) return null;
  const { song, playlist } = state;
  return (
    <Menu open={true} anchor={state.el} onClose={onClose} items={[
      { label: 'Open in playlist', icon: 'list', onSelect: () => onOpen(song, playlist.id) },
      { label: 'Edit song', icon: 'edit', onSelect: () => store.openEditor(song) },
      { label: 'Share', icon: 'share2', onSelect: () => store.openShareFor(song) },
      { label: 'Add to library', icon: 'plus', onSelect: async () => {
          try {
            await store.copySongToLibrary(song.id);
            toast({ title: 'Added to library', desc: song.title, icon: 'check' });
          } catch (e) {
            toast({ title: "Couldn't add to library", desc: e.message || String(e), tone: 'destructive' });
          }
        } },
      { sep: true },
      { label: 'Remove from playlist', icon: 'trash', destructive: true, onSelect: () => {
          store.removeFromPlaylist(song.id, playlist.id);
          toast({ title: 'Removed from playlist', desc: song.title, tone: 'destructive', icon: 'trash' });
        } },
    ]} />
  );
}

// ===========================================================================
// PLAYLISTS
// ===========================================================================
function PlaylistsScreen({ store, onOpen }) {
  const [creating, setCreating] = useStateS(false);
  const [newName, setNewName] = useStateS('');
  const [menuFor, setMenuFor] = useStateS(null);   // { anchor, pl }
  const [shareFor, setShareFor] = useStateS(null);
  const [renameFor, setRenameFor] = useStateS(null);
  const [deleteFor, setDeleteFor] = useStateS(null);
  const toast = useToast();
  const playlists = store.playlists;
  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 className="section-headline">Playlists</h2>
          <div className="section-sub">Group songs into sets. Each playlist keeps its own copies of its songs.</div>
        </div>
        <Btn variant="primary" onClick={() => setCreating(true)}><Icon name="plus" size={14} /> New playlist</Btn>
      </div>

      {playlists.length === 0 ? (
        <Empty icon="list" title="No playlists yet" desc="Create a set to group songs."
               action={<Btn variant="primary" onClick={() => setCreating(true)}><Icon name="plus" size={14} /> New playlist</Btn>} />
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Name</th><th style={{ width: 90 }}>Songs</th><th style={{ width: 44 }}></th></tr>
          </thead>
          <tbody>
            {playlists.map(p => (
              <tr key={p.id} className="row-clickable" onClick={() => onOpen(p)}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    {p.shared && <Badge variant="outline"><Icon name="users" size={10} /> Shared</Badge>}
                  </div>
                </td>
                <td className="t-muted">{p.entries.length}</td>
                <td style={{ textAlign: 'right' }}>
                  <IconBtn icon="more" label="More" onClick={(e) => { e.stopPropagation(); setMenuFor({ anchor: e.currentTarget, pl: p }); }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Menu open={!!menuFor} anchor={menuFor?.anchor} onClose={() => setMenuFor(null)} items={!menuFor ? [] : [
        { label: 'Share', icon: 'share2', onSelect: () => setShareFor(menuFor.pl) },
        { label: 'Rename', icon: 'edit', onSelect: () => setRenameFor(menuFor.pl) },
        { label: 'Export', icon: 'download', onSelect: async () => {
            try { await store.exportPlaylist(menuFor.pl); }
            catch (e) { toast({ title: 'Export failed', desc: e.message, tone: 'destructive' }); }
          } },
        { sep: true },
        (menuFor.pl.collaborators || []).length > 1
          ? { label: 'Leave playlist', icon: 'logout', destructive: true, onSelect: () => setDeleteFor(menuFor.pl) }
          : { label: 'Delete playlist', icon: 'trash', destructive: true, onSelect: () => setDeleteFor(menuFor.pl) },
      ]} />

      <SharePlaylistDialog open={!!shareFor} playlist={shareFor} store={store} onClose={() => setShareFor(null)} />
      <RenamePlaylistDialog open={!!renameFor} playlist={renameFor} store={store} onClose={() => setRenameFor(null)} />

      <Dialog open={!!deleteFor} onClose={() => setDeleteFor(null)}>
        {(() => {
          const leaving = !!deleteFor && (deleteFor.collaborators || []).length > 1;
          return <>
            <div className="dialog-title">{leaving ? `Leave “${deleteFor?.name}”?` : `Delete “${deleteFor?.name}”?`}</div>
            <div className="dialog-desc">
              {leaving
                ? 'You’ll be removed from this shared playlist. It stays available for the others.'
                : 'This removes the playlist and its songs. This can’t be undone.'}
            </div>
            <div className="dialog-footer">
              <Btn variant="outline" onClick={() => setDeleteFor(null)}>Cancel</Btn>
              <Btn variant="destructive" onClick={() => {
                const p = deleteFor;
                store.deletePlaylist(p.id);
                setDeleteFor(null);
                toast(leaving
                  ? { title: 'Left playlist', desc: p.name, icon: 'logout' }
                  : { title: 'Playlist deleted', desc: p.name, tone: 'destructive', icon: 'trash' });
              }}>
                <Icon name={leaving ? 'logout' : 'trash'} size={14} /> {leaving ? 'Leave' : 'Delete'}
              </Btn>
            </div>
          </>;
        })()}
      </Dialog>

      <Dialog open={creating} onClose={() => setCreating(false)}>
        <div className="dialog-title">New playlist</div>
        <div className="dialog-desc">Name your set. You can add songs once it's created.</div>
        <div style={{ marginTop: 16 }}>
          <label className="label">Name</label>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Friday at Cantine" />
        </div>
        <div className="dialog-footer">
          <Btn variant="outline" onClick={() => setCreating(false)}>Cancel</Btn>
          <Btn variant="primary" disabled={!newName.trim()}
               onClick={() => { store.createPlaylist(newName.trim()); setCreating(false); setNewName(''); }}>
            Create
          </Btn>
        </div>
      </Dialog>
    </div>
  );
}

// ---------- playlist detail ----------
function PlaylistDetail({ playlist, store, onOpenSong, onBack }) {
  const pl = playlist;
  // Each entry carries its own playlist-owned copy of the song.
  const entries = pl.entries
    .map(e => (e.song ? { song: e.song } : null))
    .filter(Boolean);
  const collabs = pl.collaborators.map(id => window.IT.USERS.find(u => u.id === id)).filter(Boolean);
  const owner = window.IT.USERS.find(u => u.id === pl.ownerId);
  const [rowMenu, setRowMenu] = useStateS(null); // { anchor, songId }
  const [shareLinkOpen, setShareLinkOpen] = useStateS(false);
  const isOwner = store.currentUser && pl.ownerId === store.currentUser.id;
  const toast = useToast();

  function move(songId, dir) {
    const ids = entries.map(e => e.song.id);
    const i = ids.indexOf(songId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    store.reorderPlaylist(pl.id, ids);
  }

  return (
    <div className="page">
      <div className="pl-detail-hero">
        <div className="pl-detail-info">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            {pl.shared && <Badge variant="primary"><Icon name="users" size={11} /> Shared playlist</Badge>}
            <Badge variant="outline">{entries.length} songs</Badge>
          </div>
          <div className="sub">Owned by {owner?.name}{pl.ownerId === 'u_me' ? ' (you)' : ''} · Updated {relTime(pl.updatedAt)}</div>
          {pl.shared && (
            <div className="pl-collab-row">
              <div className="collab-avatars">
                {collabs.map(u => <span key={u.id} className={`av ${u.color}`} title={u.name}>{u.initials}</span>)}
              </div>
              <span className="t-muted">{collabs.length} collaborators · edits sync to everyone</span>
            </div>
          )}
          {isOwner && (
            <div style={{ marginTop: 14 }}>
              <Btn variant="outline" size="sm" onClick={() => setShareLinkOpen(true)}>
                <Icon name="link" size={14} /> {pl.publicToken ? 'Share link · active' : 'Share link'}
              </Btn>
            </div>
          )}
        </div>
      </div>

      <ShareLinkDialog open={shareLinkOpen} playlist={pl} store={store} onClose={() => setShareLinkOpen(false)} />

      {entries.length === 0 ? (
        <Empty icon="music" title="Empty playlist"
               desc="Open a song from your library and choose Add to playlist."
        />
      ) : (
        <div className="song-list pl-song-list">
          {entries.map(({ song }, i) => (
            <div key={song.id} className="song-row pl-song-row" onClick={() => onOpenSong(song.id)}>
              <div className="pl-reorder">
                <IconBtn icon="arrowUp" label="Move up" disabled={i === 0}
                         onClick={(e) => { e.stopPropagation(); move(song.id, -1); }} />
                <IconBtn icon="arrowDown" label="Move down" disabled={i === entries.length - 1}
                         onClick={(e) => { e.stopPropagation(); move(song.id, 1); }} />
              </div>
              <span className="pl-index">{(i + 1).toString().padStart(2, '0')}</span>
              <div className="sr-content">
                <div className="sr-meta">
                  <div className="sr-title">{song.title}</div>
                  <div className="sr-artist">{song.artist}</div>
                </div>
                <div className="sr-key"><strong>{song.key}</strong>{song.capo > 0 ? ` · Capo ${song.capo}` : ''}</div>
              </div>
              <IconBtn icon="more" label="More" onClick={(e) => { e.stopPropagation(); setRowMenu({ anchor: e.currentTarget, songId: song.id, song }); }} />
            </div>
          ))}
        </div>
      )}

      <Menu open={!!rowMenu} anchor={rowMenu?.anchor} onClose={() => setRowMenu(null)} items={!rowMenu ? [] : [
        { label: 'Edit song', icon: 'edit', onSelect: () => store.openEditor(rowMenu.song) },
        { label: 'Share', icon: 'share2', onSelect: () => store.openShareFor(rowMenu.song) },
        { label: 'Add to playlist', icon: 'list', onSelect: () => store.openAddToPlaylist(rowMenu.song) },
        { label: 'Add to library', icon: 'plus', onSelect: async () => {
          try {
            await store.copySongToLibrary(rowMenu.songId);
            toast({ title: 'Added to library', desc: rowMenu.song.title, icon: 'check' });
          } catch (e) {
            toast({ title: "Couldn't add to library", desc: e.message || String(e), tone: 'destructive' });
          }
        } },
        { sep: true },
        { label: 'Remove from playlist', icon: 'trash', destructive: true, onSelect: () => {
          store.removeFromPlaylist(rowMenu.songId, pl.id);
          toast({ title: 'Removed from playlist', desc: rowMenu.song.title, tone: 'destructive', icon: 'trash' });
        } },
      ]} />
    </div>
  );
}

// Owner-only dialog to create / copy / disable a playlist's read-only public link.
function ShareLinkDialog({ open, playlist, store, onClose }) {
  const [busy, setBusy] = useStateS(false);
  const toast = useToast();
  if (!playlist) return null;
  const token = playlist.publicToken;
  const url = token ? `${window.location.origin}/?playlist=${token}` : '';

  async function enable() {
    setBusy(true);
    try { await store.createShareLink(playlist.id); }
    catch (e) { toast({ title: "Couldn't create link", desc: e.message || String(e), tone: 'destructive' }); }
    finally { setBusy(false); }
  }
  async function disable() {
    setBusy(true);
    try { await store.removeShareLink(playlist.id); toast({ title: 'Link disabled', desc: 'The old link no longer works.', icon: 'lock' }); }
    catch (e) { toast({ title: "Couldn't disable link", desc: e.message || String(e), tone: 'destructive' }); }
    finally { setBusy(false); }
  }
  function copy() {
    if (!url || !navigator.clipboard) return;
    navigator.clipboard.writeText(url).then(() => toast({ title: 'Link copied', icon: 'check' }), () => {});
  }

  return (
    <Dialog open={open} onClose={onClose} wide>
      <div className="dialog-title">Share “{playlist.name}”</div>
      <div className="dialog-desc">
        Anyone with this link can view the songs and use autoscroll — read-only. They can’t
        make any changes to the playlist or its songs, even if they’re signed in.
      </div>

      {token ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" readOnly value={url} onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
            <Btn variant="primary" onClick={copy}><Icon name="copy" size={14} /> Copy</Btn>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
            <span className="helper" style={{ margin: 0 }}>Link is active.</span>
            <Btn variant="outline" size="sm" disabled={busy} onClick={disable}>
              <Icon name="trash" size={14} /> Disable link
            </Btn>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          <Btn variant="primary" disabled={busy} onClick={enable}>
            <Icon name="link" size={14} /> {busy ? 'Creating…' : 'Create read-only link'}
          </Btn>
        </div>
      )}
    </Dialog>
  );
}

// ===========================================================================
// INBOX
// ===========================================================================
function InboxScreen({ store }) {
  const [pending, setPending] = useStateS(null);
  if (store.inbox.length === 0) {
    return (
      <div className="page">
        <h2 className="section-headline">Inbox</h2>
        <div className="section-sub">Songs and playlists shared with you will show up here.</div>
        <Empty icon="inbox" title="All caught up" desc="Nothing new since you last checked." />
      </div>
    );
  }
  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 className="section-headline">Inbox</h2>
          <div className="section-sub">Songs and playlists friends have sent you.</div>
        </div>
        <Btn variant="outline" size="sm" onClick={() => store.markAllRead()}><Icon name="check" size={14} /> Mark all read</Btn>
      </div>
      <div className="song-list" style={{ background: 'var(--background)' }}>
        {store.inbox.map(item => <InboxRow key={item.id} item={item} onAct={(action) => {
          if (item.kind === 'song') {
            if (action === 'add') {
              if (item.matchSongId) setPending(item);
              else { store.acceptSong(item); }
            } else if (action === 'open') {
              setPending(item);
            } else if (action === 'dismiss') store.dismissInbox(item.id);
          } else if (item.kind === 'playlist' || item.kind === 'playlist-invite') {
            if (action === 'add') store.acceptPlaylist(item);
            else if (action === 'dismiss') store.dismissInbox(item.id);
          }
        }} />)}
      </div>

      <ConflictDialog item={pending} onClose={() => setPending(null)} store={store} />
    </div>
  );
}

function InboxRow({ item, onAct }) {
  const from = window.IT.USERS.find(u => u.id === item.fromUserId);
  return (
    <div className={`inbox-row ${item.unread ? 'unread' : ''}`}>
      <span className={`ib-av ${from.color}`}>{from.initials}</span>
      <div style={{ minWidth: 0 }}>
        <div className="ib-title">
          {item.kind === 'song'
            ? <>{from.name} shared <span style={{ color: 'var(--primary)' }}>{item.songSnapshot.title}</span></>
            : item.kind === 'playlist-invite'
              ? <>{from.name} invited you to collaborate on <span style={{ color: 'var(--primary)' }}>{item.playlistName}</span></>
              : <>{from.name} shared playlist <span style={{ color: 'var(--primary)' }}>{item.playlistName}</span></>}
          {item.kind === 'song' && item.matchSongId && (
            <span style={{ marginLeft: 8 }}><Badge variant="outline"><Icon name="refresh" size={11} /> You have a copy</Badge></span>
          )}
        </div>
        <div className="ib-desc">
          {item.kind === 'song'
            ? <>{item.songSnapshot.artist} · {item.songSnapshot.key}</>
            : item.kind === 'playlist-invite'
              ? <>{item.songCount} songs · collaborate live</>
              : <>{item.songCount} songs · playlist copy</>}
          {item.note && <span style={{ marginLeft: 8, fontStyle: 'italic' }}>“{item.note}”</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span className="ib-time">{relTime(item.time)}</span>
        {item.kind === 'song' && item.matchSongId
          ? <Btn variant="primary" size="sm" onClick={() => onAct('open')}>Review</Btn>
          : <Btn variant="primary" size="sm" onClick={() => onAct('add')}>{item.kind === 'playlist-invite' ? 'Join' : item.kind === 'playlist' ? 'Add playlist' : 'Add to library'}</Btn>}
        <IconBtn icon="close" label="Dismiss" onClick={() => onAct('dismiss')} />
      </div>
    </div>
  );
}

function ConflictDialog({ item, onClose, store }) {
  if (!item || item.kind !== 'song') return null;
  const from = window.IT.USERS.find(u => u.id === item.fromUserId);
  const existing = store.songs.find(s => s.id === item.matchSongId);
  const toast = useToast();
  const incoming = item.songSnapshot;
  return (
    <Dialog open={true} onClose={onClose} wide>
      <div className="dialog-title">Replace your copy of “{incoming.title}”?</div>
      <div className="dialog-desc">{from.name} sent you an update. You already have a copy in your library.</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 18 }}>
        <div className="card" style={{ padding: 14 }}>
          <div className="t-small" style={{ color: 'var(--muted-foreground)', marginBottom: 6 }}>Your copy</div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{existing?.title || 'Original'}</div>
          <div className="t-muted" style={{ marginTop: 6 }}>Key {existing?.key} · Capo {existing?.capo || 0} · {relTime(existing?.updatedAt)}</div>
        </div>
        <div className="card" style={{ padding: 14, borderColor: 'var(--primary)' }}>
          <div className="t-small" style={{ color: 'var(--primary)', marginBottom: 6 }}>Incoming update</div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{incoming.title}</div>
          <div className="t-muted" style={{ marginTop: 6 }}>Key {incoming.key} · Capo {incoming.capo || 0} · From {from.name}</div>
        </div>
      </div>

      <div className="dialog-footer" style={{ justifyContent: 'space-between' }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <div style={{ display: 'flex', gap: 8 }}>
                    <Btn variant="primary" onClick={() => { store.replaceWithIncoming(item); onClose(); toast({ title: 'Replaced with incoming', desc: incoming.title }); }}>
            <Icon name="refresh" size={14} /> Replace
          </Btn>
        </div>
      </div>
    </Dialog>
  );
}

// ===========================================================================
// SETTINGS
// ===========================================================================
function SettingsScreen({ store, tweaks, setTweak }) {
  const me = store.currentUser;
  const meAv = window.IT.USERS.find(u => u.id === me.id) || me;
  const isBootstrapAdmin = me.handle === 'admin';
  const [editOpen, setEditOpen] = useStateS(false);
  const [pwOpen, setPwOpen] = useStateS(false);
  const toast = useToast();

  // Native (Tauri) only: the backend URL this app talks to. Changing it points
  // the app at a different server, so the current session must be dropped.
  const [serverEdit, setServerEdit] = useStateS(window.IT.getServer());
  function saveServer() {
    const v = window.IT.setServer(serverEdit);
    setServerEdit(v);
    toast({ title: 'Server updated', desc: 'Signing out…', icon: 'check' });
    setTimeout(() => store.logout(), 500);
  }

  async function handleExportAll() {
    try {
      const n = await store.exportLibrary();
      toast({ title: `Exported ${n} song${n === 1 ? '' : 's'}`, icon: 'download' });
    } catch (e) {
      toast({ title: 'Export failed', desc: e.message, tone: 'destructive' });
    }
  }

  async function handleImport() {
    try {
      const r = await store.importFromFile();
      if (!r) return;   // picker cancelled
      if (r.kind === 'playlist') {
        toast({ title: 'Playlist imported', desc: r.playlist.name, icon: 'check' });
      } else {
        toast({ title: `Imported ${r.count} song${r.count === 1 ? '' : 's'}`, icon: 'check' });
      }
    } catch (e) {
      toast({ title: 'Import failed', desc: e.message, tone: 'destructive' });
    }
  }

  // Device-only app-wide edge gaps. Same store as the song-view ⋮ overlay; both
  // open the shared SpacingPopup.
  const gaps = tweaks.gaps || { top: 0, bottom: 0 };
  const [spacingOpen, setSpacingOpen] = useStateS(false);

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h2 className="section-headline">Settings</h2>
      <div className="section-sub">Tune your chords experience.</div>

      <div className="settings-section">
        <h2>Account</h2>
        <div className="settings-row">
          <span className={`av ${meAv.color}`} style={{ width: 44, height: 44, borderRadius: 9999, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 600, flex: '0 0 44px' }}>{meAv.initials}</span>
          <div className="grow">
            <div className="row-title">{me.name}{me.isAdmin && <span style={{ marginLeft: 8 }}><Badge variant="outline"><Icon name="shield" size={10} /> Admin</Badge></span>}</div>
            <div className="row-desc">@{me.handle} · {me.email}</div>
          </div>
          <Btn variant="outline" size="sm" onClick={() => setEditOpen(true)}>Edit</Btn>
        </div>
        {isBootstrapAdmin ? (
          <div className="settings-row">
            <div className="grow">
              <div className="row-title">Passcode</div>
              <div className="row-desc">Managed in <span className="kbd">chords-data/secrets.json</span>. Edit that file to rotate it.</div>
            </div>
          </div>
        ) : (
          <div className="settings-row">
            <div className="grow">
              <div className="row-title">Password</div>
              <div className="row-desc">Change the password used to sign in.</div>
            </div>
            <Btn variant="outline" size="sm" onClick={() => setPwOpen(true)}><Icon name="lock" size={14} /> Change password</Btn>
          </div>
        )}
      </div>

      <EditAccountDialog open={editOpen} onClose={() => setEditOpen(false)} store={store} />
      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} store={store} />
      {me.isAdmin && <AdminSection store={store} />}

      {window.IT.isNative() && (
        <div className="settings-section">
          <h2>Connection</h2>
          <div className="settings-row">
            <div className="grow">
              <div className="row-title">Server</div>
              <div className="row-desc">The chords backend this app connects to. Changing it signs you out.</div>
              <input
                className="input"
                style={{ marginTop: 8, maxWidth: 360 }}
                value={serverEdit}
                onChange={e => setServerEdit(e.target.value)}
                placeholder="https://your-chords-server"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <Btn variant="outline" size="sm" onClick={saveServer}>Save</Btn>
          </div>
        </div>
      )}

      <div className="settings-section">
        <h2>Appearance</h2>
        <div className="settings-row">
          <div className="grow">
            <div className="row-title">Theme mode</div>
            <div className="row-desc">Stage-friendly dark mode by default.</div>
          </div>
          <div className="tabs-list">
            <button className={`tab-trigger ${tweaks.mode === 'light' ? 'active' : ''}`} onClick={() => setTweak('mode', 'light')}>Light</button>
            <button className={`tab-trigger ${tweaks.mode === 'dark' ? 'active' : ''}`} onClick={() => setTweak('mode', 'dark')}>Dark</button>
          </div>
        </div>
        <div className="settings-row">
          <div className="grow">
            <div className="row-title">Chord color</div>
            <div className="row-desc">Chords over lyrics in the brand orange, or neutral grey for better visibility.</div>
          </div>
          <div className="tabs-list">
            <button className={`tab-trigger ${(tweaks.chordColor || 'orange') === 'orange' ? 'active' : ''}`} onClick={() => setTweak('chordColor', 'orange')}>Orange</button>
            <button className={`tab-trigger ${tweaks.chordColor === 'grey' ? 'active' : ''}`} onClick={() => setTweak('chordColor', 'grey')}>Grey</button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h2>Performance</h2>
        <div className="settings-row">
          <div className="grow">
            <div className="row-title">Keep screen awake on song view</div>
            <div className="row-desc">Prevents your device from sleeping mid-song.</div>
          </div>
          <Switch on={tweaks.keepAwake} onChange={(v) => setTweak('keepAwake', v)} />
        </div>
        <div className="settings-row">
          <div className="grow">
            <div className="row-title">Playback bar at top</div>
            <div className="row-desc">Show the autoscroll controls at the top of the song view instead of the bottom.</div>
          </div>
          <Switch on={tweaks.barAtTop} onChange={(v) => setTweak('barAtTop', v)} />
        </div>
        <div className="settings-row">
          <div className="grow">
            <div className="row-title">Metronome count-in</div>
            <div className="row-desc">Flash the playback bar at the song's tempo (BPM) before autoscroll starts.</div>
          </div>
          <Switch on={tweaks.metronome} onChange={(v) => setTweak('metronome', v)} />
        </div>
        {tweaks.metronome && (
          <div className="settings-row">
            <div className="grow">
              <div className="row-title">Count-in beats</div>
              <div className="row-desc">How many beats to flash before scrolling begins.</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Btn variant="outline" size="sm" disabled={(tweaks.metronomeBeats || 4) <= 1}
                   onClick={() => setTweak('metronomeBeats', Math.max(1, (tweaks.metronomeBeats || 4) - 1))}>
                <Icon name="minus" size={14} />
              </Btn>
              <span style={{ minWidth: 20, textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 15 }}>
                {tweaks.metronomeBeats || 4}
              </span>
              <Btn variant="outline" size="sm" disabled={(tweaks.metronomeBeats || 4) >= 16}
                   onClick={() => setTweak('metronomeBeats', Math.min(16, (tweaks.metronomeBeats || 4) + 1))}>
                <Icon name="plus" size={14} />
              </Btn>
            </div>
          </div>
        )}
      </div>

      <div className="settings-section">
        <h2>Display</h2>
        <div className="settings-row">
          <div className="grow">
            <div className="row-title">Edge spacing</div>
            <div className="row-desc">Add empty space at the top and bottom of every screen — handy to clear device edges, notches, or system bars. Saved on this device only; also tunable live from the ⋮ menu while viewing a song.</div>
          </div>
          <Btn variant="outline" size="sm" onClick={() => setSpacingOpen(true)}>
            <Icon name="spacing" size={14} /> {(gaps.top || 0)}/{(gaps.bottom || 0)} · Adjust
          </Btn>
        </div>
      </div>

      <SpacingPopup open={spacingOpen} onClose={() => setSpacingOpen(false)}
                    gaps={gaps} setGaps={(g) => setTweak('gaps', g)} />

      <div className="settings-section">
        <h2>Import &amp; export</h2>
        <div className="settings-row">
          <div className="grow">
            <div className="row-title">Export library</div>
            <div className="row-desc">Download all your library songs as a JSON file.</div>
          </div>
          <Btn variant="outline" size="sm" onClick={handleExportAll}>
            <Icon name="download" size={14} /> Export
          </Btn>
        </div>
        <div className="settings-row">
          <div className="grow">
            <div className="row-title">Import from file</div>
            <div className="row-desc">Load songs or a playlist from a chords JSON export.</div>
          </div>
          <Btn variant="outline" size="sm" onClick={handleImport}>
            <Icon name="upload" size={14} /> Import
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// EDITOR
// ===========================================================================
function EditorScreen({ song, store, onCancel, onSaved }) {
  // The editor is for writing/editing a song by hand. Web/text/image imports
  // live in their own top-level "Import" section.
  const [draft, setDraft] = useStateS(song ? {
    title: song.title, artist: song.artist,
    key: song.key, capo: song.capo, tempo: song.tempo,
    tags: song.tags.join(', '), body: song.body,
  } : {
    title: '', artist: '', key: 'C', capo: 0, tempo: 90, tags: '', body: '',
  });

  const toast = useToast();
  const isPlaylistVersion = !!(song && song.playlistId);
  const playlist = isPlaylistVersion ? store.playlists.find(p => p.id === song.playlistId) : null;
  const collabs = playlist ? playlist.collaborators.map(id => window.IT.USERS.find(u => u.id === id)).filter(Boolean) : [];

  function save() {
    const tags = draft.tags.split(',').map(t => t.trim()).filter(Boolean);
    if (song) {
      store.saveEdit(song.id, { ...draft, tags });
      if (isPlaylistVersion && playlist) {
        toast({ title: 'Updated for everyone', desc: `${draft.title} · ${collabs.length} ${collabs.length === 1 ? 'collaborator' : 'collaborators'}`, icon: 'users' });
      } else {
        toast({ title: 'Saved', desc: draft.title });
      }
    } else {
      store.createSong({ ...draft, tags });
      toast({ title: 'Added to library', desc: draft.title });
    }
    onSaved && onSaved();
  }

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 className="section-headline">{song ? `Editing — ${song.title}` : 'Add song'}</h2>
          <div className="section-sub">
            {song ? 'Edit song details and lyrics.' : 'Write the chords and lyrics for your new song.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
          <Btn variant="primary" onClick={save}><Icon name="check" size={14} /> {song ? 'Save changes' : 'Add to library'}</Btn>
        </div>
      </div>

      {/* Playlist-context warning for shared edits */}
      {isPlaylistVersion && playlist && (
        <div className="card" style={{
          marginBottom: 18, padding: 14,
          background: 'color-mix(in oklab, var(--primary) 10%, var(--card))',
          borderColor: 'var(--primary)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <Icon name="users" size={18} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>This copy belongs to “{playlist.name}”</div>
            <div className="t-muted" style={{ marginTop: 2 }}>
              {playlist.shared
                ? `Saving updates this copy for ${collabs.length} ${collabs.length === 1 ? 'collaborator' : 'collaborators'}.`
                : 'Saving updates this copy in the playlist.'}
            </div>
          </div>
          {playlist.shared && (
            <div className="collab-avatars">
              {collabs.slice(0, 4).map(u => <span key={u.id} className={`av ${u.color}`} title={u.name}>{u.initials}</span>)}
            </div>
          )}
        </div>
      )}

      <div className="editor-grid">
          <div className="editor-pane">
            <div className="field-row">
              <div>
                <label className="label">Title</label>
                <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Song title" />
              </div>
              <div>
                <label className="label">Artist</label>
                <Input value={draft.artist} onChange={(e) => setDraft({ ...draft, artist: e.target.value })} placeholder="Artist" />
              </div>
            </div>
            <div className="field-row">
              <div>
                <label className="label">Key</label>
                <Input value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} placeholder="C, Am, F#..." />
              </div>
              <div>
                <label className="label">Capo</label>
                <Input type="number" min="0" max="11" value={draft.capo} onChange={(e) => setDraft({ ...draft, capo: +e.target.value })} />
              </div>
            </div>
            <div className="field-row">
              <div>
                <label className="label">Tempo (bpm)</label>
                <Input type="number" min="40" max="240" value={draft.tempo} onChange={(e) => setDraft({ ...draft, tempo: +e.target.value })} />
              </div>
              <div></div>
            </div>
            <div>
              <label className="label">Tags <span style={{ color: 'var(--muted-foreground)', fontWeight: 400 }}>(comma separated)</span></label>
              <Input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} placeholder="Acoustic, Setlist, Wedding" />
            </div>
            <div>
              <label className="label">Body</label>
              <textarea className="textarea" rows="18" value={draft.body}
                        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                        placeholder="{Verse}&#10;[C]Wrap chords in [Am]brackets [F]before the [G]syllable" />
              <div className="helper">Use <span className="kbd">[Chord]</span> brackets before syllables · <span className="kbd">&#123;Section&#125;</span> tags mark verse / chorus / bridge.</div>
            </div>
            
          </div>
          <div className="editor-pane">
            <h3>Live preview</h3>
            <div className="preview-area">
              <SongBody body={draft.body || '{Verse}\n[C]Type below to see your song...'} lyricSize={15} />
            </div>
          </div>
        </div>
    </div>
  );
}

// ===========================================================================
// SHARE / ADD-TO-PLAYLIST
// ===========================================================================
function ShareSongDialog({ open, song, store, onClose }) {
  const [selected, setSelected] = useStateS(new Set());
  const toast = useToast();
  if (!song) return null;
  const friends = window.IT.USERS.filter(u => !u.me);
  function toggle(id) {
    const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); setSelected(s);
  }
  function send() {
    store.shareSong(song, Array.from(selected));
    toast({ title: 'Song shared', desc: `${song.title} → ${selected.size} ${selected.size === 1 ? 'friend' : 'friends'}` });
    setSelected(new Set());
    onClose();
  }
  return (
    <Dialog open={open} onClose={onClose} wide>
      <div className="dialog-title">Share “{song.title}”</div>
      <div className="dialog-desc">Sends a copy of the main version. Recipients can edit their copy independently.</div>
      <div style={{ marginTop: 14 }}>
        <label className="label">To</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {friends.map(u => (
            <button key={u.id} className={`tag-chip ${selected.has(u.id) ? 'on' : ''}`}
                    onClick={() => toggle(u.id)}>
              <span className={`av ${u.color}`} style={{ width: 18, height: 18, fontSize: 9, borderRadius: 9999, display: 'inline-grid', placeItems: 'center', color: '#fff', fontWeight: 600 }}>{u.initials}</span>
              {u.name}
            </button>
          ))}
        </div>
      </div>
      <div className="dialog-footer">
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={selected.size === 0} onClick={send}>
          <Icon name="send" size={14} /> Send to {selected.size || 0}
        </Btn>
      </div>
    </Dialog>
  );
}

function SharePlaylistDialog({ open, playlist, store, onClose }) {
  const [mode, setMode] = useStateS('copy'); // 'copy' | 'shared'
  const [selected, setSelected] = useStateS(new Set());
  const toast = useToast();
  useEffectS(() => {
    if (open) {
      setMode('copy');
      setSelected(new Set());
    }
  }, [open]);
  // Reset the recipient selection whenever the share mode changes.
  useEffectS(() => { setSelected(new Set()); }, [mode]);
  if (!playlist) return null;
  const friends = window.IT.USERS.filter(u => !u.me);
  function toggle(id) {
    const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); setSelected(s);
  }
  function submit() {
    if (mode === 'copy') {
      store.sharePlaylist(playlist, Array.from(selected));
      toast({ title: 'Playlist shared', desc: `${playlist.name} → ${selected.size} ${selected.size === 1 ? 'friend' : 'friends'}` });
    } else {
      store.sharePlaylistShared(playlist, Array.from(selected));
      toast({ title: 'Invites sent', desc: `${playlist.name} → ${selected.size} ${selected.size === 1 ? 'person' : 'people'}` });
    }
    setSelected(new Set());
    onClose();
  }
  const modes = [
    { id: 'copy', label: 'Send a copy', desc: 'Lands in their inbox to accept; they get an independent copy.' },
    { id: 'shared', label: 'Shared', desc: 'Sends an invite; accepting joins the same playlist to edit live.' },
  ];
  return (
    <Dialog open={open} onClose={onClose} wide>
      <div className="dialog-title">Share “{playlist.name}”</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
        {modes.map(m => (
          <button key={m.id} type="button" onClick={() => setMode(m.id)}
            style={{
              textAlign: 'left', cursor: 'pointer',
              border: '1px solid', borderColor: mode === m.id ? 'var(--primary)' : 'var(--border)',
              background: mode === m.id ? 'color-mix(in oklab, var(--primary) 10%, var(--card))' : 'var(--card)',
              color: 'var(--foreground)', borderRadius: 'var(--radius)', padding: 12,
            }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{m.label}</div>
            <div className="t-muted" style={{ marginTop: 2, fontSize: 11 }}>{m.desc}</div>
          </button>
        ))}
      </div>

      <div style={{ marginTop: 14 }}>
        <label className="label">{mode === 'copy' ? 'To' : 'Invite'}</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {friends.map(u => (
            <button key={u.id} className={`tag-chip ${selected.has(u.id) ? 'on' : ''}`}
                    onClick={() => toggle(u.id)}>
              <span className={`av ${u.color}`} style={{ width: 18, height: 18, fontSize: 9, borderRadius: 9999, display: 'inline-grid', placeItems: 'center', color: '#fff', fontWeight: 600 }}>{u.initials}</span>
              {u.name}
            </button>
          ))}
        </div>
      </div>

      <div className="dialog-footer">
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        {mode === 'copy' ? (
          <Btn variant="primary" disabled={selected.size === 0} onClick={submit}>
            <Icon name="send" size={14} /> Send to {selected.size || 0}
          </Btn>
        ) : (
          <Btn variant="primary" disabled={selected.size === 0} onClick={submit}>
            <Icon name="users" size={14} /> Invite {selected.size || 0}
          </Btn>
        )}
      </div>
    </Dialog>
  );
}

function AddToPlaylistDialog({ open, song, store, onClose }) {
  const [playlistId, setPlaylistId] = useStateS(null);
  const [busy, setBusy] = useStateS(false);
  const toast = useToast();

  useEffectS(() => {
    if (open) { setPlaylistId(null); setBusy(false); }
  }, [open]);

  if (!song) return null;
  const playlists = store.playlists;

  async function add() {
    if (!playlistId || busy) return;
    const pl = playlists.find(p => p.id === playlistId);
    setBusy(true);
    try {
      await store.addToPlaylist(song.id, playlistId);
      toast({
        title: 'Added to playlist',
        desc: `${song.title} → ${pl.name}`,
        icon: 'list',
      });
      onClose();
    } catch (e) {
      toast({ title: "Couldn't add to playlist", desc: e.message || String(e), tone: 'destructive' });
      setBusy(false);
    }
  }

  const selectedPl = playlists.find(p => p.id === playlistId);

  return (
    <Dialog open={open} onClose={onClose} wide>
      <div className="dialog-title">Add “{song.title}” to a playlist</div>
      <div className="dialog-desc">
        The playlist gets its own independent copy of the song — editing it there won’t change your library version.
      </div>

      <div style={{ marginTop: 16 }}>
        <label className="label">Playlist</label>
        {playlists.length === 0 ? (
          <div className="t-muted" style={{ padding: 12, border: '1px dashed var(--border)', borderRadius: 'var(--radius)' }}>
            You don’t have any playlists yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto',
                        border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 4 }}>
            {playlists.map(p => (
              <button key={p.id}
                      className="menu-item"
                      style={{
                        background: playlistId === p.id ? 'var(--accent)' : 'transparent',
                        border: 0, textAlign: 'left', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 10,
                      }}
                      onClick={() => setPlaylistId(p.id)}>
                <span style={{ flex: 1, fontSize: 13 }}>{p.name}</span>
                {p.shared && <Badge variant="outline" className=""><Icon name="users" size={10} /></Badge>}
                <span className="t-muted" style={{ fontSize: 11 }}>{p.entries.length}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedPl && selectedPl.shared && (
        <div className="helper" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="users" size={12} /> This is a shared playlist. Edits to the copy will sync to {selectedPl.collaborators.length} collaborators.
        </div>
      )}

      <div className="dialog-footer">
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={!playlistId || busy} onClick={add}>
          <Icon name="plus" size={14} /> {busy ? 'Adding…' : 'Add to playlist'}
        </Btn>
      </div>
    </Dialog>
  );
}

// ===========================================================================
// EDIT ACCOUNT / CHANGE PASSWORD / ADMIN USERS
// ===========================================================================

const AVATAR_COLORS = ['av-1', 'av-2', 'av-3', 'av-4', 'av-5', 'av-6', 'av-7', 'av-8'];

function deriveInitials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function ColorPicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {AVATAR_COLORS.map(c => (
        <button key={c} type="button" onClick={() => onChange(c)}
          className={`av ${c}`}
          style={{
            width: 32, height: 32, borderRadius: 9999,
            border: value === c ? '2px solid var(--foreground)' : '2px solid transparent',
            cursor: 'pointer', display: 'grid', placeItems: 'center',
            color: '#fff', fontWeight: 600, fontSize: 11,
          }}
          aria-label={c}>
          {value === c && <Icon name="check" size={14} />}
        </button>
      ))}
    </div>
  );
}

function EditAccountDialog({ open, onClose, store }) {
  const me = store.currentUser;
  const isBootstrapAdmin = me.handle === 'admin';
  const [form, setForm] = useStateS({
    name: me.name, handle: me.handle, email: me.email,
    color: me.color, initials: me.initials,
  });
  const [busy, setBusy] = useStateS(false);
  const [error, setError] = useStateS('');
  const toast = useToast();

  useEffectS(() => {
    if (open) {
      setForm({ name: me.name, handle: me.handle, email: me.email, color: me.color, initials: me.initials });
      setError('');
    }
  }, [open, me]);

  async function save() {
    setBusy(true); setError('');
    try {
      await store.updateMe(form);
      toast({ title: 'Profile updated', desc: form.name });
      onClose();
    } catch (e) {
      setError(e.message || 'Could not update profile');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <div className="dialog-title">Edit profile</div>
      <div className="dialog-desc">Your name, handle, and avatar.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
        <div>
          <label className="label">Name</label>
          <Input value={form.name} onChange={(e) => {
            const name = e.target.value;
            setForm(f => ({ ...f, name, initials: f.initials === deriveInitials(f.name) ? deriveInitials(name) : f.initials }));
          }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label className="label">Handle</label>
            <Input value={form.handle}
              onChange={(e) => setForm(f => ({ ...f, handle: e.target.value.replace(/^@/, '') }))}
              placeholder="handle"
              disabled={isBootstrapAdmin} />
            {isBootstrapAdmin && <div className="helper">The admin handle is fixed.</div>}
          </div>
          <div>
            <label className="label">Email</label>
            <Input value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 10 }}>
          <div>
            <label className="label">Avatar color</label>
            <ColorPicker value={form.color} onChange={(c) => setForm(f => ({ ...f, color: c }))} />
          </div>
          <div>
            <label className="label">Initials</label>
            <Input value={form.initials} maxLength={3} onChange={(e) => setForm(f => ({ ...f, initials: e.target.value.toUpperCase() }))} />
          </div>
        </div>
      </div>
      {error && <div style={{ color: 'var(--destructive)', fontSize: 13, marginTop: 10 }}>{error}</div>}
      <div className="dialog-footer">
        <Btn variant="outline" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn variant="primary" onClick={save} disabled={busy || !form.name.trim() || !form.handle.trim() || !form.email.trim()}>
          {busy ? 'Saving…' : 'Save changes'}
        </Btn>
      </div>
    </Dialog>
  );
}

function ChangePasswordDialog({ open, onClose, store }) {
  const [currentPassword, setCurrentPassword] = useStateS('');
  const [newPassword, setNewPassword] = useStateS('');
  const [confirm, setConfirm] = useStateS('');
  const [busy, setBusy] = useStateS(false);
  const [error, setError] = useStateS('');
  const toast = useToast();

  useEffectS(() => {
    if (open) { setCurrentPassword(''); setNewPassword(''); setConfirm(''); setError(''); }
  }, [open]);

  async function submit() {
    if (newPassword !== confirm) { setError('New passwords do not match'); return; }
    if (newPassword.length < 6) { setError('New password must be at least 6 characters'); return; }
    setBusy(true); setError('');
    try {
      await store.changePassword(currentPassword, newPassword);
      toast({ title: 'Password changed' });
      onClose();
    } catch (e) {
      setError(e.message || 'Could not change password');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <div className="dialog-title">Change password</div>
      <div className="dialog-desc">Enter your current password, then choose a new one.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
        <div>
          <label className="label">Current password</label>
          <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <div>
          <label className="label">New password</label>
          <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <div>
          <label className="label">Confirm new password</label>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </div>
      </div>
      {error && <div style={{ color: 'var(--destructive)', fontSize: 13, marginTop: 10 }}>{error}</div>}
      <div className="dialog-footer">
        <Btn variant="outline" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn variant="primary" onClick={submit} disabled={busy || !currentPassword || !newPassword || !confirm}>
          {busy ? 'Saving…' : 'Change password'}
        </Btn>
      </div>
    </Dialog>
  );
}

function AdminSection({ store }) {
  const [createOpen, setCreateOpen] = useStateS(false);
  const [invites, setInvites] = useStateS([]);
  const toast = useToast();

  const allUsers = window.IT.USERS.slice().sort((a, b) => a.name.localeCompare(b.name));

  const loadInvites = useCallbackS(async () => {
    try {
      const data = await window.IT.api('/invites');
      setInvites(data.filter(i => i.status !== 'used'));
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffectS(() => {
    loadInvites();
  }, [loadInvites]);

  async function revokeInvite(id) {
    if (!confirm('Are you sure you want to revoke/delete this invite?')) return;
    try {
      await window.IT.api(`/invites/${id}`, { method: 'DELETE' });
      toast({ title: 'Invite revoked' });
      loadInvites();
    } catch (e) {
      toast({ title: 'Error', desc: e.message, icon: 'alertTriangle' });
    }
  }

  function copyLink(url) {
    navigator.clipboard.writeText(url);
    toast({ title: 'Link copied', icon: 'check' });
  }

  return (
    <>
      <div className="settings-section">
        <h2><Icon name="shield" size={14} /> Admin · Users</h2>
        <div className="section-sub" style={{ marginBottom: 12 }}>
          List of all registered users. New users must register via an invite link.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {allUsers.map(u => (
            <div key={u.id} className="settings-row" style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)' }}>
              <span className={`av ${u.color}`} style={{ width: 32, height: 32, borderRadius: 9999, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 600, flex: '0 0 32px', fontSize: 12 }}>{u.initials}</span>
              <div className="grow">
                <div className="row-title" style={{ fontSize: 14 }}>{u.name}{u.me && <span style={{ marginLeft: 6, color: 'var(--muted-foreground)', fontSize: 12 }}>(you)</span>}</div>
                <div className="row-desc">{u.handle}</div>
              </div>
              {u.isAdmin && <Badge variant="outline"><Icon name="shield" size={10} /> Admin</Badge>}
            </div>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <h2><Icon name="link" size={14} /> Admin · Invites</h2>
        <div className="section-sub" style={{ marginBottom: 12 }}>
          Manage invite links. Create links to allow new people to join.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
          {invites.map(i => (
            <div key={i.id} className="settings-row" style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)' }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row-title" style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="t-truncate">{i.email || 'Open invite'}</span>
                  <Badge variant="outline">{i.status}</Badge>
                </div>
                {i.status === 'active' && <div className="row-desc t-truncate" style={{ fontFamily: 'var(--font-mono)' }}>{i.url}</div>}
                {i.status === 'used' && <div className="row-desc" style={{ marginTop: 2 }}>Used by @{i.used_by_handle}</div>}
                {i.status === 'active' && i.expires_at && <div className="row-desc" style={{ marginTop: 2 }}>Expires {new Date(i.expires_at).toLocaleDateString()}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {i.status === 'active' && (
                  <Btn variant="outline" size="sm" onClick={() => copyLink(i.url)}>
                    <Icon name="copy" size={14} /> Copy
                  </Btn>
                )}
                <Btn variant="ghost" size="sm" style={{ color: 'var(--destructive)' }} onClick={() => revokeInvite(i.id)}>
                  <Icon name="trash" size={14} />
                </Btn>
              </div>
            </div>
          ))}
          {invites.length === 0 && (
            <div className="t-muted" style={{ padding: '12px', fontSize: 13, textAlign: 'center', background: 'var(--card)', borderRadius: 8 }}>
              No invites generated yet.
            </div>
          )}
        </div>
        <Btn variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
          <Icon name="plus" size={14} /> New invite link
        </Btn>
        <CreateInviteDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={loadInvites} />
      </div>
    </>
  );
}

function CreateInviteDialog({ open, onClose, onCreated }) {
  const [email, setEmail] = useStateS('');
  const [expiresIn, setExpiresIn] = useStateS(7);
  const [busy, setBusy] = useStateS(false);
  const [error, setError] = useStateS('');
  const [createdUrl, setCreatedUrl] = useStateS('');
  const toast = useToast();

  useEffectS(() => {
    if (open) {
      setEmail('');
      setExpiresIn(7);
      setError('');
      setCreatedUrl('');
    }
  }, [open]);

  async function submit() {
    setBusy(true); setError('');
    try {
      const payload = {
        email: email.trim() || null,
        expires_in_days: expiresIn === 0 ? null : expiresIn
      };
      const data = await window.IT.api('/invites', { method: 'POST', body: payload });
      setCreatedUrl(data.url);
      onCreated();
    } catch (e) {
      setError(e.message || 'Could not create invite');
    } finally { setBusy(false); }
  }

  function copyLink() {
    navigator.clipboard.writeText(createdUrl);
    toast({ title: 'Link copied', icon: 'check' });
    onClose();
  }

  if (createdUrl) {
    return (
      <Dialog open={open} onClose={onClose}>
        <div className="dialog-title">Invite link created</div>
        <div className="dialog-desc">Share this link with the new user.</div>
        <div style={{ marginTop: 16, padding: 12, background: 'var(--background)', borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 13, wordBreak: 'break-all' }}>
          {createdUrl}
        </div>
        <div className="dialog-footer" style={{ marginTop: 24 }}>
          <Btn variant="outline" onClick={onClose}>Close</Btn>
          <Btn variant="primary" onClick={copyLink}><Icon name="copy" size={14} /> Copy link</Btn>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <div className="dialog-title">Generate invite link</div>
      <div className="dialog-desc">Create a secure link for a new user to sign up.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
        <div>
          <label className="label">Email (optional)</label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="If set, only this email can be used" />
        </div>
        <div>
          <label className="label">Expires in</label>
          <select className="input" value={expiresIn} onChange={e => setExpiresIn(Number(e.target.value))}>
            <option value={1}>1 day</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={0}>Never</option>
          </select>
        </div>
      </div>
      {error && <div style={{ color: 'var(--destructive)', fontSize: 13, marginTop: 10 }}>{error}</div>}
      <div className="dialog-footer">
        <Btn variant="outline" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn variant="primary" onClick={submit} disabled={busy}>
          {busy ? 'Generating…' : 'Generate link'}
        </Btn>
      </div>
    </Dialog>
  );
}

// ===========================================================================
// RENAME PLAYLIST
// ===========================================================================

function RenamePlaylistDialog({ open, playlist, store, onClose }) {
  const [name, setName] = useStateS(playlist?.name || '');
  const [busy, setBusy] = useStateS(false);
  const toast = useToast();

  useEffectS(() => { if (open && playlist) setName(playlist.name); }, [open, playlist]);

  async function save() {
    setBusy(true);
    try {
      await store.updatePlaylist(playlist.id, { name: name.trim() });
      toast({ title: 'Playlist renamed', desc: name });
      onClose();
    } catch (e) {
      toast({ title: 'Could not rename', desc: e.message, tone: 'destructive' });
    } finally { setBusy(false); }
  }

  if (!playlist) return null;
  return (
    <Dialog open={open} onClose={onClose}>
      <div className="dialog-title">Rename playlist</div>
      <div className="dialog-desc">This won't affect any of the songs or their versions.</div>
      <div style={{ marginTop: 14 }}>
        <label className="label">Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div className="dialog-footer">
        <Btn variant="outline" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn variant="primary" onClick={save} disabled={busy || !name.trim() || name.trim() === playlist.name}>
          {busy ? 'Saving…' : 'Rename'}
        </Btn>
      </div>
    </Dialog>
  );
}

// ===========================================================================
// IMPORT PANEL — search the web or paste a URL, agent extracts chords + lyrics
// ===========================================================================

function looksLikeUrl(v) {
  if (/\s/.test(v.trim())) return false; // queries have spaces; URLs don't
  return /^https?:\/\/\S+$/i.test(v) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(v);
}

function normalizeUrl(v) {
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

// ===========================================================================
// IMPORT  (top-level section: Web / Text or image — no manual entry)
// ===========================================================================
function ImportScreen({ store, onDone }) {
  const [mode, setMode] = useStateS('web'); // 'web' | 'textimage'

  function applyExtracted(extracted) {
    store.createSong({
      title: extracted.title || '',
      artist: extracted.artist || '',
      key: extracted.key || 'C',
      capo: extracted.capo || 0,
      tempo: extracted.tempo || 90,
      tags: [],
      body: extracted.body || '',
    });
    onDone && onDone();
  }

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 18 }}>
        <h2 className="section-headline">Import</h2>
        <div className="section-sub">
          {mode === 'web'
            ? 'Paste a link to a song or playlist, or describe what you’re looking for.'
            : 'Paste raw chord text or upload an image, then convert it into a song.'}
        </div>
      </div>

      {/* Some sites block the server-side scraper. The browser extension does the
          fetch in the user's own browser (their IP/session), getting past bot
          checks the server can't. Point people at the GitHub release downloads. */}
      <div style={{
        marginBottom: 18, padding: '10px 12px', display: 'flex', gap: 10,
        alignItems: 'center', flexWrap: 'wrap',
        border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
        color: 'var(--muted-foreground)',
      }}>
        <Icon name="download" size={16} />
        <span style={{ fontSize: 13, flex: 1, minWidth: 220 }}>
          A site blocking the importer? The{' '}
          <strong style={{ color: 'var(--foreground)' }}>Chords Importer</strong>{' '}
          browser extension scrapes pages from your own browser to get past that.
        </span>
        <a className="btn btn-outline btn-sm" style={{ textDecoration: 'none' }}
           href="https://github.com/vaelum/chords/releases/latest"
           target="_blank" rel="noopener noreferrer">
          <Icon name="external" size={14} /> Get it for Chrome &amp; Firefox
        </a>
      </div>

      <div className="seg-switch">
        {[
          { key: 'web', label: 'Web', icon: 'globe' },
          { key: 'textimage', label: 'Text or image', icon: 'type' },
        ].map(o => (
          <button key={o.key} type="button"
                  className={`seg-item${mode === o.key ? ' on' : ''}`}
                  onClick={() => setMode(o.key)}>
            <Icon name={o.icon} size={14} /> {o.label}
          </button>
        ))}
      </div>

      <ImportPanel
        mode={mode}
        store={store}
        onExtracted={applyExtracted}
        onPlaylistImported={onDone}
      />
    </div>
  );
}

// Comparison key for duplicate detection when importing into an existing
// playlist: title + artist, case-insensitive and whitespace-normalized.
function songKey(title, artist) {
  const n = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${n(title)} ${n(artist)}`;
}

function ImportPanel({ onExtracted, store, onPlaylistImported, mode = 'web' }) {
  const [value, setValue] = useStateS('');
  const [busy, setBusy] = useStateS(false);
  const [working, setWorking] = useStateS(''); // label for the progress dialog
  const [error, setError] = useStateS('');
  const [errorPage, setErrorPage] = useStateS(null); // { url, title, text, html, loaded }
  const [candidates, setCandidates] = useStateS(null);
  const [playlist, setPlaylist] = useStateS(null); // { url, songs: [{title, artist, url}] }
  const [playlistName, setPlaylistName] = useStateS('');
  const [selected, setSelected] = useStateS(() => new Set()); // indices of songs to import
  const [target, setTarget] = useStateS('both'); // 'library' | 'playlist' | 'existing' | 'both'
  const [existingPlaylistId, setExistingPlaylistId] = useStateS(null); // destination when target === 'existing'
  const [dupMode, setDupMode] = useStateS('skip'); // 'skip' | 'copy' — handling for title+artist dups already in the destination
  const [pastedText, setPastedText] = useStateS('');
  const [image, setImage] = useStateS(null);       // { dataUrl, base64, mediaType, name }
  const [viewPage, setViewPage] = useStateS(null);  // loaded page shown full-screen
  const [importingUrl, setImportingUrl] = useStateS(null);
  const [progress, setProgress] = useStateS([]);
  const abortRef = useRefS(null);
  const toast = useToast();

  // Clear any prior error when switching modes (web ↔ text/image).
  useEffectS(() => { setError(''); setErrorPage(null); }, [mode]);

  function cancelWork() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setImportingUrl(null);
    setWorking('');
    setProgress([]);
  }

  async function runStreaming(path, body, onResult, { keepProgress = false } = {}) {
    setError(''); setErrorPage(null);
    if (!keepProgress) setProgress([]);
    const controller = new AbortController();
    abortRef.current = controller;
    let resolvedResult = null;
    let errorMsg = null;
    let errorPg = null;
    try {
      await window.IT.apiStream(path, body, (evt) => {
        // Each event carries `t` (seconds since the request started); prefixing
        // it makes a slow phase obvious — a big jump between two lines is the
        // step that stalled.
        const at = evt.t != null ? `[${evt.t.toFixed(1)}s] ` : '';
        if (evt.type === 'progress') {
          setProgress(p => [...p, at + evt.message]);
        } else if (evt.type === 'result') {
          resolvedResult = evt.data;
          setProgress(p => [...p, `${at}Done.`]);
        } else if (evt.type === 'error') {
          errorMsg = evt.message;
          if (evt.page) errorPg = evt.page;
        }
      }, controller.signal);
    } catch (e) {
      if (e.name === 'AbortError') return; // user cancelled — silent
      errorMsg = e.message || String(e);
    }
    abortRef.current = null;
    if (errorMsg) {
      setError(errorMsg);
      setErrorPage(errorPg);
      return;
    }
    if (resolvedResult) onResult(resolvedResult);
  }

  // Read a picked image file into base64 for the "image → song" path.
  function onPickImage(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.split(',')[1] || '';
      setImage({ dataUrl, base64, mediaType: file.type || 'image/png', name: file.name });
    };
    reader.onerror = () => toast({ title: "Couldn't read that image", tone: 'destructive' });
    reader.readAsDataURL(file);
  }

  // Convert pasted text or an uploaded image into a song. Image wins if present.
  async function convertTextImage() {
    if (image) {
      setBusy(true);
      setWorking('Reading image…');
      await runStreaming('/import/extract-image', { imageData: image.base64, mediaType: image.mediaType }, (extracted) => {
        onExtracted(extracted);
        toast({ title: 'Imported', desc: `${extracted.title || 'Untitled'} · ${extracted.artist || ''}` });
      });
      setBusy(false);
      setWorking('');
      return;
    }
    const text = pastedText.trim();
    if (!text) return;
    setBusy(true);
    setWorking('Parsing pasted text…');
    await runStreaming('/import/extract-text', { text, url: '' }, (extracted) => {
      onExtracted(extracted);
      toast({ title: 'Imported', desc: `${extracted.title || 'Untitled'} · ${extracted.artist || ''}` });
    });
    setBusy(false);
    setWorking('');
  }

  // Single smart entry: detect URL vs. free-text, and for URLs let the agent
  // decide whether it's a single song or a playlist/collection.
  async function submit() {
    const raw = value.trim();
    if (!raw) return;
    setCandidates(null);
    setPlaylist(null);
    setError(''); setErrorPage(null);
    setBusy(true);
    if (looksLikeUrl(raw)) {
      setWorking('Reading page…');
      await runStreaming('/import/auto', { url: normalizeUrl(raw) }, (data) => {
        if (data.kind === 'playlist') {
          const songs = data.songs || [];
          if (songs.length === 0) {
            toast({ title: 'No songs found', desc: 'This looks like a collection, but no song links were detected.', tone: 'destructive' });
            return;
          }
          setPlaylist({ url: normalizeUrl(raw), songs });
          setPlaylistName('');
          setSelected(new Set(songs.map((_, i) => i)));
          setTarget('both');
          setExistingPlaylistId(null);
          setDupMode('skip');
        } else {
          if (!data.body) {
            toast({ title: 'Nothing to extract', desc: 'The page did not contain chords/lyrics we could parse.', tone: 'destructive' });
            return;
          }
          onExtracted(data);
          toast({ title: 'Imported', desc: `${data.title} · ${data.artist}` });
        }
      });
    } else {
      setWorking('Searching the web…');
      await runStreaming('/import/search', { query: raw }, (data) => {
        setCandidates(data.candidates || []);
      });
    }
    setBusy(false);
    setWorking('');
  }

  async function importUrl(targetUrl) {
    setImportingUrl(targetUrl);
    setWorking('Extracting…');
    await runStreaming('/import/extract', { url: targetUrl }, (extracted) => {
      if (!extracted.body) {
        toast({ title: 'Nothing to extract', desc: 'The page did not contain chords/lyrics we could parse.', tone: 'destructive' });
        return;
      }
      onExtracted(extracted);
      toast({ title: 'Imported', desc: `${extracted.title} · ${extracted.artist}` });
    });
    setImportingUrl(null);
    setWorking('');
  }

  async function importPlaylist() {
    if (!playlist || !store) return;
    const chosen = playlist.songs.filter((_, i) => selected.has(i));
    if (chosen.length === 0) return;

    const toLibrary = target === 'library' || target === 'both';
    const toNewPlaylist = target === 'playlist' || target === 'both';
    const toExisting = target === 'existing';
    const name = playlistName.trim() || 'Imported playlist';

    if (toExisting && !existingPlaylistId) {
      setError('Pick a playlist to import into.');
      return;
    }

    // For the existing-playlist path, snapshot its current song keys so we can
    // spot duplicates (by title + artist) and honor the chosen dup handling.
    let destName = name;
    let destKeys = null;
    if (toExisting) {
      const dest = store.playlists.find(p => p.id === existingPlaylistId);
      if (!dest) { setError('That playlist no longer exists.'); return; }
      destName = dest.name;
      destKeys = new Set(dest.entries.map(e => songKey(e.song?.title, e.song?.artist)));
    }

    setBusy(true);
    setWorking(toExisting ? `Adding to “${destName}”…` : toNewPlaylist ? `Building “${name}”…` : 'Importing songs…');
    setProgress([toExisting ? `Adding to “${destName}”…` : toNewPlaylist ? `Creating playlist “${name}”…` : 'Importing songs…']);

    let plId = toExisting ? existingPlaylistId : null;
    if (toNewPlaylist) {
      try {
        plId = await store.createPlaylist(name);
      } catch (e) {
        setError(e.message || String(e));
        setBusy(false);
        setWorking('');
        return;
      }
    }

    let added = 0;
    let skipped = 0;
    for (const s of chosen) {
      // Importing into an existing playlist: skip songs already there BEFORE the
      // expensive fetch+parse, matched on the scanned title + artist (the same
      // basis as the duplicate count shown above). "Add copies anyway" skips this.
      if (toExisting && dupMode === 'skip' && destKeys.has(songKey(s.title, s.artist))) {
        setProgress(p => [...p, `Skipped ${s.title || 'Untitled'}: already in “${destName}”`]);
        skipped++;
        continue;
      }
      setProgress(p => [...p, `Importing ${s.title}…`]);
      let extracted = null;
      await runStreaming('/import/extract', { url: s.url }, (d) => { extracted = d; }, { keepProgress: true });
      if (extracted && extracted.body) {
        // Tags are never imported — they're added manually by editing a song.
        const payload = { ...extracted, tags: [] };
        try {
          // "Both" produces two independent hard copies: one library song and
          // one playlist-owned song.
          if (toLibrary) await store.createSong(payload);
          if (toNewPlaylist || toExisting) await store.importSongToPlaylist(payload, plId);
          // Track what we've added so a repeated incoming title doesn't slip
          // past the skip choice within this same run.
          if (toExisting) destKeys.add(songKey(s.title, s.artist));
          added++;
        } catch (e) {
          setProgress(p => [...p, `Skipped ${s.title}: ${e.message || e}`]);
        }
      } else {
        setProgress(p => [...p, `Skipped ${s.title}: no chords found`]);
      }
    }
    setBusy(false);
    setWorking('');

    const where = target === 'library' ? 'your library'
      : target === 'existing' ? `“${destName}”`
      : target === 'playlist' ? `“${name}”`
      : `your library and “${name}”`;
    toast({
      title: 'Import complete',
      desc: `${added} of ${chosen.length} ${chosen.length === 1 ? 'song' : 'songs'} added to ${where}`
            + (skipped ? ` · ${skipped} already there, skipped` : ''),
      icon: (toNewPlaylist || toExisting) ? 'list' : 'check',
    });
    onPlaylistImported && onPlaylistImported();
  }

  function toggleSong(i) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  const dialogOpen = busy || !!importingUrl;

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Errors always surface at the top. */}
      {error && (
        <div style={{ marginBottom: 14, padding: 12, border: '1px solid var(--destructive)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>
          <div style={{ color: 'var(--destructive)', fontWeight: 600 }}>{error}</div>
          {errorPage && (
            <div style={{ marginTop: 8 }}>
              <Btn variant="outline" size="sm" onClick={() => setViewPage(errorPage)}>
                <Icon name="external" size={14} /> View loaded page
              </Btn>
            </div>
          )}
        </div>
      )}

      {mode === 'textimage' ? (
        <div>
          <label className="label">Paste chords + lyrics</label>
          <textarea
            className="input"
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            disabled={busy || !!image}
            placeholder={"Paste a chord chart here…"}
            style={{ width: '100%', minHeight: 180, resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 12, opacity: image ? 0.5 : 1 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span className="t-muted" style={{ fontSize: 12 }}>or upload an image</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          {image ? (
            <div className="card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
              <img src={image.dataUrl} alt={image.name}
                   style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 'var(--radius-sm)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{image.name}</div>
                <div className="t-muted" style={{ fontSize: 12 }}>{image.mediaType}</div>
              </div>
              <Btn variant="ghost" size="sm" disabled={busy} onClick={() => setImage(null)}>
                <Icon name="close" size={14} /> Remove
              </Btn>
            </div>
          ) : (
            <label className="btn btn-outline" style={{ cursor: busy ? 'default' : 'pointer' }}>
              <Icon name="upload" size={14} /> Choose image
              <input type="file" accept="image/*" disabled={busy} style={{ display: 'none' }}
                     onChange={(e) => { onPickImage(e.target.files && e.target.files[0]); e.target.value = ''; }} />
            </label>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14 }}>
            <Btn variant="primary" disabled={busy || (!image && !pastedText.trim())} onClick={convertTextImage}>
              <Icon name="check" size={14} /> Convert to song
            </Btn>
            <span className="helper" style={{ margin: 0 }}>
              {image ? 'The image is read with vision and parsed into chords.' : 'Pasted text is parsed into chords. Works when a site blocks the importer.'}
            </span>
          </div>
        </div>
      ) : (
      <div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Input value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="Paste a URL, or type e.g. “Wonderwall Oasis acoustic”"
          disabled={busy} />
        <Btn variant="primary" onClick={submit} disabled={busy || !value.trim()}>
          {busy ? <><Icon name="refresh" size={14} /> Working…</> : <><Icon name="globe" size={14} /> Go</>}
        </Btn>
      </div>
      <div className="helper">
        Detects automatically: a single song page, a playlist/collection, or a web search.
      </div>

      {candidates !== null && (
        <div style={{ marginTop: 18 }}>
          {candidates.length === 0 ? (
            <Empty icon="search" title="No versions found" desc="Try a more specific query, or paste a URL directly." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="t-muted" style={{ fontSize: 12 }}>{candidates.length} versions found · pick one to import</div>
              {candidates.map((c, i) => (
                <CandidateCard
                  key={i} candidate={c}
                  busy={importingUrl === c.url}
                  disabled={!!importingUrl && importingUrl !== c.url}
                  onImport={() => importUrl(c.url)} />
              ))}
            </div>
          )}
        </div>
      )}

      {playlist && (() => {
        const selectedCount = selected.size;
        const total = playlist.songs.length;
        const toNewPlaylist = target === 'playlist' || target === 'both';
        const allSelected = selectedCount === total;
        const targetOptions = [
          { value: 'library', label: 'Library only', desc: 'Add songs to your library.' },
          { value: 'playlist', label: 'New playlist', desc: 'Create a new playlist with its own copies.' },
          { value: 'existing', label: 'Existing playlist', desc: 'Append to a playlist you already have.' },
          { value: 'both', label: 'Both', desc: 'A library copy and a new-playlist copy.' },
        ];
        // Destination + duplicate (title+artist) detection for the
        // "import into an existing playlist" path.
        const destPl = target === 'existing' && existingPlaylistId
          ? store.playlists.find(p => p.id === existingPlaylistId) : null;
        const destKeySet = destPl
          ? new Set(destPl.entries.map(e => songKey(e.song?.title, e.song?.artist))) : null;
        const dupCount = destKeySet
          ? playlist.songs.filter((s, i) => selected.has(i) && destKeySet.has(songKey(s.title, s.artist))).length
          : 0;
        return (
        <div style={{ marginTop: 18 }}>
          <div className="t-muted" style={{ fontSize: 12 }}>
            <Icon name="list" size={12} /> Playlist detected · {total} {total === 1 ? 'song' : 'songs'}
          </div>

          <label className="label" style={{ marginTop: 14 }}>Import to</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {targetOptions.map(o => (
              <button key={o.value} type="button" disabled={busy}
                onClick={() => setTarget(o.value)}
                style={{
                  textAlign: 'left', cursor: busy ? 'default' : 'pointer',
                  border: '1px solid', borderColor: target === o.value ? 'var(--primary)' : 'var(--border)',
                  background: target === o.value ? 'color-mix(in oklab, var(--primary) 10%, var(--card))' : 'var(--card)',
                  color: 'var(--foreground)', borderRadius: 'var(--radius)', padding: 12,
                }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{o.label}</div>
                <div className="t-muted" style={{ marginTop: 2, fontSize: 11 }}>{o.desc}</div>
              </button>
            ))}
          </div>

          {toNewPlaylist && (
            <div style={{ margin: '12px 0' }}>
              <label className="label">Playlist name</label>
              <Input value={playlistName}
                onChange={(e) => setPlaylistName(e.target.value)}
                placeholder="Imported playlist"
                disabled={busy} />
            </div>
          )}

          {target === 'existing' && (
            <div style={{ margin: '12px 0' }}>
              <label className="label">Add to playlist</label>
              {store.playlists.length === 0 ? (
                <div className="t-muted" style={{ padding: 12, border: '1px dashed var(--border)', borderRadius: 'var(--radius)' }}>
                  You don’t have any playlists yet — choose “New playlist” instead.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto',
                              border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 4 }}>
                  {store.playlists.map(p => (
                    <button key={p.id} type="button" className="menu-item" disabled={busy}
                      style={{
                        background: existingPlaylistId === p.id ? 'var(--accent)' : 'transparent',
                        border: 0, textAlign: 'left', cursor: busy ? 'default' : 'pointer',
                        display: 'flex', alignItems: 'center', gap: 10,
                      }}
                      onClick={() => setExistingPlaylistId(p.id)}>
                      <span style={{ flex: 1, fontSize: 13 }}>{p.name}</span>
                      {p.shared && <Badge variant="outline"><Icon name="users" size={10} /></Badge>}
                      <span className="t-muted" style={{ fontSize: 11 }}>{p.entries.length}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {target === 'existing' && dupCount > 0 && (
            <div style={{ margin: '12px 0', padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                          background: 'color-mix(in oklab, var(--primary) 6%, var(--card))' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {dupCount} of the selected {dupCount === 1 ? 'song is' : 'songs are'} already in “{destPl.name}”
              </div>
              <div className="t-muted" style={{ fontSize: 12, margin: '2px 0 10px' }}>
                Matched by title and artist — choose what to do with the duplicates:
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { value: 'skip', label: 'Skip duplicates', desc: 'Import only the songs not already there.' },
                  { value: 'copy', label: 'Add copies anyway', desc: 'Import everything, even duplicates.' },
                ].map(o => (
                  <button key={o.value} type="button" disabled={busy}
                    onClick={() => setDupMode(o.value)}
                    style={{
                      textAlign: 'left', cursor: busy ? 'default' : 'pointer',
                      border: '1px solid', borderColor: dupMode === o.value ? 'var(--primary)' : 'var(--border)',
                      background: dupMode === o.value ? 'color-mix(in oklab, var(--primary) 12%, var(--card))' : 'var(--card)',
                      color: 'var(--foreground)', borderRadius: 'var(--radius)', padding: 10,
                    }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{o.label}</div>
                    <div className="t-muted" style={{ marginTop: 2, fontSize: 11 }}>{o.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '14px 0 8px' }}>
            <span className="t-muted" style={{ fontSize: 12 }}>{selectedCount} of {total} selected</span>
            <Btn variant="ghost" size="sm" disabled={busy}
              onClick={() => setSelected(allSelected ? new Set() : new Set(playlist.songs.map((_, i) => i)))}>
              {allSelected ? 'Deselect all' : 'Select all'}
            </Btn>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {playlist.songs.map((s, i) => {
              const on = selected.has(i);
              return (
                <button key={i} type="button" disabled={busy} onClick={() => toggleSong(i)}
                  className="card"
                  style={{
                    padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10,
                    textAlign: 'left', cursor: busy ? 'default' : 'pointer', width: '100%',
                    borderColor: on ? 'var(--primary)' : 'var(--border)',
                    opacity: on ? 1 : 0.55,
                  }}>
                  <span style={{
                    width: 18, height: 18, flexShrink: 0, borderRadius: 5,
                    border: '1px solid', borderColor: on ? 'var(--primary)' : 'var(--border)',
                    background: on ? 'var(--primary)' : 'transparent',
                    color: 'var(--primary-foreground)', display: 'grid', placeItems: 'center',
                  }}>
                    {on && <Icon name="check" size={12} />}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{s.title || 'Untitled'}</span>
                  {s.artist && <span className="t-muted" style={{ fontSize: 12 }}>· {s.artist}</span>}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <Btn variant="primary" onClick={importPlaylist}
                 disabled={busy || selectedCount === 0 || (target === 'existing' && !existingPlaylistId)}>
              <Icon name="download" size={14} /> Import {selectedCount} {selectedCount === 1 ? 'song' : 'songs'}
            </Btn>
            <span className="helper" style={{ margin: 0 }}>Each song is fetched and parsed individually — this can take a while.</span>
          </div>
        </div>
        );
      })()}
      </div>
      )}

      <Dialog open={dialogOpen} onClose={() => {}} dismissOnBackdrop={false}>
        {/* .dialog already pads + is width:100%/max-480 and fills that width,
            so no inner padding or fixed min-width here — those overflowed the
            right edge on phones. */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
            <span style={{ fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{working || 'Working…'}</span>
            <Btn variant="ghost" size="sm" onClick={cancelWork}>Cancel</Btn>
          </div>
          <ProgressLog lines={progress} active={dialogOpen} />
        </div>
      </Dialog>

      <LoadedPageView page={viewPage} onClose={() => setViewPage(null)} />
    </div>
  );
}

// Full-screen view of exactly what the headless browser loaded on a failed
// import, with the option to download the raw HTML.
function LoadedPageView({ page, onClose }) {
  if (!page) return null;

  function download() {
    const body = page.html || `<pre>${(page.text || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>`;
    const blob = new Blob([body], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const base = (page.title || page.url || 'loaded-page').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'loaded-page';
    a.download = `${base}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'var(--background)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {page.title || 'Loaded page'}{page.loaded === false ? ' (failed to load fully)' : ''}
          </div>
          {page.url && <div className="t-muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.url}</div>}
        </div>
        <Btn variant="outline" size="sm" onClick={download}><Icon name="download" size={14} /> Download HTML</Btn>
        <Btn variant="ghost" size="sm" onClick={onClose}><Icon name="close" size={14} /> Close</Btn>
      </div>
      {page.html ? (
        <iframe title="Loaded page" sandbox="" srcDoc={page.html}
                style={{ flex: 1, width: '100%', border: 0, background: '#fff' }} />
      ) : (
        <pre style={{
          flex: 1, margin: 0, overflow: 'auto', padding: 16,
          fontSize: 12, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          color: 'var(--foreground)',
        }}>{page.text || '(the page had no readable text)'}</pre>
      )}
    </div>
  );
}

function ProgressLog({ lines, active }) {
  const ref = useRefS(null);
  useEffectS(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length]);
  return (
    <div style={{
      marginTop: 14, padding: 10, borderRadius: 'var(--radius-sm)',
      background: 'color-mix(in oklab, var(--primary) 6%, var(--card))',
      border: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {active && <Icon name="refresh" size={12} className="spin" />}
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted-foreground)' }}>
          {active ? 'Working…' : 'Progress'}
        </span>
      </div>
      <div ref={ref} style={{
        maxHeight: 140, overflowY: 'auto', overflowX: 'hidden',
        fontFamily: 'var(--font-mono)', fontSize: 11,
        color: 'var(--muted-foreground)',
        display: 'flex', flexDirection: 'column', gap: 3,
        overflowWrap: 'anywhere', wordBreak: 'break-word',
      }}>
        {lines.map((line, i) => {
          const isLast = i === lines.length - 1;
          return (
            <div key={i} style={{
              color: isLast && active ? 'var(--foreground)' : undefined,
              opacity: isLast && active ? 1 : 0.7,
            }}>· {line}</div>
          );
        })}
      </div>
    </div>
  );
}

function CandidateCard({ candidate, busy, disabled, onImport }) {
  return (
    <div className="card" style={{
      padding: 12, display: 'flex', alignItems: 'center', gap: 12,
      opacity: disabled ? 0.45 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{candidate.title || 'Untitled'}</span>
          {candidate.artist && <span className="t-muted">· {candidate.artist}</span>}
          {candidate.key && <Badge variant="outline">{candidate.key}</Badge>}
        </div>
        <div className="t-muted" style={{ marginTop: 4, fontSize: 12 }}>
          <Icon name="external" size={11} /> {candidate.source || new URL(candidate.url).hostname}
          {candidate.snippet && <span> · {candidate.snippet}</span>}
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {candidate.url}
        </div>
      </div>
      <Btn variant="primary" size="sm" onClick={onImport} disabled={disabled || busy}>
        {busy ? <><Icon name="refresh" size={12} /> Extracting…</> : <><Icon name="download" size={12} /> Import</>}
      </Btn>
    </div>
  );
}

Object.assign(window, {
  LibraryScreen, PlaylistsScreen, PlaylistDetail,
  InboxScreen, SettingsScreen, EditorScreen,
  ShareSongDialog, SharePlaylistDialog, AddToPlaylistDialog,
  RenamePlaylistDialog, ImportPanel, ImportScreen,
});
