// AUTO-GENERATED from screens.jsx by server/scripts/build-frontend.js — do not edit.
/* Library, Playlists, Inbox, Settings, Editor, Versions drawer, Share & Add-to-playlist dialogs */

const {
  useState: useStateS,
  useEffect: useEffectS,
  useMemo: useMemoS,
  useRef: useRefS,
  useCallback: useCallbackS
} = React;

// ===========================================================================
// LIBRARY
// ===========================================================================
function LibraryScreen({
  store,
  onOpen,
  onNewSong
}) {
  const [q, setQ] = useStateS('');
  // Multi-select filter chips. Each selected key is either `tag:<name>` or
  // `pl:<playlistId>`; an item matches if it satisfies ANY selected chip.
  const [selected, setSelected] = useStateS(() => new Set());
  const [sort, setSort] = useStateS('recent');
  const [showPlaylistSongs, setShowPlaylistSongs] = useStateS(true);
  const [moreFor, setMoreFor] = useStateS(null); // library song: { song, el }
  const [plMoreFor, setPlMoreFor] = useStateS(null); // playlist song: { song, playlist, el }
  const [confirmDel, setConfirmDel] = useStateS(null); // song pending delete
  const toast = useToast();
  const menu = useMenu();

  // Unified list: library songs (playlist = null) plus each playlist's own
  // copies, each tagged with the playlist it belongs to.
  const items = useMemoS(() => {
    const lib = store.songs.map(s => ({
      song: s,
      playlist: null
    }));
    if (!showPlaylistSongs) return lib;
    const fromPlaylists = store.playlists.flatMap(p => p.entries.filter(e => e.song).map(e => ({
      song: e.song,
      playlist: p
    })));
    return lib.concat(fromPlaylists);
  }, [store.songs, store.playlists, showPlaylistSongs]);
  const hasPlaylistSongs = useMemoS(() => store.playlists.some(p => p.entries.some(e => e.song)), [store.playlists]);
  const allTags = useMemoS(() => {
    const s = new Set();
    items.forEach(it => it.song.tags.forEach(t => s.add(t)));
    return Array.from(s).sort();
  }, [items]);

  // Playlists that currently contribute songs to the list — shown as colored
  // filter chips. Respects the "show playlist songs" toggle via `items`.
  const playlistChips = useMemoS(() => {
    const seen = new Map();
    items.forEach(({
      playlist: p
    }) => {
      if (p && !seen.has(p.id)) seen.set(p.id, p);
    });
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
      r = r.filter(({
        song: s,
        playlist: p
      }) => s.title.toLowerCase().includes(ql) || s.artist.toLowerCase().includes(ql) || s.tags.some(t => t.toLowerCase().includes(ql)) || p && p.name.toLowerCase().includes(ql));
    }
    if (selected.size) {
      r = r.filter(({
        song: s,
        playlist: p
      }) => {
        for (const key of selected) {
          if (key.startsWith('pl:')) {
            if (p && p.id === key.slice(3)) return true;
          } else if (s.tags.includes(key.slice(4))) return true;
        }
        return false;
      });
    }
    if (sort === 'title') r.sort((a, b) => a.song.title.localeCompare(b.song.title));else if (sort === 'artist') r.sort((a, b) => a.song.artist.localeCompare(b.song.artist));else r.sort((a, b) => b.song.updatedAt - a.song.updatedAt);
    return r;
  }, [items, q, selected, sort]);
  return /*#__PURE__*/React.createElement("div", {
    className: "page"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lib-toolbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "search"
  }, /*#__PURE__*/React.createElement(SearchInput, {
    value: q,
    onChange: setQ,
    placeholder: "Search songs, artists, tags..."
  })), /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    size: "sm",
    onClick: e => menu.openOn(e.currentTarget)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "sort",
    size: 14
  }), " Sort: ", sort === 'recent' ? 'Recent' : sort === 'title' ? 'Title' : 'Artist'), /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    size: "sm",
    onClick: onNewSong
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 14
  }), " New song")), /*#__PURE__*/React.createElement(Menu, {
    open: menu.open,
    anchor: menu.anchor,
    onClose: menu.close,
    items: [{
      label: 'Recently updated',
      icon: 'history',
      onSelect: () => setSort('recent')
    }, {
      label: 'Title A → Z',
      icon: 'type',
      onSelect: () => setSort('title')
    }, {
      label: 'Artist A → Z',
      icon: 'user',
      onSelect: () => setSort('artist')
    }]
  }), /*#__PURE__*/React.createElement("div", {
    className: "tag-bar"
  }, /*#__PURE__*/React.createElement("button", {
    className: `tag-chip ${selected.size === 0 ? 'on' : ''}`,
    onClick: () => setSelected(new Set())
  }, "All"), playlistChips.map(p => {
    const key = 'pl:' + p.id;
    return /*#__PURE__*/React.createElement("button", {
      key: key,
      className: `tag-chip tag-chip-pl ${selected.has(key) ? 'on' : ''}`,
      onClick: () => toggleChip(key)
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "list",
      size: 11
    }), " ", p.name);
  }), allTags.map(t => {
    const key = 'tag:' + t;
    return /*#__PURE__*/React.createElement("button", {
      key: key,
      className: `tag-chip ${selected.has(key) ? 'on' : ''}`,
      onClick: () => toggleChip(key)
    }, t);
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 10,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-muted"
  }, filtered.length, " ", filtered.length === 1 ? 'song' : 'songs'), hasPlaylistSongs && /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-muted",
    style: {
      fontSize: 13
    }
  }, "Show playlist songs"), /*#__PURE__*/React.createElement(Switch, {
    on: showPlaylistSongs,
    onChange: setShowPlaylistSongs
  }))), filtered.length === 0 ? /*#__PURE__*/React.createElement(Empty, {
    icon: "music",
    title: "No songs match",
    desc: "Try clearing the filter.",
    action: /*#__PURE__*/React.createElement(Btn, {
      variant: "primary",
      onClick: onNewSong
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "plus",
      size: 14
    }), " New song")
  }) : /*#__PURE__*/React.createElement("div", {
    className: "song-list"
  }, filtered.map(({
    song,
    playlist
  }) => /*#__PURE__*/React.createElement(SongRow, {
    key: `${playlist ? playlist.id : 'lib'}:${song.id}`,
    song: song,
    playlist: playlist,
    onOpen: onOpen,
    onMore: el => playlist ? setPlMoreFor({
      song,
      playlist,
      el
    }) : setMoreFor({
      song,
      el
    })
  }))), /*#__PURE__*/React.createElement(SongMoreMenu, {
    state: moreFor,
    onClose: () => setMoreFor(null),
    store: store,
    onDelete: song => setConfirmDel(song)
  }), /*#__PURE__*/React.createElement(PlaylistSongMoreMenu, {
    state: plMoreFor,
    onClose: () => setPlMoreFor(null),
    store: store,
    onOpen: onOpen
  }), /*#__PURE__*/React.createElement(Dialog, {
    open: !!confirmDel,
    onClose: () => setConfirmDel(null)
  }, /*#__PURE__*/React.createElement("div", {
    className: "dialog-title"
  }, "Delete \u201C", confirmDel?.title, "\u201D?"), /*#__PURE__*/React.createElement("div", {
    className: "dialog-desc"
  }, "This removes the song from your library. This can\u2019t be undone."), /*#__PURE__*/React.createElement("div", {
    className: "dialog-footer"
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    onClick: () => setConfirmDel(null)
  }, "Cancel"), /*#__PURE__*/React.createElement(Btn, {
    variant: "destructive",
    onClick: () => {
      const s = confirmDel;
      store.deleteSong(s.id);
      setConfirmDel(null);
      toast({
        title: 'Song deleted',
        desc: s.title,
        tone: 'destructive',
        icon: 'trash'
      });
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "trash",
    size: 14
  }), " Delete"))));
}
function SongRow({
  song,
  playlist,
  onOpen,
  onMore
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "song-row sr-lib",
    onClick: () => onOpen(song, playlist ? playlist.id : undefined)
  }, /*#__PURE__*/React.createElement("div", {
    className: "sr-content"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sr-meta"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sr-title"
  }, song.title), /*#__PURE__*/React.createElement("div", {
    className: "sr-artist"
  }, song.artist)), /*#__PURE__*/React.createElement("div", {
    className: "sr-tags"
  }, playlist && /*#__PURE__*/React.createElement("span", {
    className: "tag-pill sr-pl-pill",
    title: `In playlist “${playlist.name}”`
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "list",
    size: 10
  }), " ", playlist.name), song.tags.slice(0, playlist ? 2 : 3).map(t => /*#__PURE__*/React.createElement("span", {
    key: t,
    className: "tag-pill"
  }, t))), /*#__PURE__*/React.createElement("div", {
    className: "sr-key"
  }, /*#__PURE__*/React.createElement("strong", null, song.key), song.capo > 0 ? ` · Capo ${song.capo}` : '')), /*#__PURE__*/React.createElement(IconBtn, {
    icon: "more",
    label: "More",
    onClick: e => {
      e.stopPropagation();
      onMore(e.currentTarget);
    }
  }));
}
function SongMoreMenu({
  state,
  onClose,
  store,
  onDelete
}) {
  const toast = useToast();
  if (!state) return null;
  return /*#__PURE__*/React.createElement(Menu, {
    open: true,
    anchor: state.el,
    onClose: onClose,
    items: [{
      label: 'Open in editor',
      icon: 'edit',
      onSelect: () => store.openEditor(state.song)
    }, {
      label: 'Add to playlist',
      icon: 'list',
      onSelect: () => store.openAddToPlaylist(state.song)
    }, {
      label: 'Share',
      icon: 'share2',
      onSelect: () => store.openShareFor(state.song)
    }, {
      label: 'Duplicate',
      icon: 'copy',
      onSelect: () => {
        store.duplicateSong(state.song);
        toast({
          title: 'Song duplicated',
          desc: state.song.title
        });
      }
    }, {
      label: 'Export',
      icon: 'download',
      onSelect: async () => {
        try {
          await store.exportSong(state.song);
        } catch (e) {
          toast({
            title: 'Export failed',
            desc: e.message,
            tone: 'destructive'
          });
        }
      }
    }, {
      sep: true
    }, {
      label: 'Delete',
      icon: 'trash',
      destructive: true,
      onSelect: () => onDelete(state.song)
    }]
  });
}

// More-menu for a playlist-owned song shown in the library. Mirrors the
// playlist detail row menu — these actions act on the playlist's copy, not a
// library song.
function PlaylistSongMoreMenu({
  state,
  onClose,
  store,
  onOpen
}) {
  const toast = useToast();
  if (!state) return null;
  const {
    song,
    playlist
  } = state;
  return /*#__PURE__*/React.createElement(Menu, {
    open: true,
    anchor: state.el,
    onClose: onClose,
    items: [{
      label: 'Open in playlist',
      icon: 'list',
      onSelect: () => onOpen(song, playlist.id)
    }, {
      label: 'Edit song',
      icon: 'edit',
      onSelect: () => store.openEditor(song)
    }, {
      label: 'Share',
      icon: 'share2',
      onSelect: () => store.openShareFor(song)
    }, {
      label: 'Add to library',
      icon: 'plus',
      onSelect: async () => {
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
    }, {
      sep: true
    }, {
      label: 'Remove from playlist',
      icon: 'trash',
      destructive: true,
      onSelect: () => {
        store.removeFromPlaylist(song.id, playlist.id);
        toast({
          title: 'Removed from playlist',
          desc: song.title,
          tone: 'destructive',
          icon: 'trash'
        });
      }
    }]
  });
}

// ===========================================================================
// PLAYLISTS
// ===========================================================================
function PlaylistsScreen({
  store,
  onOpen
}) {
  const [creating, setCreating] = useStateS(false);
  const [newName, setNewName] = useStateS('');
  const [menuFor, setMenuFor] = useStateS(null); // { anchor, pl }
  const [shareFor, setShareFor] = useStateS(null);
  const [renameFor, setRenameFor] = useStateS(null);
  const [deleteFor, setDeleteFor] = useStateS(null);
  const toast = useToast();
  const playlists = store.playlists;
  return /*#__PURE__*/React.createElement("div", {
    className: "page"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 18,
      flexWrap: 'wrap',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    className: "section-headline"
  }, "Playlists"), /*#__PURE__*/React.createElement("div", {
    className: "section-sub"
  }, "Group songs into sets. Each playlist keeps its own copies of its songs.")), /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    onClick: () => setCreating(true)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 14
  }), " New playlist")), playlists.length === 0 ? /*#__PURE__*/React.createElement(Empty, {
    icon: "list",
    title: "No playlists yet",
    desc: "Create a set to group songs.",
    action: /*#__PURE__*/React.createElement(Btn, {
      variant: "primary",
      onClick: () => setCreating(true)
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "plus",
      size: 14
    }), " New playlist")
  }) : /*#__PURE__*/React.createElement("table", {
    className: "data-table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Name"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: 90
    }
  }, "Songs"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: 44
    }
  }))), /*#__PURE__*/React.createElement("tbody", null, playlists.map(p => /*#__PURE__*/React.createElement("tr", {
    key: p.id,
    className: "row-clickable",
    onClick: () => onOpen(p)
  }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, p.name), p.shared && /*#__PURE__*/React.createElement(Badge, {
    variant: "outline"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "users",
    size: 10
  }), " Shared"))), /*#__PURE__*/React.createElement("td", {
    className: "t-muted"
  }, p.entries.length), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement(IconBtn, {
    icon: "more",
    label: "More",
    onClick: e => {
      e.stopPropagation();
      setMenuFor({
        anchor: e.currentTarget,
        pl: p
      });
    }
  })))))), /*#__PURE__*/React.createElement(Menu, {
    open: !!menuFor,
    anchor: menuFor?.anchor,
    onClose: () => setMenuFor(null),
    items: !menuFor ? [] : [{
      label: 'Share',
      icon: 'share2',
      onSelect: () => setShareFor(menuFor.pl)
    }, {
      label: 'Rename',
      icon: 'edit',
      onSelect: () => setRenameFor(menuFor.pl)
    }, {
      label: 'Export',
      icon: 'download',
      onSelect: async () => {
        try {
          await store.exportPlaylist(menuFor.pl);
        } catch (e) {
          toast({
            title: 'Export failed',
            desc: e.message,
            tone: 'destructive'
          });
        }
      }
    }, {
      sep: true
    }, (menuFor.pl.collaborators || []).length > 1 ? {
      label: 'Leave playlist',
      icon: 'logout',
      destructive: true,
      onSelect: () => setDeleteFor(menuFor.pl)
    } : {
      label: 'Delete playlist',
      icon: 'trash',
      destructive: true,
      onSelect: () => setDeleteFor(menuFor.pl)
    }]
  }), /*#__PURE__*/React.createElement(SharePlaylistDialog, {
    open: !!shareFor,
    playlist: shareFor,
    store: store,
    onClose: () => setShareFor(null)
  }), /*#__PURE__*/React.createElement(RenamePlaylistDialog, {
    open: !!renameFor,
    playlist: renameFor,
    store: store,
    onClose: () => setRenameFor(null)
  }), /*#__PURE__*/React.createElement(Dialog, {
    open: !!deleteFor,
    onClose: () => setDeleteFor(null)
  }, (() => {
    const leaving = !!deleteFor && (deleteFor.collaborators || []).length > 1;
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "dialog-title"
    }, leaving ? `Leave “${deleteFor?.name}”?` : `Delete “${deleteFor?.name}”?`), /*#__PURE__*/React.createElement("div", {
      className: "dialog-desc"
    }, leaving ? 'You’ll be removed from this shared playlist. It stays available for the others.' : 'This removes the playlist and its songs. This can’t be undone.'), /*#__PURE__*/React.createElement("div", {
      className: "dialog-footer"
    }, /*#__PURE__*/React.createElement(Btn, {
      variant: "outline",
      onClick: () => setDeleteFor(null)
    }, "Cancel"), /*#__PURE__*/React.createElement(Btn, {
      variant: "destructive",
      onClick: () => {
        const p = deleteFor;
        store.deletePlaylist(p.id);
        setDeleteFor(null);
        toast(leaving ? {
          title: 'Left playlist',
          desc: p.name,
          icon: 'logout'
        } : {
          title: 'Playlist deleted',
          desc: p.name,
          tone: 'destructive',
          icon: 'trash'
        });
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: leaving ? 'logout' : 'trash',
      size: 14
    }), " ", leaving ? 'Leave' : 'Delete')));
  })()), /*#__PURE__*/React.createElement(Dialog, {
    open: creating,
    onClose: () => setCreating(false)
  }, /*#__PURE__*/React.createElement("div", {
    className: "dialog-title"
  }, "New playlist"), /*#__PURE__*/React.createElement("div", {
    className: "dialog-desc"
  }, "Name your set. You can add songs once it's created."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Name"), /*#__PURE__*/React.createElement(Input, {
    value: newName,
    onChange: e => setNewName(e.target.value),
    placeholder: "Friday at Cantine"
  })), /*#__PURE__*/React.createElement("div", {
    className: "dialog-footer"
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    onClick: () => setCreating(false)
  }, "Cancel"), /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    disabled: !newName.trim(),
    onClick: () => {
      store.createPlaylist(newName.trim());
      setCreating(false);
      setNewName('');
    }
  }, "Create"))));
}

// ---------- playlist detail ----------
function PlaylistDetail({
  playlist,
  store,
  onOpenSong,
  onBack
}) {
  const pl = playlist;
  // Each entry carries its own playlist-owned copy of the song.
  const entries = pl.entries.map(e => e.song ? {
    song: e.song
  } : null).filter(Boolean);
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
  return /*#__PURE__*/React.createElement("div", {
    className: "page"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pl-detail-hero"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pl-detail-info"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      marginBottom: 6
    }
  }, pl.shared && /*#__PURE__*/React.createElement(Badge, {
    variant: "primary"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "users",
    size: 11
  }), " Shared playlist"), /*#__PURE__*/React.createElement(Badge, {
    variant: "outline"
  }, entries.length, " songs")), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Owned by ", owner?.name, pl.ownerId === 'u_me' ? ' (you)' : '', " \xB7 Updated ", relTime(pl.updatedAt)), pl.shared && /*#__PURE__*/React.createElement("div", {
    className: "pl-collab-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "collab-avatars"
  }, collabs.map(u => /*#__PURE__*/React.createElement("span", {
    key: u.id,
    className: `av ${u.color}`,
    title: u.name
  }, u.initials))), /*#__PURE__*/React.createElement("span", {
    className: "t-muted"
  }, collabs.length, " collaborators \xB7 edits sync to everyone")), isOwner && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    size: "sm",
    onClick: () => setShareLinkOpen(true)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "link",
    size: 14
  }), " ", pl.publicToken ? 'Share link · active' : 'Share link')))), /*#__PURE__*/React.createElement(ShareLinkDialog, {
    open: shareLinkOpen,
    playlist: pl,
    store: store,
    onClose: () => setShareLinkOpen(false)
  }), entries.length === 0 ? /*#__PURE__*/React.createElement(Empty, {
    icon: "music",
    title: "Empty playlist",
    desc: "Open a song from your library and choose Add to playlist."
  }) : /*#__PURE__*/React.createElement("div", {
    className: "song-list pl-song-list"
  }, entries.map(({
    song
  }, i) => /*#__PURE__*/React.createElement("div", {
    key: song.id,
    className: "song-row pl-song-row",
    onClick: () => onOpenSong(song.id)
  }, /*#__PURE__*/React.createElement("div", {
    className: "pl-reorder"
  }, /*#__PURE__*/React.createElement(IconBtn, {
    icon: "arrowUp",
    label: "Move up",
    disabled: i === 0,
    onClick: e => {
      e.stopPropagation();
      move(song.id, -1);
    }
  }), /*#__PURE__*/React.createElement(IconBtn, {
    icon: "arrowDown",
    label: "Move down",
    disabled: i === entries.length - 1,
    onClick: e => {
      e.stopPropagation();
      move(song.id, 1);
    }
  })), /*#__PURE__*/React.createElement("span", {
    className: "pl-index"
  }, (i + 1).toString().padStart(2, '0')), /*#__PURE__*/React.createElement("div", {
    className: "sr-content"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sr-meta"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sr-title"
  }, song.title), /*#__PURE__*/React.createElement("div", {
    className: "sr-artist"
  }, song.artist)), /*#__PURE__*/React.createElement("div", {
    className: "sr-key"
  }, /*#__PURE__*/React.createElement("strong", null, song.key), song.capo > 0 ? ` · Capo ${song.capo}` : '')), /*#__PURE__*/React.createElement(IconBtn, {
    icon: "more",
    label: "More",
    onClick: e => {
      e.stopPropagation();
      setRowMenu({
        anchor: e.currentTarget,
        songId: song.id,
        song
      });
    }
  })))), /*#__PURE__*/React.createElement(Menu, {
    open: !!rowMenu,
    anchor: rowMenu?.anchor,
    onClose: () => setRowMenu(null),
    items: !rowMenu ? [] : [{
      label: 'Edit song',
      icon: 'edit',
      onSelect: () => store.openEditor(rowMenu.song)
    }, {
      label: 'Share',
      icon: 'share2',
      onSelect: () => store.openShareFor(rowMenu.song)
    }, {
      label: 'Add to playlist',
      icon: 'list',
      onSelect: () => store.openAddToPlaylist(rowMenu.song)
    }, {
      label: 'Add to library',
      icon: 'plus',
      onSelect: async () => {
        try {
          await store.copySongToLibrary(rowMenu.songId);
          toast({
            title: 'Added to library',
            desc: rowMenu.song.title,
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
    }, {
      sep: true
    }, {
      label: 'Remove from playlist',
      icon: 'trash',
      destructive: true,
      onSelect: () => {
        store.removeFromPlaylist(rowMenu.songId, pl.id);
        toast({
          title: 'Removed from playlist',
          desc: rowMenu.song.title,
          tone: 'destructive',
          icon: 'trash'
        });
      }
    }]
  }));
}

// Owner-only dialog to create / copy / disable a playlist's read-only public link.
function ShareLinkDialog({
  open,
  playlist,
  store,
  onClose
}) {
  const [busy, setBusy] = useStateS(false);
  const toast = useToast();
  if (!playlist) return null;
  const token = playlist.publicToken;
  const url = token ? `${window.location.origin}/?playlist=${token}` : '';
  async function enable() {
    setBusy(true);
    try {
      await store.createShareLink(playlist.id);
    } catch (e) {
      toast({
        title: "Couldn't create link",
        desc: e.message || String(e),
        tone: 'destructive'
      });
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    try {
      await store.removeShareLink(playlist.id);
      toast({
        title: 'Link disabled',
        desc: 'The old link no longer works.',
        icon: 'lock'
      });
    } catch (e) {
      toast({
        title: "Couldn't disable link",
        desc: e.message || String(e),
        tone: 'destructive'
      });
    } finally {
      setBusy(false);
    }
  }
  function copy() {
    if (!url || !navigator.clipboard) return;
    navigator.clipboard.writeText(url).then(() => toast({
      title: 'Link copied',
      icon: 'check'
    }), () => {});
  }
  return /*#__PURE__*/React.createElement(Dialog, {
    open: open,
    onClose: onClose,
    wide: true
  }, /*#__PURE__*/React.createElement("div", {
    className: "dialog-title"
  }, "Share \u201C", playlist.name, "\u201D"), /*#__PURE__*/React.createElement("div", {
    className: "dialog-desc"
  }, "Anyone with this link can view the songs and use autoscroll \u2014 read-only. They can\u2019t make any changes to the playlist or its songs, even if they\u2019re signed in."), token ? /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("input", {
    className: "input",
    readOnly: true,
    value: url,
    onFocus: e => e.target.select(),
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    onClick: copy
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "copy",
    size: 14
  }), " Copy")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "helper",
    style: {
      margin: 0
    }
  }, "Link is active."), /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    size: "sm",
    disabled: busy,
    onClick: disable
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "trash",
    size: 14
  }), " Disable link"))) : /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    disabled: busy,
    onClick: enable
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "link",
    size: 14
  }), " ", busy ? 'Creating…' : 'Create read-only link')));
}

// ===========================================================================
// INBOX
// ===========================================================================
function InboxScreen({
  store
}) {
  const [pending, setPending] = useStateS(null);
  if (store.inbox.length === 0) {
    return /*#__PURE__*/React.createElement("div", {
      className: "page"
    }, /*#__PURE__*/React.createElement("h2", {
      className: "section-headline"
    }, "Inbox"), /*#__PURE__*/React.createElement("div", {
      className: "section-sub"
    }, "Songs and playlists shared with you will show up here."), /*#__PURE__*/React.createElement(Empty, {
      icon: "inbox",
      title: "All caught up",
      desc: "Nothing new since you last checked."
    }));
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "page"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 18,
      gap: 12,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    className: "section-headline"
  }, "Inbox"), /*#__PURE__*/React.createElement("div", {
    className: "section-sub"
  }, "Songs and playlists friends have sent you.")), /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    size: "sm",
    onClick: () => store.markAllRead()
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 14
  }), " Mark all read")), /*#__PURE__*/React.createElement("div", {
    className: "song-list",
    style: {
      background: 'var(--background)'
    }
  }, store.inbox.map(item => /*#__PURE__*/React.createElement(InboxRow, {
    key: item.id,
    item: item,
    onAct: action => {
      if (item.kind === 'song') {
        if (action === 'add') {
          if (item.matchSongId) setPending(item);else {
            store.acceptSong(item);
          }
        } else if (action === 'open') {
          setPending(item);
        } else if (action === 'dismiss') store.dismissInbox(item.id);
      } else if (item.kind === 'playlist' || item.kind === 'playlist-invite') {
        if (action === 'add') store.acceptPlaylist(item);else if (action === 'dismiss') store.dismissInbox(item.id);
      }
    }
  }))), /*#__PURE__*/React.createElement(ConflictDialog, {
    item: pending,
    onClose: () => setPending(null),
    store: store
  }));
}
function InboxRow({
  item,
  onAct
}) {
  const from = window.IT.USERS.find(u => u.id === item.fromUserId);
  return /*#__PURE__*/React.createElement("div", {
    className: `inbox-row ${item.unread ? 'unread' : ''}`
  }, /*#__PURE__*/React.createElement("span", {
    className: `ib-av ${from.color}`
  }, from.initials), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "ib-title"
  }, item.kind === 'song' ? /*#__PURE__*/React.createElement(React.Fragment, null, from.name, " shared ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--primary)'
    }
  }, item.songSnapshot.title)) : item.kind === 'playlist-invite' ? /*#__PURE__*/React.createElement(React.Fragment, null, from.name, " invited you to collaborate on ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--primary)'
    }
  }, item.playlistName)) : /*#__PURE__*/React.createElement(React.Fragment, null, from.name, " shared playlist ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--primary)'
    }
  }, item.playlistName)), item.kind === 'song' && item.matchSongId && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 8
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "outline"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "refresh",
    size: 11
  }), " You have a copy"))), /*#__PURE__*/React.createElement("div", {
    className: "ib-desc"
  }, item.kind === 'song' ? /*#__PURE__*/React.createElement(React.Fragment, null, item.songSnapshot.artist, " \xB7 ", item.songSnapshot.key) : item.kind === 'playlist-invite' ? /*#__PURE__*/React.createElement(React.Fragment, null, item.songCount, " songs \xB7 collaborate live") : /*#__PURE__*/React.createElement(React.Fragment, null, item.songCount, " songs \xB7 playlist copy"), item.note && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 8,
      fontStyle: 'italic'
    }
  }, "\u201C", item.note, "\u201D"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "ib-time"
  }, relTime(item.time)), item.kind === 'song' && item.matchSongId ? /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    size: "sm",
    onClick: () => onAct('open')
  }, "Review") : /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    size: "sm",
    onClick: () => onAct('add')
  }, item.kind === 'playlist-invite' ? 'Join' : item.kind === 'playlist' ? 'Add playlist' : 'Add to library'), /*#__PURE__*/React.createElement(IconBtn, {
    icon: "close",
    label: "Dismiss",
    onClick: () => onAct('dismiss')
  })));
}
function ConflictDialog({
  item,
  onClose,
  store
}) {
  if (!item || item.kind !== 'song') return null;
  const from = window.IT.USERS.find(u => u.id === item.fromUserId);
  const existing = store.songs.find(s => s.id === item.matchSongId);
  const toast = useToast();
  const incoming = item.songSnapshot;
  return /*#__PURE__*/React.createElement(Dialog, {
    open: true,
    onClose: onClose,
    wide: true
  }, /*#__PURE__*/React.createElement("div", {
    className: "dialog-title"
  }, "Replace your copy of \u201C", incoming.title, "\u201D?"), /*#__PURE__*/React.createElement("div", {
    className: "dialog-desc"
  }, from.name, " sent you an update. You already have a copy in your library."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12,
      marginTop: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      padding: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-small",
    style: {
      color: 'var(--muted-foreground)',
      marginBottom: 6
    }
  }, "Your copy"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 600,
      fontSize: 14
    }
  }, existing?.title || 'Original'), /*#__PURE__*/React.createElement("div", {
    className: "t-muted",
    style: {
      marginTop: 6
    }
  }, "Key ", existing?.key, " \xB7 Capo ", existing?.capo || 0, " \xB7 ", relTime(existing?.updatedAt))), /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      padding: 14,
      borderColor: 'var(--primary)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-small",
    style: {
      color: 'var(--primary)',
      marginBottom: 6
    }
  }, "Incoming update"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 600,
      fontSize: 14
    }
  }, incoming.title), /*#__PURE__*/React.createElement("div", {
    className: "t-muted",
    style: {
      marginTop: 6
    }
  }, "Key ", incoming.key, " \xB7 Capo ", incoming.capo || 0, " \xB7 From ", from.name))), /*#__PURE__*/React.createElement("div", {
    className: "dialog-footer",
    style: {
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "ghost",
    onClick: onClose
  }, "Cancel"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    onClick: () => {
      store.replaceWithIncoming(item);
      onClose();
      toast({
        title: 'Replaced with incoming',
        desc: incoming.title
      });
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "refresh",
    size: 14
  }), " Replace"))));
}

// ===========================================================================
// SETTINGS
// ===========================================================================
function SettingsScreen({
  store,
  tweaks,
  setTweak
}) {
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
    toast({
      title: 'Server updated',
      desc: 'Signing out…',
      icon: 'check'
    });
    setTimeout(() => store.logout(), 500);
  }
  async function handleExportAll() {
    try {
      const n = await store.exportLibrary();
      toast({
        title: `Exported ${n} song${n === 1 ? '' : 's'}`,
        icon: 'download'
      });
    } catch (e) {
      toast({
        title: 'Export failed',
        desc: e.message,
        tone: 'destructive'
      });
    }
  }
  async function handleImport() {
    try {
      const r = await store.importFromFile();
      if (!r) return; // picker cancelled
      if (r.kind === 'playlist') {
        toast({
          title: 'Playlist imported',
          desc: r.playlist.name,
          icon: 'check'
        });
      } else {
        toast({
          title: `Imported ${r.count} song${r.count === 1 ? '' : 's'}`,
          icon: 'check'
        });
      }
    } catch (e) {
      toast({
        title: 'Import failed',
        desc: e.message,
        tone: 'destructive'
      });
    }
  }

  // Device-only app-wide edge gaps. Same store as the song-view ⋮ overlay; both
  // open the shared SpacingPopup.
  const gaps = tweaks.gaps || {
    top: 0,
    bottom: 0
  };
  const [spacingOpen, setSpacingOpen] = useStateS(false);
  return /*#__PURE__*/React.createElement("div", {
    className: "page",
    style: {
      maxWidth: 720
    }
  }, /*#__PURE__*/React.createElement("h2", {
    className: "section-headline"
  }, "Settings"), /*#__PURE__*/React.createElement("div", {
    className: "section-sub"
  }, "Tune your chords experience."), /*#__PURE__*/React.createElement("div", {
    className: "settings-section"
  }, /*#__PURE__*/React.createElement("h2", null, "Account"), /*#__PURE__*/React.createElement("div", {
    className: "settings-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: `av ${meAv.color}`,
    style: {
      width: 44,
      height: 44,
      borderRadius: 9999,
      display: 'grid',
      placeItems: 'center',
      color: '#fff',
      fontWeight: 600,
      flex: '0 0 44px'
    }
  }, meAv.initials), /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row-title"
  }, me.name, me.isAdmin && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 8
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "outline"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "shield",
    size: 10
  }), " Admin"))), /*#__PURE__*/React.createElement("div", {
    className: "row-desc"
  }, "@", me.handle, " \xB7 ", me.email)), /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    size: "sm",
    onClick: () => setEditOpen(true)
  }, "Edit")), isBootstrapAdmin ? /*#__PURE__*/React.createElement("div", {
    className: "settings-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row-title"
  }, "Passcode"), /*#__PURE__*/React.createElement("div", {
    className: "row-desc"
  }, "Managed in ", /*#__PURE__*/React.createElement("span", {
    className: "kbd"
  }, "chords-data/secrets.json"), ". Edit that file to rotate it."))) : /*#__PURE__*/React.createElement("div", {
    className: "settings-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row-title"
  }, "Password"), /*#__PURE__*/React.createElement("div", {
    className: "row-desc"
  }, "Change the password used to sign in.")), /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    size: "sm",
    onClick: () => setPwOpen(true)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "lock",
    size: 14
  }), " Change password"))), /*#__PURE__*/React.createElement(EditAccountDialog, {
    open: editOpen,
    onClose: () => setEditOpen(false),
    store: store
  }), /*#__PURE__*/React.createElement(ChangePasswordDialog, {
    open: pwOpen,
    onClose: () => setPwOpen(false),
    store: store
  }), me.isAdmin && /*#__PURE__*/React.createElement(AdminSection, {
    store: store
  }), window.IT.isNative() && /*#__PURE__*/React.createElement("div", {
    className: "settings-section"
  }, /*#__PURE__*/React.createElement("h2", null, "Connection"), /*#__PURE__*/React.createElement("div", {
    className: "settings-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row-title"
  }, "Server"), /*#__PURE__*/React.createElement("div", {
    className: "row-desc"
  }, "The chords backend this app connects to. Changing it signs you out."), /*#__PURE__*/React.createElement("input", {
    className: "input",
    style: {
      marginTop: 8,
      maxWidth: 360
    },
    value: serverEdit,
    onChange: e => setServerEdit(e.target.value),
    placeholder: "https://your-chords-server",
    autoComplete: "off",
    autoCapitalize: "none",
    autoCorrect: "off",
    spellCheck: false
  })), /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    size: "sm",
    onClick: saveServer
  }, "Save"))), /*#__PURE__*/React.createElement("div", {
    className: "settings-section"
  }, /*#__PURE__*/React.createElement("h2", null, "Appearance"), /*#__PURE__*/React.createElement("div", {
    className: "settings-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row-title"
  }, "Theme mode"), /*#__PURE__*/React.createElement("div", {
    className: "row-desc"
  }, "Stage-friendly dark mode by default.")), /*#__PURE__*/React.createElement("div", {
    className: "tabs-list"
  }, /*#__PURE__*/React.createElement("button", {
    className: `tab-trigger ${tweaks.mode === 'light' ? 'active' : ''}`,
    onClick: () => setTweak('mode', 'light')
  }, "Light"), /*#__PURE__*/React.createElement("button", {
    className: `tab-trigger ${tweaks.mode === 'dark' ? 'active' : ''}`,
    onClick: () => setTweak('mode', 'dark')
  }, "Dark"))), /*#__PURE__*/React.createElement("div", {
    className: "settings-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row-title"
  }, "Chord color"), /*#__PURE__*/React.createElement("div", {
    className: "row-desc"
  }, "Chords over lyrics in the brand orange, or neutral grey for better visibility.")), /*#__PURE__*/React.createElement("div", {
    className: "tabs-list"
  }, /*#__PURE__*/React.createElement("button", {
    className: `tab-trigger ${(tweaks.chordColor || 'orange') === 'orange' ? 'active' : ''}`,
    onClick: () => setTweak('chordColor', 'orange')
  }, "Orange"), /*#__PURE__*/React.createElement("button", {
    className: `tab-trigger ${tweaks.chordColor === 'grey' ? 'active' : ''}`,
    onClick: () => setTweak('chordColor', 'grey')
  }, "Grey")))), /*#__PURE__*/React.createElement("div", {
    className: "settings-section"
  }, /*#__PURE__*/React.createElement("h2", null, "Performance"), /*#__PURE__*/React.createElement("div", {
    className: "settings-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row-title"
  }, "Keep screen awake on song view"), /*#__PURE__*/React.createElement("div", {
    className: "row-desc"
  }, "Prevents your device from sleeping mid-song.")), /*#__PURE__*/React.createElement(Switch, {
    on: tweaks.keepAwake,
    onChange: v => setTweak('keepAwake', v)
  })), /*#__PURE__*/React.createElement("div", {
    className: "settings-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row-title"
  }, "Playback bar at top"), /*#__PURE__*/React.createElement("div", {
    className: "row-desc"
  }, "Show the autoscroll controls at the top of the song view instead of the bottom.")), /*#__PURE__*/React.createElement(Switch, {
    on: tweaks.barAtTop,
    onChange: v => setTweak('barAtTop', v)
  })), /*#__PURE__*/React.createElement("div", {
    className: "settings-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row-title"
  }, "Metronome count-in"), /*#__PURE__*/React.createElement("div", {
    className: "row-desc"
  }, "Flash the playback bar at the song's tempo (BPM) before autoscroll starts.")), /*#__PURE__*/React.createElement(Switch, {
    on: tweaks.metronome,
    onChange: v => setTweak('metronome', v)
  })), tweaks.metronome && /*#__PURE__*/React.createElement("div", {
    className: "settings-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row-title"
  }, "Count-in beats"), /*#__PURE__*/React.createElement("div", {
    className: "row-desc"
  }, "How many beats to flash before scrolling begins.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    size: "sm",
    disabled: (tweaks.metronomeBeats || 4) <= 1,
    onClick: () => setTweak('metronomeBeats', Math.max(1, (tweaks.metronomeBeats || 4) - 1))
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "minus",
    size: 14
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 20,
      textAlign: 'center',
      fontFamily: 'var(--font-mono)',
      fontWeight: 600,
      fontSize: 15
    }
  }, tweaks.metronomeBeats || 4), /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    size: "sm",
    disabled: (tweaks.metronomeBeats || 4) >= 16,
    onClick: () => setTweak('metronomeBeats', Math.min(16, (tweaks.metronomeBeats || 4) + 1))
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 14
  }))))), /*#__PURE__*/React.createElement("div", {
    className: "settings-section"
  }, /*#__PURE__*/React.createElement("h2", null, "Display"), /*#__PURE__*/React.createElement("div", {
    className: "settings-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row-title"
  }, "Edge spacing"), /*#__PURE__*/React.createElement("div", {
    className: "row-desc"
  }, "Add empty space at the top and bottom of every screen \u2014 handy to clear device edges, notches, or system bars. Saved on this device only; also tunable live from the \u22EE menu while viewing a song.")), /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    size: "sm",
    onClick: () => setSpacingOpen(true)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "spacing",
    size: 14
  }), " ", gaps.top || 0, "/", gaps.bottom || 0, " \xB7 Adjust"))), /*#__PURE__*/React.createElement(SpacingPopup, {
    open: spacingOpen,
    onClose: () => setSpacingOpen(false),
    gaps: gaps,
    setGaps: g => setTweak('gaps', g)
  }), /*#__PURE__*/React.createElement("div", {
    className: "settings-section"
  }, /*#__PURE__*/React.createElement("h2", null, "Import & export"), /*#__PURE__*/React.createElement("div", {
    className: "settings-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row-title"
  }, "Export library"), /*#__PURE__*/React.createElement("div", {
    className: "row-desc"
  }, "Download all your library songs as a JSON file.")), /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    size: "sm",
    onClick: handleExportAll
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "download",
    size: 14
  }), " Export")), /*#__PURE__*/React.createElement("div", {
    className: "settings-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row-title"
  }, "Import from file"), /*#__PURE__*/React.createElement("div", {
    className: "row-desc"
  }, "Load songs or a playlist from a chords JSON export.")), /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    size: "sm",
    onClick: handleImport
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "upload",
    size: 14
  }), " Import"))));
}

// ===========================================================================
// EDITOR
// ===========================================================================
function EditorScreen({
  song,
  store,
  onCancel,
  onSaved
}) {
  // The editor is for writing/editing a song by hand. Web/text/image imports
  // live in their own top-level "Import" section.
  const [draft, setDraft] = useStateS(song ? {
    title: song.title,
    artist: song.artist,
    key: song.key,
    capo: song.capo,
    tempo: song.tempo,
    tags: song.tags.join(', '),
    body: song.body
  } : {
    title: '',
    artist: '',
    key: 'C',
    capo: 0,
    tempo: 90,
    tags: '',
    body: ''
  });
  const toast = useToast();
  const isPlaylistVersion = !!(song && song.playlistId);
  const playlist = isPlaylistVersion ? store.playlists.find(p => p.id === song.playlistId) : null;
  const collabs = playlist ? playlist.collaborators.map(id => window.IT.USERS.find(u => u.id === id)).filter(Boolean) : [];
  function save() {
    const tags = draft.tags.split(',').map(t => t.trim()).filter(Boolean);
    if (song) {
      store.saveEdit(song.id, {
        ...draft,
        tags
      });
      if (isPlaylistVersion && playlist) {
        toast({
          title: 'Updated for everyone',
          desc: `${draft.title} · ${collabs.length} ${collabs.length === 1 ? 'collaborator' : 'collaborators'}`,
          icon: 'users'
        });
      } else {
        toast({
          title: 'Saved',
          desc: draft.title
        });
      }
    } else {
      store.createSong({
        ...draft,
        tags
      });
      toast({
        title: 'Added to library',
        desc: draft.title
      });
    }
    onSaved && onSaved();
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "page",
    style: {
      maxWidth: 1100
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 18,
      gap: 12,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    className: "section-headline"
  }, song ? `Editing — ${song.title}` : 'Add song'), /*#__PURE__*/React.createElement("div", {
    className: "section-sub"
  }, song ? 'Edit song details and lyrics.' : 'Write the chords and lyrics for your new song.')), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "ghost",
    onClick: onCancel
  }, "Cancel"), /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    onClick: save
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 14
  }), " ", song ? 'Save changes' : 'Add to library'))), isPlaylistVersion && playlist && /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      marginBottom: 18,
      padding: 14,
      background: 'color-mix(in oklab, var(--primary) 10%, var(--card))',
      borderColor: 'var(--primary)',
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "users",
    size: 18
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 600,
      fontSize: 14
    }
  }, "This copy belongs to \u201C", playlist.name, "\u201D"), /*#__PURE__*/React.createElement("div", {
    className: "t-muted",
    style: {
      marginTop: 2
    }
  }, playlist.shared ? `Saving updates this copy for ${collabs.length} ${collabs.length === 1 ? 'collaborator' : 'collaborators'}.` : 'Saving updates this copy in the playlist.')), playlist.shared && /*#__PURE__*/React.createElement("div", {
    className: "collab-avatars"
  }, collabs.slice(0, 4).map(u => /*#__PURE__*/React.createElement("span", {
    key: u.id,
    className: `av ${u.color}`,
    title: u.name
  }, u.initials)))), /*#__PURE__*/React.createElement("div", {
    className: "editor-grid"
  }, /*#__PURE__*/React.createElement("div", {
    className: "editor-pane"
  }, /*#__PURE__*/React.createElement("div", {
    className: "field-row"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Title"), /*#__PURE__*/React.createElement(Input, {
    value: draft.title,
    onChange: e => setDraft({
      ...draft,
      title: e.target.value
    }),
    placeholder: "Song title"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Artist"), /*#__PURE__*/React.createElement(Input, {
    value: draft.artist,
    onChange: e => setDraft({
      ...draft,
      artist: e.target.value
    }),
    placeholder: "Artist"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "field-row"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Key"), /*#__PURE__*/React.createElement(Input, {
    value: draft.key,
    onChange: e => setDraft({
      ...draft,
      key: e.target.value
    }),
    placeholder: "C, Am, F#..."
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Capo"), /*#__PURE__*/React.createElement(Input, {
    type: "number",
    min: "0",
    max: "11",
    value: draft.capo,
    onChange: e => setDraft({
      ...draft,
      capo: +e.target.value
    })
  }))), /*#__PURE__*/React.createElement("div", {
    className: "field-row"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Tempo (bpm)"), /*#__PURE__*/React.createElement(Input, {
    type: "number",
    min: "40",
    max: "240",
    value: draft.tempo,
    onChange: e => setDraft({
      ...draft,
      tempo: +e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", null)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Tags ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--muted-foreground)',
      fontWeight: 400
    }
  }, "(comma separated)")), /*#__PURE__*/React.createElement(Input, {
    value: draft.tags,
    onChange: e => setDraft({
      ...draft,
      tags: e.target.value
    }),
    placeholder: "Acoustic, Setlist, Wedding"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Body"), /*#__PURE__*/React.createElement("textarea", {
    className: "textarea",
    rows: "18",
    value: draft.body,
    onChange: e => setDraft({
      ...draft,
      body: e.target.value
    }),
    placeholder: "{Verse}\n[C]Wrap chords in [Am]brackets [F]before the [G]syllable"
  }), /*#__PURE__*/React.createElement("div", {
    className: "helper"
  }, "Use ", /*#__PURE__*/React.createElement("span", {
    className: "kbd"
  }, "[Chord]"), " brackets before syllables \xB7 ", /*#__PURE__*/React.createElement("span", {
    className: "kbd"
  }, "{Section}"), " tags mark verse / chorus / bridge."))), /*#__PURE__*/React.createElement("div", {
    className: "editor-pane"
  }, /*#__PURE__*/React.createElement("h3", null, "Live preview"), /*#__PURE__*/React.createElement("div", {
    className: "preview-area"
  }, /*#__PURE__*/React.createElement(SongBody, {
    body: draft.body || '{Verse}\n[C]Type below to see your song...',
    lyricSize: 15
  })))));
}

// ===========================================================================
// SHARE / ADD-TO-PLAYLIST
// ===========================================================================
function ShareSongDialog({
  open,
  song,
  store,
  onClose
}) {
  const [selected, setSelected] = useStateS(new Set());
  const toast = useToast();
  if (!song) return null;
  const friends = window.IT.USERS.filter(u => !u.me);
  function toggle(id) {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  }
  function send() {
    store.shareSong(song, Array.from(selected));
    toast({
      title: 'Song shared',
      desc: `${song.title} → ${selected.size} ${selected.size === 1 ? 'friend' : 'friends'}`
    });
    setSelected(new Set());
    onClose();
  }
  return /*#__PURE__*/React.createElement(Dialog, {
    open: open,
    onClose: onClose,
    wide: true
  }, /*#__PURE__*/React.createElement("div", {
    className: "dialog-title"
  }, "Share \u201C", song.title, "\u201D"), /*#__PURE__*/React.createElement("div", {
    className: "dialog-desc"
  }, "Sends a copy of the main version. Recipients can edit their copy independently."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "To"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6
    }
  }, friends.map(u => /*#__PURE__*/React.createElement("button", {
    key: u.id,
    className: `tag-chip ${selected.has(u.id) ? 'on' : ''}`,
    onClick: () => toggle(u.id)
  }, /*#__PURE__*/React.createElement("span", {
    className: `av ${u.color}`,
    style: {
      width: 18,
      height: 18,
      fontSize: 9,
      borderRadius: 9999,
      display: 'inline-grid',
      placeItems: 'center',
      color: '#fff',
      fontWeight: 600
    }
  }, u.initials), u.name)))), /*#__PURE__*/React.createElement("div", {
    className: "dialog-footer"
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    onClick: onClose
  }, "Cancel"), /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    disabled: selected.size === 0,
    onClick: send
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "send",
    size: 14
  }), " Send to ", selected.size || 0)));
}
function SharePlaylistDialog({
  open,
  playlist,
  store,
  onClose
}) {
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
  useEffectS(() => {
    setSelected(new Set());
  }, [mode]);
  if (!playlist) return null;
  const friends = window.IT.USERS.filter(u => !u.me);
  function toggle(id) {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  }
  function submit() {
    if (mode === 'copy') {
      store.sharePlaylist(playlist, Array.from(selected));
      toast({
        title: 'Playlist shared',
        desc: `${playlist.name} → ${selected.size} ${selected.size === 1 ? 'friend' : 'friends'}`
      });
    } else {
      store.sharePlaylistShared(playlist, Array.from(selected));
      toast({
        title: 'Invites sent',
        desc: `${playlist.name} → ${selected.size} ${selected.size === 1 ? 'person' : 'people'}`
      });
    }
    setSelected(new Set());
    onClose();
  }
  const modes = [{
    id: 'copy',
    label: 'Send a copy',
    desc: 'Lands in their inbox to accept; they get an independent copy.'
  }, {
    id: 'shared',
    label: 'Shared',
    desc: 'Sends an invite; accepting joins the same playlist to edit live.'
  }];
  return /*#__PURE__*/React.createElement(Dialog, {
    open: open,
    onClose: onClose,
    wide: true
  }, /*#__PURE__*/React.createElement("div", {
    className: "dialog-title"
  }, "Share \u201C", playlist.name, "\u201D"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 8,
      marginTop: 12
    }
  }, modes.map(m => /*#__PURE__*/React.createElement("button", {
    key: m.id,
    type: "button",
    onClick: () => setMode(m.id),
    style: {
      textAlign: 'left',
      cursor: 'pointer',
      border: '1px solid',
      borderColor: mode === m.id ? 'var(--primary)' : 'var(--border)',
      background: mode === m.id ? 'color-mix(in oklab, var(--primary) 10%, var(--card))' : 'var(--card)',
      color: 'var(--foreground)',
      borderRadius: 'var(--radius)',
      padding: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 600,
      fontSize: 13
    }
  }, m.label), /*#__PURE__*/React.createElement("div", {
    className: "t-muted",
    style: {
      marginTop: 2,
      fontSize: 11
    }
  }, m.desc)))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, mode === 'copy' ? 'To' : 'Invite'), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6
    }
  }, friends.map(u => /*#__PURE__*/React.createElement("button", {
    key: u.id,
    className: `tag-chip ${selected.has(u.id) ? 'on' : ''}`,
    onClick: () => toggle(u.id)
  }, /*#__PURE__*/React.createElement("span", {
    className: `av ${u.color}`,
    style: {
      width: 18,
      height: 18,
      fontSize: 9,
      borderRadius: 9999,
      display: 'inline-grid',
      placeItems: 'center',
      color: '#fff',
      fontWeight: 600
    }
  }, u.initials), u.name)))), /*#__PURE__*/React.createElement("div", {
    className: "dialog-footer"
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    onClick: onClose
  }, "Cancel"), mode === 'copy' ? /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    disabled: selected.size === 0,
    onClick: submit
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "send",
    size: 14
  }), " Send to ", selected.size || 0) : /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    disabled: selected.size === 0,
    onClick: submit
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "users",
    size: 14
  }), " Invite ", selected.size || 0)));
}
function AddToPlaylistDialog({
  open,
  song,
  store,
  onClose
}) {
  const [playlistId, setPlaylistId] = useStateS(null);
  const [busy, setBusy] = useStateS(false);
  const toast = useToast();
  useEffectS(() => {
    if (open) {
      setPlaylistId(null);
      setBusy(false);
    }
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
        icon: 'list'
      });
      onClose();
    } catch (e) {
      toast({
        title: "Couldn't add to playlist",
        desc: e.message || String(e),
        tone: 'destructive'
      });
      setBusy(false);
    }
  }
  const selectedPl = playlists.find(p => p.id === playlistId);
  return /*#__PURE__*/React.createElement(Dialog, {
    open: open,
    onClose: onClose,
    wide: true
  }, /*#__PURE__*/React.createElement("div", {
    className: "dialog-title"
  }, "Add \u201C", song.title, "\u201D to a playlist"), /*#__PURE__*/React.createElement("div", {
    className: "dialog-desc"
  }, "The playlist gets its own independent copy of the song \u2014 editing it there won\u2019t change your library version."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Playlist"), playlists.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "t-muted",
    style: {
      padding: 12,
      border: '1px dashed var(--border)',
      borderRadius: 'var(--radius)'
    }
  }, "You don\u2019t have any playlists yet.") : /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      maxHeight: 240,
      overflowY: 'auto',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: 4
    }
  }, playlists.map(p => /*#__PURE__*/React.createElement("button", {
    key: p.id,
    className: "menu-item",
    style: {
      background: playlistId === p.id ? 'var(--accent)' : 'transparent',
      border: 0,
      textAlign: 'left',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: 10
    },
    onClick: () => setPlaylistId(p.id)
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 13
    }
  }, p.name), p.shared && /*#__PURE__*/React.createElement(Badge, {
    variant: "outline",
    className: ""
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "users",
    size: 10
  })), /*#__PURE__*/React.createElement("span", {
    className: "t-muted",
    style: {
      fontSize: 11
    }
  }, p.entries.length))))), selectedPl && selectedPl.shared && /*#__PURE__*/React.createElement("div", {
    className: "helper",
    style: {
      marginTop: 12,
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "users",
    size: 12
  }), " This is a shared playlist. Edits to the copy will sync to ", selectedPl.collaborators.length, " collaborators."), /*#__PURE__*/React.createElement("div", {
    className: "dialog-footer"
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    onClick: onClose
  }, "Cancel"), /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    disabled: !playlistId || busy,
    onClick: add
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 14
  }), " ", busy ? 'Adding…' : 'Add to playlist')));
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
function ColorPicker({
  value,
  onChange
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, AVATAR_COLORS.map(c => /*#__PURE__*/React.createElement("button", {
    key: c,
    type: "button",
    onClick: () => onChange(c),
    className: `av ${c}`,
    style: {
      width: 32,
      height: 32,
      borderRadius: 9999,
      border: value === c ? '2px solid var(--foreground)' : '2px solid transparent',
      cursor: 'pointer',
      display: 'grid',
      placeItems: 'center',
      color: '#fff',
      fontWeight: 600,
      fontSize: 11
    },
    "aria-label": c
  }, value === c && /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 14
  }))));
}
function EditAccountDialog({
  open,
  onClose,
  store
}) {
  const me = store.currentUser;
  const isBootstrapAdmin = me.handle === 'admin';
  const [form, setForm] = useStateS({
    name: me.name,
    handle: me.handle,
    email: me.email,
    color: me.color,
    initials: me.initials
  });
  const [busy, setBusy] = useStateS(false);
  const [error, setError] = useStateS('');
  const toast = useToast();
  useEffectS(() => {
    if (open) {
      setForm({
        name: me.name,
        handle: me.handle,
        email: me.email,
        color: me.color,
        initials: me.initials
      });
      setError('');
    }
  }, [open, me]);
  async function save() {
    setBusy(true);
    setError('');
    try {
      await store.updateMe(form);
      toast({
        title: 'Profile updated',
        desc: form.name
      });
      onClose();
    } catch (e) {
      setError(e.message || 'Could not update profile');
    } finally {
      setBusy(false);
    }
  }
  return /*#__PURE__*/React.createElement(Dialog, {
    open: open,
    onClose: onClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "dialog-title"
  }, "Edit profile"), /*#__PURE__*/React.createElement("div", {
    className: "dialog-desc"
  }, "Your name, handle, and avatar."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Name"), /*#__PURE__*/React.createElement(Input, {
    value: form.name,
    onChange: e => {
      const name = e.target.value;
      setForm(f => ({
        ...f,
        name,
        initials: f.initials === deriveInitials(f.name) ? deriveInitials(name) : f.initials
      }));
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Handle"), /*#__PURE__*/React.createElement(Input, {
    value: form.handle,
    onChange: e => setForm(f => ({
      ...f,
      handle: e.target.value.replace(/^@/, '')
    })),
    placeholder: "handle",
    disabled: isBootstrapAdmin
  }), isBootstrapAdmin && /*#__PURE__*/React.createElement("div", {
    className: "helper"
  }, "The admin handle is fixed.")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Email"), /*#__PURE__*/React.createElement(Input, {
    value: form.email,
    onChange: e => setForm(f => ({
      ...f,
      email: e.target.value
    }))
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 80px',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Avatar color"), /*#__PURE__*/React.createElement(ColorPicker, {
    value: form.color,
    onChange: c => setForm(f => ({
      ...f,
      color: c
    }))
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Initials"), /*#__PURE__*/React.createElement(Input, {
    value: form.initials,
    maxLength: 3,
    onChange: e => setForm(f => ({
      ...f,
      initials: e.target.value.toUpperCase()
    }))
  })))), error && /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--destructive)',
      fontSize: 13,
      marginTop: 10
    }
  }, error), /*#__PURE__*/React.createElement("div", {
    className: "dialog-footer"
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    onClick: onClose,
    disabled: busy
  }, "Cancel"), /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    onClick: save,
    disabled: busy || !form.name.trim() || !form.handle.trim() || !form.email.trim()
  }, busy ? 'Saving…' : 'Save changes')));
}
function ChangePasswordDialog({
  open,
  onClose,
  store
}) {
  const [currentPassword, setCurrentPassword] = useStateS('');
  const [newPassword, setNewPassword] = useStateS('');
  const [confirm, setConfirm] = useStateS('');
  const [busy, setBusy] = useStateS(false);
  const [error, setError] = useStateS('');
  const toast = useToast();
  useEffectS(() => {
    if (open) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      setError('');
    }
  }, [open]);
  async function submit() {
    if (newPassword !== confirm) {
      setError('New passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await store.changePassword(currentPassword, newPassword);
      toast({
        title: 'Password changed'
      });
      onClose();
    } catch (e) {
      setError(e.message || 'Could not change password');
    } finally {
      setBusy(false);
    }
  }
  return /*#__PURE__*/React.createElement(Dialog, {
    open: open,
    onClose: onClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "dialog-title"
  }, "Change password"), /*#__PURE__*/React.createElement("div", {
    className: "dialog-desc"
  }, "Enter your current password, then choose a new one."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Current password"), /*#__PURE__*/React.createElement(Input, {
    type: "password",
    value: currentPassword,
    onChange: e => setCurrentPassword(e.target.value),
    autoComplete: "current-password"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "New password"), /*#__PURE__*/React.createElement(Input, {
    type: "password",
    value: newPassword,
    onChange: e => setNewPassword(e.target.value),
    autoComplete: "new-password"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Confirm new password"), /*#__PURE__*/React.createElement(Input, {
    type: "password",
    value: confirm,
    onChange: e => setConfirm(e.target.value),
    autoComplete: "new-password"
  }))), error && /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--destructive)',
      fontSize: 13,
      marginTop: 10
    }
  }, error), /*#__PURE__*/React.createElement("div", {
    className: "dialog-footer"
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    onClick: onClose,
    disabled: busy
  }, "Cancel"), /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    onClick: submit,
    disabled: busy || !currentPassword || !newPassword || !confirm
  }, busy ? 'Saving…' : 'Change password')));
}
function AdminSection({
  store
}) {
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
      await window.IT.api(`/invites/${id}`, {
        method: 'DELETE'
      });
      toast({
        title: 'Invite revoked'
      });
      loadInvites();
    } catch (e) {
      toast({
        title: 'Error',
        desc: e.message,
        icon: 'alertTriangle'
      });
    }
  }
  function copyLink(url) {
    navigator.clipboard.writeText(url);
    toast({
      title: 'Link copied',
      icon: 'check'
    });
  }
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "settings-section"
  }, /*#__PURE__*/React.createElement("h2", null, /*#__PURE__*/React.createElement(Icon, {
    name: "shield",
    size: 14
  }), " Admin \xB7 Users"), /*#__PURE__*/React.createElement("div", {
    className: "section-sub",
    style: {
      marginBottom: 12
    }
  }, "List of all registered users. New users must register via an invite link."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, allUsers.map(u => /*#__PURE__*/React.createElement("div", {
    key: u.id,
    className: "settings-row",
    style: {
      padding: '8px 12px',
      borderRadius: 'var(--radius-sm)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: `av ${u.color}`,
    style: {
      width: 32,
      height: 32,
      borderRadius: 9999,
      display: 'grid',
      placeItems: 'center',
      color: '#fff',
      fontWeight: 600,
      flex: '0 0 32px',
      fontSize: 12
    }
  }, u.initials), /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row-title",
    style: {
      fontSize: 14
    }
  }, u.name, u.me && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 6,
      color: 'var(--muted-foreground)',
      fontSize: 12
    }
  }, "(you)")), /*#__PURE__*/React.createElement("div", {
    className: "row-desc"
  }, u.handle)), u.isAdmin && /*#__PURE__*/React.createElement(Badge, {
    variant: "outline"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "shield",
    size: 10
  }), " Admin"))))), /*#__PURE__*/React.createElement("div", {
    className: "settings-section"
  }, /*#__PURE__*/React.createElement("h2", null, /*#__PURE__*/React.createElement(Icon, {
    name: "link",
    size: 14
  }), " Admin \xB7 Invites"), /*#__PURE__*/React.createElement("div", {
    className: "section-sub",
    style: {
      marginBottom: 12
    }
  }, "Manage invite links. Create links to allow new people to join."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      marginBottom: 12
    }
  }, invites.map(i => /*#__PURE__*/React.createElement("div", {
    key: i.id,
    className: "settings-row",
    style: {
      padding: '8px 12px',
      borderRadius: 'var(--radius-sm)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "grow",
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row-title",
    style: {
      fontSize: 14,
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-truncate"
  }, i.email || 'Open invite'), /*#__PURE__*/React.createElement(Badge, {
    variant: "outline"
  }, i.status)), i.status === 'active' && /*#__PURE__*/React.createElement("div", {
    className: "row-desc t-truncate",
    style: {
      fontFamily: 'var(--font-mono)'
    }
  }, i.url), i.status === 'used' && /*#__PURE__*/React.createElement("div", {
    className: "row-desc",
    style: {
      marginTop: 2
    }
  }, "Used by @", i.used_by_handle), i.status === 'active' && i.expires_at && /*#__PURE__*/React.createElement("div", {
    className: "row-desc",
    style: {
      marginTop: 2
    }
  }, "Expires ", new Date(i.expires_at).toLocaleDateString())), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      flexShrink: 0
    }
  }, i.status === 'active' && /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    size: "sm",
    onClick: () => copyLink(i.url)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "copy",
    size: 14
  }), " Copy"), /*#__PURE__*/React.createElement(Btn, {
    variant: "ghost",
    size: "sm",
    style: {
      color: 'var(--destructive)'
    },
    onClick: () => revokeInvite(i.id)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "trash",
    size: 14
  }))))), invites.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "t-muted",
    style: {
      padding: '12px',
      fontSize: 13,
      textAlign: 'center',
      background: 'var(--card)',
      borderRadius: 8
    }
  }, "No invites generated yet.")), /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    size: "sm",
    onClick: () => setCreateOpen(true)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 14
  }), " New invite link"), /*#__PURE__*/React.createElement(CreateInviteDialog, {
    open: createOpen,
    onClose: () => setCreateOpen(false),
    onCreated: loadInvites
  })));
}
function CreateInviteDialog({
  open,
  onClose,
  onCreated
}) {
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
    setBusy(true);
    setError('');
    try {
      const payload = {
        email: email.trim() || null,
        expires_in_days: expiresIn === 0 ? null : expiresIn
      };
      const data = await window.IT.api('/invites', {
        method: 'POST',
        body: payload
      });
      setCreatedUrl(data.url);
      onCreated();
    } catch (e) {
      setError(e.message || 'Could not create invite');
    } finally {
      setBusy(false);
    }
  }
  function copyLink() {
    navigator.clipboard.writeText(createdUrl);
    toast({
      title: 'Link copied',
      icon: 'check'
    });
    onClose();
  }
  if (createdUrl) {
    return /*#__PURE__*/React.createElement(Dialog, {
      open: open,
      onClose: onClose
    }, /*#__PURE__*/React.createElement("div", {
      className: "dialog-title"
    }, "Invite link created"), /*#__PURE__*/React.createElement("div", {
      className: "dialog-desc"
    }, "Share this link with the new user."), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 16,
        padding: 12,
        background: 'var(--background)',
        borderRadius: 8,
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        wordBreak: 'break-all'
      }
    }, createdUrl), /*#__PURE__*/React.createElement("div", {
      className: "dialog-footer",
      style: {
        marginTop: 24
      }
    }, /*#__PURE__*/React.createElement(Btn, {
      variant: "outline",
      onClick: onClose
    }, "Close"), /*#__PURE__*/React.createElement(Btn, {
      variant: "primary",
      onClick: copyLink
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "copy",
      size: 14
    }), " Copy link")));
  }
  return /*#__PURE__*/React.createElement(Dialog, {
    open: open,
    onClose: onClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "dialog-title"
  }, "Generate invite link"), /*#__PURE__*/React.createElement("div", {
    className: "dialog-desc"
  }, "Create a secure link for a new user to sign up."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Email (optional)"), /*#__PURE__*/React.createElement(Input, {
    type: "email",
    value: email,
    onChange: e => setEmail(e.target.value),
    placeholder: "If set, only this email can be used"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Expires in"), /*#__PURE__*/React.createElement("select", {
    className: "input",
    value: expiresIn,
    onChange: e => setExpiresIn(Number(e.target.value))
  }, /*#__PURE__*/React.createElement("option", {
    value: 1
  }, "1 day"), /*#__PURE__*/React.createElement("option", {
    value: 7
  }, "7 days"), /*#__PURE__*/React.createElement("option", {
    value: 30
  }, "30 days"), /*#__PURE__*/React.createElement("option", {
    value: 0
  }, "Never")))), error && /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--destructive)',
      fontSize: 13,
      marginTop: 10
    }
  }, error), /*#__PURE__*/React.createElement("div", {
    className: "dialog-footer"
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    onClick: onClose,
    disabled: busy
  }, "Cancel"), /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    onClick: submit,
    disabled: busy
  }, busy ? 'Generating…' : 'Generate link')));
}

// ===========================================================================
// RENAME PLAYLIST
// ===========================================================================

function RenamePlaylistDialog({
  open,
  playlist,
  store,
  onClose
}) {
  const [name, setName] = useStateS(playlist?.name || '');
  const [busy, setBusy] = useStateS(false);
  const toast = useToast();
  useEffectS(() => {
    if (open && playlist) setName(playlist.name);
  }, [open, playlist]);
  async function save() {
    setBusy(true);
    try {
      await store.updatePlaylist(playlist.id, {
        name: name.trim()
      });
      toast({
        title: 'Playlist renamed',
        desc: name
      });
      onClose();
    } catch (e) {
      toast({
        title: 'Could not rename',
        desc: e.message,
        tone: 'destructive'
      });
    } finally {
      setBusy(false);
    }
  }
  if (!playlist) return null;
  return /*#__PURE__*/React.createElement(Dialog, {
    open: open,
    onClose: onClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "dialog-title"
  }, "Rename playlist"), /*#__PURE__*/React.createElement("div", {
    className: "dialog-desc"
  }, "This won't affect any of the songs or their versions."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Name"), /*#__PURE__*/React.createElement(Input, {
    value: name,
    onChange: e => setName(e.target.value),
    autoFocus: true
  })), /*#__PURE__*/React.createElement("div", {
    className: "dialog-footer"
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    onClick: onClose,
    disabled: busy
  }, "Cancel"), /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    onClick: save,
    disabled: busy || !name.trim() || name.trim() === playlist.name
  }, busy ? 'Saving…' : 'Rename')));
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
function ImportScreen({
  store,
  onDone
}) {
  const [mode, setMode] = useStateS('web'); // 'web' | 'textimage'

  function applyExtracted(extracted) {
    store.createSong({
      title: extracted.title || '',
      artist: extracted.artist || '',
      key: extracted.key || 'C',
      capo: extracted.capo || 0,
      tempo: extracted.tempo || 90,
      tags: [],
      body: extracted.body || ''
    });
    onDone && onDone();
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "page",
    style: {
      maxWidth: 1100
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("h2", {
    className: "section-headline"
  }, "Import"), /*#__PURE__*/React.createElement("div", {
    className: "section-sub"
  }, mode === 'web' ? 'Paste a link to a song or playlist, or describe what you’re looking for.' : 'Paste raw chord text or upload an image, then convert it into a song.')), /*#__PURE__*/React.createElement("div", {
    className: "seg-switch"
  }, [{
    key: 'web',
    label: 'Web',
    icon: 'globe'
  }, {
    key: 'textimage',
    label: 'Text or image',
    icon: 'type'
  }].map(o => /*#__PURE__*/React.createElement("button", {
    key: o.key,
    type: "button",
    className: `seg-item${mode === o.key ? ' on' : ''}`,
    onClick: () => setMode(o.key)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: o.icon,
    size: 14
  }), " ", o.label))), /*#__PURE__*/React.createElement(ImportPanel, {
    mode: mode,
    store: store,
    onExtracted: applyExtracted,
    onPlaylistImported: onDone
  }));
}

// Comparison key for duplicate detection when importing into an existing
// playlist: title + artist, case-insensitive and whitespace-normalized.
function songKey(title, artist) {
  const n = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${n(title)} ${n(artist)}`;
}
function ImportPanel({
  onExtracted,
  store,
  onPlaylistImported,
  mode = 'web'
}) {
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
  const [image, setImage] = useStateS(null); // { dataUrl, base64, mediaType, name }
  const [viewPage, setViewPage] = useStateS(null); // loaded page shown full-screen
  const [importingUrl, setImportingUrl] = useStateS(null);
  const [progress, setProgress] = useStateS([]);
  const abortRef = useRefS(null);
  const toast = useToast();

  // Clear any prior error when switching modes (web ↔ text/image).
  useEffectS(() => {
    setError('');
    setErrorPage(null);
  }, [mode]);
  function cancelWork() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setImportingUrl(null);
    setWorking('');
    setProgress([]);
  }
  async function runStreaming(path, body, onResult, {
    keepProgress = false
  } = {}) {
    setError('');
    setErrorPage(null);
    if (!keepProgress) setProgress([]);
    const controller = new AbortController();
    abortRef.current = controller;
    let resolvedResult = null;
    let errorMsg = null;
    let errorPg = null;
    try {
      await window.IT.apiStream(path, body, evt => {
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
      setImage({
        dataUrl,
        base64,
        mediaType: file.type || 'image/png',
        name: file.name
      });
    };
    reader.onerror = () => toast({
      title: "Couldn't read that image",
      tone: 'destructive'
    });
    reader.readAsDataURL(file);
  }

  // Convert pasted text or an uploaded image into a song. Image wins if present.
  async function convertTextImage() {
    if (image) {
      setBusy(true);
      setWorking('Reading image…');
      await runStreaming('/import/extract-image', {
        imageData: image.base64,
        mediaType: image.mediaType
      }, extracted => {
        onExtracted(extracted);
        toast({
          title: 'Imported',
          desc: `${extracted.title || 'Untitled'} · ${extracted.artist || ''}`
        });
      });
      setBusy(false);
      setWorking('');
      return;
    }
    const text = pastedText.trim();
    if (!text) return;
    setBusy(true);
    setWorking('Parsing pasted text…');
    await runStreaming('/import/extract-text', {
      text,
      url: ''
    }, extracted => {
      onExtracted(extracted);
      toast({
        title: 'Imported',
        desc: `${extracted.title || 'Untitled'} · ${extracted.artist || ''}`
      });
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
    setError('');
    setErrorPage(null);
    setBusy(true);
    if (looksLikeUrl(raw)) {
      setWorking('Reading page…');
      await runStreaming('/import/auto', {
        url: normalizeUrl(raw)
      }, data => {
        if (data.kind === 'playlist') {
          const songs = data.songs || [];
          if (songs.length === 0) {
            toast({
              title: 'No songs found',
              desc: 'This looks like a collection, but no song links were detected.',
              tone: 'destructive'
            });
            return;
          }
          setPlaylist({
            url: normalizeUrl(raw),
            songs
          });
          setPlaylistName('');
          setSelected(new Set(songs.map((_, i) => i)));
          setTarget('both');
          setExistingPlaylistId(null);
          setDupMode('skip');
        } else {
          if (!data.body) {
            toast({
              title: 'Nothing to extract',
              desc: 'The page did not contain chords/lyrics we could parse.',
              tone: 'destructive'
            });
            return;
          }
          onExtracted(data);
          toast({
            title: 'Imported',
            desc: `${data.title} · ${data.artist}`
          });
        }
      });
    } else {
      setWorking('Searching the web…');
      await runStreaming('/import/search', {
        query: raw
      }, data => {
        setCandidates(data.candidates || []);
      });
    }
    setBusy(false);
    setWorking('');
  }
  async function importUrl(targetUrl) {
    setImportingUrl(targetUrl);
    setWorking('Extracting…');
    await runStreaming('/import/extract', {
      url: targetUrl
    }, extracted => {
      if (!extracted.body) {
        toast({
          title: 'Nothing to extract',
          desc: 'The page did not contain chords/lyrics we could parse.',
          tone: 'destructive'
        });
        return;
      }
      onExtracted(extracted);
      toast({
        title: 'Imported',
        desc: `${extracted.title} · ${extracted.artist}`
      });
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
      if (!dest) {
        setError('That playlist no longer exists.');
        return;
      }
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
      await runStreaming('/import/extract', {
        url: s.url
      }, d => {
        extracted = d;
      }, {
        keepProgress: true
      });
      if (extracted && extracted.body) {
        // Tags are never imported — they're added manually by editing a song.
        const payload = {
          ...extracted,
          tags: []
        };
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
    const where = target === 'library' ? 'your library' : target === 'existing' ? `“${destName}”` : target === 'playlist' ? `“${name}”` : `your library and “${name}”`;
    toast({
      title: 'Import complete',
      desc: `${added} of ${chosen.length} ${chosen.length === 1 ? 'song' : 'songs'} added to ${where}` + (skipped ? ` · ${skipped} already there, skipped` : ''),
      icon: toNewPlaylist || toExisting ? 'list' : 'check'
    });
    onPlaylistImported && onPlaylistImported();
  }
  function toggleSong(i) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);else next.add(i);
      return next;
    });
  }
  const dialogOpen = busy || !!importingUrl;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 720
    }
  }, error && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 14,
      padding: 12,
      border: '1px solid var(--destructive)',
      borderRadius: 'var(--radius-sm)',
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--destructive)',
      fontWeight: 600
    }
  }, error), errorPage && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    size: "sm",
    onClick: () => setViewPage(errorPage)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "external",
    size: 14
  }), " View loaded page"))), mode === 'textimage' ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Paste chords + lyrics"), /*#__PURE__*/React.createElement("textarea", {
    className: "input",
    value: pastedText,
    onChange: e => setPastedText(e.target.value),
    disabled: busy || !!image,
    placeholder: "Paste a chord chart here…",
    style: {
      width: '100%',
      minHeight: 180,
      resize: 'vertical',
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      opacity: image ? 0.5 : 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      margin: '12px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: 1,
      background: 'var(--border)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "t-muted",
    style: {
      fontSize: 12
    }
  }, "or upload an image"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: 1,
      background: 'var(--border)'
    }
  })), image ? /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      padding: 12,
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: image.dataUrl,
    alt: image.name,
    style: {
      width: 64,
      height: 64,
      objectFit: 'cover',
      borderRadius: 'var(--radius-sm)',
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 600,
      fontSize: 13,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, image.name), /*#__PURE__*/React.createElement("div", {
    className: "t-muted",
    style: {
      fontSize: 12
    }
  }, image.mediaType)), /*#__PURE__*/React.createElement(Btn, {
    variant: "ghost",
    size: "sm",
    disabled: busy,
    onClick: () => setImage(null)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "close",
    size: 14
  }), " Remove")) : /*#__PURE__*/React.createElement("label", {
    className: "btn btn-outline",
    style: {
      cursor: busy ? 'default' : 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "upload",
    size: 14
  }), " Choose image", /*#__PURE__*/React.createElement("input", {
    type: "file",
    accept: "image/*",
    disabled: busy,
    style: {
      display: 'none'
    },
    onChange: e => {
      onPickImage(e.target.files && e.target.files[0]);
      e.target.value = '';
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    disabled: busy || !image && !pastedText.trim(),
    onClick: convertTextImage
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 14
  }), " Convert to song"), /*#__PURE__*/React.createElement("span", {
    className: "helper",
    style: {
      margin: 0
    }
  }, image ? 'The image is read with vision and parsed into chords.' : 'Pasted text is parsed into chords. Works when a site blocks the importer.'))) : /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Input, {
    value: value,
    onChange: e => setValue(e.target.value),
    onKeyDown: e => {
      if (e.key === 'Enter') submit();
    },
    placeholder: "Paste a URL, or type e.g. \u201CWonderwall Oasis acoustic\u201D",
    disabled: busy
  }), /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    onClick: submit,
    disabled: busy || !value.trim()
  }, busy ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon, {
    name: "refresh",
    size: 14
  }), " Working\u2026") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon, {
    name: "globe",
    size: 14
  }), " Go"))), /*#__PURE__*/React.createElement("div", {
    className: "helper"
  }, "Detects automatically: a single song page, a playlist/collection, or a web search."), candidates !== null && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 18
    }
  }, candidates.length === 0 ? /*#__PURE__*/React.createElement(Empty, {
    icon: "search",
    title: "No versions found",
    desc: "Try a more specific query, or paste a URL directly."
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-muted",
    style: {
      fontSize: 12
    }
  }, candidates.length, " versions found \xB7 pick one to import"), candidates.map((c, i) => /*#__PURE__*/React.createElement(CandidateCard, {
    key: i,
    candidate: c,
    busy: importingUrl === c.url,
    disabled: !!importingUrl && importingUrl !== c.url,
    onImport: () => importUrl(c.url)
  })))), playlist && (() => {
    const selectedCount = selected.size;
    const total = playlist.songs.length;
    const toNewPlaylist = target === 'playlist' || target === 'both';
    const allSelected = selectedCount === total;
    const targetOptions = [{
      value: 'library',
      label: 'Library only',
      desc: 'Add songs to your library.'
    }, {
      value: 'playlist',
      label: 'New playlist',
      desc: 'Create a new playlist with its own copies.'
    }, {
      value: 'existing',
      label: 'Existing playlist',
      desc: 'Append to a playlist you already have.'
    }, {
      value: 'both',
      label: 'Both',
      desc: 'A library copy and a new-playlist copy.'
    }];
    // Destination + duplicate (title+artist) detection for the
    // "import into an existing playlist" path.
    const destPl = target === 'existing' && existingPlaylistId ? store.playlists.find(p => p.id === existingPlaylistId) : null;
    const destKeySet = destPl ? new Set(destPl.entries.map(e => songKey(e.song?.title, e.song?.artist))) : null;
    const dupCount = destKeySet ? playlist.songs.filter((s, i) => selected.has(i) && destKeySet.has(songKey(s.title, s.artist))).length : 0;
    return /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 18
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "t-muted",
      style: {
        fontSize: 12
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "list",
      size: 12
    }), " Playlist detected \xB7 ", total, " ", total === 1 ? 'song' : 'songs'), /*#__PURE__*/React.createElement("label", {
      className: "label",
      style: {
        marginTop: 14
      }
    }, "Import to"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 8
      }
    }, targetOptions.map(o => /*#__PURE__*/React.createElement("button", {
      key: o.value,
      type: "button",
      disabled: busy,
      onClick: () => setTarget(o.value),
      style: {
        textAlign: 'left',
        cursor: busy ? 'default' : 'pointer',
        border: '1px solid',
        borderColor: target === o.value ? 'var(--primary)' : 'var(--border)',
        background: target === o.value ? 'color-mix(in oklab, var(--primary) 10%, var(--card))' : 'var(--card)',
        color: 'var(--foreground)',
        borderRadius: 'var(--radius)',
        padding: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600,
        fontSize: 13
      }
    }, o.label), /*#__PURE__*/React.createElement("div", {
      className: "t-muted",
      style: {
        marginTop: 2,
        fontSize: 11
      }
    }, o.desc)))), toNewPlaylist && /*#__PURE__*/React.createElement("div", {
      style: {
        margin: '12px 0'
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "label"
    }, "Playlist name"), /*#__PURE__*/React.createElement(Input, {
      value: playlistName,
      onChange: e => setPlaylistName(e.target.value),
      placeholder: "Imported playlist",
      disabled: busy
    })), target === 'existing' && /*#__PURE__*/React.createElement("div", {
      style: {
        margin: '12px 0'
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "label"
    }, "Add to playlist"), store.playlists.length === 0 ? /*#__PURE__*/React.createElement("div", {
      className: "t-muted",
      style: {
        padding: 12,
        border: '1px dashed var(--border)',
        borderRadius: 'var(--radius)'
      }
    }, "You don\u2019t have any playlists yet \u2014 choose \u201CNew playlist\u201D instead.") : /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        maxHeight: 200,
        overflowY: 'auto',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: 4
      }
    }, store.playlists.map(p => /*#__PURE__*/React.createElement("button", {
      key: p.id,
      type: "button",
      className: "menu-item",
      disabled: busy,
      style: {
        background: existingPlaylistId === p.id ? 'var(--accent)' : 'transparent',
        border: 0,
        textAlign: 'left',
        cursor: busy ? 'default' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 10
      },
      onClick: () => setExistingPlaylistId(p.id)
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        fontSize: 13
      }
    }, p.name), p.shared && /*#__PURE__*/React.createElement(Badge, {
      variant: "outline"
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "users",
      size: 10
    })), /*#__PURE__*/React.createElement("span", {
      className: "t-muted",
      style: {
        fontSize: 11
      }
    }, p.entries.length))))), target === 'existing' && dupCount > 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        margin: '12px 0',
        padding: 12,
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        background: 'color-mix(in oklab, var(--primary) 6%, var(--card))'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 600
      }
    }, dupCount, " of the selected ", dupCount === 1 ? 'song is' : 'songs are', " already in \u201C", destPl.name, "\u201D"), /*#__PURE__*/React.createElement("div", {
      className: "t-muted",
      style: {
        fontSize: 12,
        margin: '2px 0 10px'
      }
    }, "Matched by title and artist \u2014 choose what to do with the duplicates:"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 8
      }
    }, [{
      value: 'skip',
      label: 'Skip duplicates',
      desc: 'Import only the songs not already there.'
    }, {
      value: 'copy',
      label: 'Add copies anyway',
      desc: 'Import everything, even duplicates.'
    }].map(o => /*#__PURE__*/React.createElement("button", {
      key: o.value,
      type: "button",
      disabled: busy,
      onClick: () => setDupMode(o.value),
      style: {
        textAlign: 'left',
        cursor: busy ? 'default' : 'pointer',
        border: '1px solid',
        borderColor: dupMode === o.value ? 'var(--primary)' : 'var(--border)',
        background: dupMode === o.value ? 'color-mix(in oklab, var(--primary) 12%, var(--card))' : 'var(--card)',
        color: 'var(--foreground)',
        borderRadius: 'var(--radius)',
        padding: 10
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600,
        fontSize: 13
      }
    }, o.label), /*#__PURE__*/React.createElement("div", {
      className: "t-muted",
      style: {
        marginTop: 2,
        fontSize: 11
      }
    }, o.desc))))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        margin: '14px 0 8px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "t-muted",
      style: {
        fontSize: 12
      }
    }, selectedCount, " of ", total, " selected"), /*#__PURE__*/React.createElement(Btn, {
      variant: "ghost",
      size: "sm",
      disabled: busy,
      onClick: () => setSelected(allSelected ? new Set() : new Set(playlist.songs.map((_, i) => i)))
    }, allSelected ? 'Deselect all' : 'Select all')), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 6
      }
    }, playlist.songs.map((s, i) => {
      const on = selected.has(i);
      return /*#__PURE__*/React.createElement("button", {
        key: i,
        type: "button",
        disabled: busy,
        onClick: () => toggleSong(i),
        className: "card",
        style: {
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          textAlign: 'left',
          cursor: busy ? 'default' : 'pointer',
          width: '100%',
          borderColor: on ? 'var(--primary)' : 'var(--border)',
          opacity: on ? 1 : 0.55
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          width: 18,
          height: 18,
          flexShrink: 0,
          borderRadius: 5,
          border: '1px solid',
          borderColor: on ? 'var(--primary)' : 'var(--border)',
          background: on ? 'var(--primary)' : 'transparent',
          color: 'var(--primary-foreground)',
          display: 'grid',
          placeItems: 'center'
        }
      }, on && /*#__PURE__*/React.createElement(Icon, {
        name: "check",
        size: 12
      })), /*#__PURE__*/React.createElement("span", {
        style: {
          fontWeight: 600,
          fontSize: 14
        }
      }, s.title || 'Untitled'), s.artist && /*#__PURE__*/React.createElement("span", {
        className: "t-muted",
        style: {
          fontSize: 12
        }
      }, "\xB7 ", s.artist));
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        marginTop: 12
      }
    }, /*#__PURE__*/React.createElement(Btn, {
      variant: "primary",
      onClick: importPlaylist,
      disabled: busy || selectedCount === 0 || target === 'existing' && !existingPlaylistId
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "download",
      size: 14
    }), " Import ", selectedCount, " ", selectedCount === 1 ? 'song' : 'songs'), /*#__PURE__*/React.createElement("span", {
      className: "helper",
      style: {
        margin: 0
      }
    }, "Each song is fetched and parsed individually \u2014 this can take a while.")));
  })()), /*#__PURE__*/React.createElement(Dialog, {
    open: dialogOpen,
    onClose: () => {},
    dismissOnBackdrop: false
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      minWidth: 0,
      overflowWrap: 'anywhere'
    }
  }, working || 'Working…'), /*#__PURE__*/React.createElement(Btn, {
    variant: "ghost",
    size: "sm",
    onClick: cancelWork
  }, "Cancel")), /*#__PURE__*/React.createElement(ProgressLog, {
    lines: progress,
    active: dialogOpen
  }))), /*#__PURE__*/React.createElement(LoadedPageView, {
    page: viewPage,
    onClose: () => setViewPage(null)
  }));
}

// Full-screen view of exactly what the headless browser loaded on a failed
// import, with the option to download the raw HTML.
function LoadedPageView({
  page,
  onClose
}) {
  if (!page) return null;
  function download() {
    const body = page.html || `<pre>${(page.text || '').replace(/[&<>]/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;'
    })[c])}</pre>`;
    const blob = new Blob([body], {
      type: 'text/html;charset=utf-8'
    });
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
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 60,
      background: 'var(--background)',
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 16px',
      borderBottom: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 600,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, page.title || 'Loaded page', page.loaded === false ? ' (failed to load fully)' : ''), page.url && /*#__PURE__*/React.createElement("div", {
    className: "t-muted",
    style: {
      fontSize: 12,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, page.url)), /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    size: "sm",
    onClick: download
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "download",
    size: 14
  }), " Download HTML"), /*#__PURE__*/React.createElement(Btn, {
    variant: "ghost",
    size: "sm",
    onClick: onClose
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "close",
    size: 14
  }), " Close")), page.html ? /*#__PURE__*/React.createElement("iframe", {
    title: "Loaded page",
    sandbox: "",
    srcDoc: page.html,
    style: {
      flex: 1,
      width: '100%',
      border: 0,
      background: '#fff'
    }
  }) : /*#__PURE__*/React.createElement("pre", {
    style: {
      flex: 1,
      margin: 0,
      overflow: 'auto',
      padding: 16,
      fontSize: 12,
      fontFamily: 'var(--font-mono)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      color: 'var(--foreground)'
    }
  }, page.text || '(the page had no readable text)'));
}
function ProgressLog({
  lines,
  active
}) {
  const ref = useRefS(null);
  useEffectS(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length]);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14,
      padding: 10,
      borderRadius: 'var(--radius-sm)',
      background: 'color-mix(in oklab, var(--primary) 6%, var(--card))',
      border: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8
    }
  }, active && /*#__PURE__*/React.createElement(Icon, {
    name: "refresh",
    size: 12,
    className: "spin"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--muted-foreground)'
    }
  }, active ? 'Working…' : 'Progress')), /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      maxHeight: 140,
      overflowY: 'auto',
      overflowX: 'hidden',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--muted-foreground)',
      display: 'flex',
      flexDirection: 'column',
      gap: 3,
      overflowWrap: 'anywhere',
      wordBreak: 'break-word'
    }
  }, lines.map((line, i) => {
    const isLast = i === lines.length - 1;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        color: isLast && active ? 'var(--foreground)' : undefined,
        opacity: isLast && active ? 1 : 0.7
      }
    }, "\xB7 ", line);
  })));
}
function CandidateCard({
  candidate,
  busy,
  disabled,
  onImport
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      padding: 12,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      opacity: disabled ? 0.45 : 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      alignItems: 'baseline',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      fontSize: 14
    }
  }, candidate.title || 'Untitled'), candidate.artist && /*#__PURE__*/React.createElement("span", {
    className: "t-muted"
  }, "\xB7 ", candidate.artist), candidate.key && /*#__PURE__*/React.createElement(Badge, {
    variant: "outline"
  }, candidate.key)), /*#__PURE__*/React.createElement("div", {
    className: "t-muted",
    style: {
      marginTop: 4,
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "external",
    size: 11
  }), " ", candidate.source || new URL(candidate.url).hostname, candidate.snippet && /*#__PURE__*/React.createElement("span", null, " \xB7 ", candidate.snippet)), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 4,
      fontSize: 11,
      color: 'var(--muted-foreground)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, candidate.url)), /*#__PURE__*/React.createElement(Btn, {
    variant: "primary",
    size: "sm",
    onClick: onImport,
    disabled: disabled || busy
  }, busy ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon, {
    name: "refresh",
    size: 12
  }), " Extracting\u2026") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon, {
    name: "download",
    size: 12
  }), " Import")));
}
Object.assign(window, {
  LibraryScreen,
  PlaylistsScreen,
  PlaylistDetail,
  InboxScreen,
  SettingsScreen,
  EditorScreen,
  ShareSongDialog,
  SharePlaylistDialog,
  AddToPlaylistDialog,
  RenamePlaylistDialog,
  ImportPanel,
  ImportScreen
});