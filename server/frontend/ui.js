// AUTO-GENERATED from ui.jsx by server/scripts/build-frontend.js — do not edit.
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Shared UI primitives — buttons, inputs, dialogs, sheets, dropdown menu, toasts.
   Exposed on window for cross-script consumption. */

const {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  createContext,
  useContext
} = React;

// ---------- buttons / icons ----------
function Btn({
  variant = 'secondary',
  size,
  className = '',
  children,
  ...rest
}) {
  const cls = ['btn', `btn-${variant}`, size ? `btn-${size}` : '', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("button", _extends({
    className: cls
  }, rest), children);
}
function IconBtn({
  icon,
  label,
  variant = 'ghost',
  size = 'sm',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    className: `btn btn-${variant} btn-icon ${size === 'sm' ? 'btn-sm' : ''}`,
    "aria-label": label,
    title: label
  }, rest), /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: size === 'sm' ? 16 : 18
  }));
}

// ---------- input ----------
function Input(props) {
  return /*#__PURE__*/React.createElement("input", _extends({
    className: "input"
  }, props));
}
function SearchInput({
  value,
  onChange,
  placeholder = 'Search...'
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "input-with-icon"
  }, /*#__PURE__*/React.createElement("span", {
    className: "leading"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 16
  })), /*#__PURE__*/React.createElement("input", {
    className: "input",
    value: value,
    placeholder: placeholder,
    onChange: e => onChange(e.target.value)
  }));
}

// ---------- badge / tag ----------
function Badge({
  variant = 'secondary',
  children,
  className = ''
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: `badge badge-${variant} ${className}`
  }, children);
}

// ---------- switch ----------
function Switch({
  on,
  onChange
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: `switch ${on ? 'on' : ''}`,
    onClick: () => onChange(!on),
    "aria-pressed": on
  });
}

// ---------- dialog ----------
function Dialog({
  open,
  onClose,
  children,
  wide,
  dismissOnBackdrop = true
}) {
  useEffect(() => {
    if (!open) return;
    const h = e => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "scrim",
    onClick: dismissOnBackdrop ? onClose : undefined
  }, /*#__PURE__*/React.createElement("div", {
    className: `dialog ${wide ? 'wide' : ''}`,
    onClick: e => e.stopPropagation()
  }, children));
}

// ---------- sheet ----------
function Sheet({
  open,
  onClose,
  children
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "scrim",
    onClick: onClose,
    style: {
      alignItems: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sheet",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "sheet-handle"
  }), children));
}

// ---------- toast ----------
const ToastCtx = createContext(null);
function ToastProvider({
  children
}) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const push = useCallback(t => {
    const id = ++idRef.current;
    setToasts(arr => [...arr, {
      id,
      ...t
    }]);
    setTimeout(() => setToasts(arr => arr.filter(x => x.id !== id)), t.duration || 3200);
  }, []);
  return /*#__PURE__*/React.createElement(ToastCtx.Provider, {
    value: push
  }, children, /*#__PURE__*/React.createElement("div", {
    className: "toast-region"
  }, toasts.map(t => /*#__PURE__*/React.createElement("div", {
    key: t.id,
    className: "toast"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: t.tone === 'destructive' ? 'var(--destructive)' : 'var(--primary)',
      marginTop: 1
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: t.icon || 'check',
    size: 16
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "title"
  }, t.title), t.desc && /*#__PURE__*/React.createElement("div", {
    className: "desc"
  }, t.desc))))));
}
const useToast = () => useContext(ToastCtx);

// ---------- dropdown menu ----------
function Menu({
  open,
  onClose,
  anchor,
  items
}) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!open || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const menuW = 220;
    const left = Math.min(r.right - menuW, window.innerWidth - menuW - 8);
    setPos({
      left: Math.max(8, left),
      top: r.bottom + 4
    });
    const close = e => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const esc = e => {
      if (e.key === 'Escape') onClose();
    };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open, anchor]);
  if (!open || !pos) return null;
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    className: "menu",
    style: {
      position: 'fixed',
      left: pos.left,
      top: pos.top,
      zIndex: 60
    },
    onClick: e => e.stopPropagation()
  }, items.map((it, i) => {
    if (it.sep) return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: "menu-sep"
    });
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: `menu-item ${it.destructive ? 'destructive' : ''}`,
      onClick: () => {
        it.onSelect && it.onSelect();
        onClose();
      }
    }, it.icon && /*#__PURE__*/React.createElement(Icon, {
      name: it.icon,
      size: 14
    }), /*#__PURE__*/React.createElement("span", null, it.label));
  }));
}

// hook to track anchor + open state
function useMenu() {
  const [anchor, setAnchor] = useState(null);
  const open = !!anchor;
  return {
    open,
    anchor,
    openOn: el => setAnchor(el),
    close: () => setAnchor(null)
  };
}

// ---------- avatar ----------
function Avatar({
  user,
  size = 32
}) {
  if (!user) return null;
  const fs = Math.round(size * 0.4);
  return /*#__PURE__*/React.createElement("span", {
    className: `sb-avatar ${user.color}`,
    style: {
      width: size,
      height: size,
      fontSize: fs,
      flex: `0 0 ${size}px`
    }
  }, user.initials);
}

// ---------- empty state ----------
function Empty({
  icon,
  title,
  desc,
  action
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, icon && /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 28
  }), /*#__PURE__*/React.createElement("div", {
    className: "t-h4",
    style: {
      marginTop: 10,
      color: 'var(--foreground)'
    }
  }, title), desc && /*#__PURE__*/React.createElement("div", {
    className: "t-muted",
    style: {
      marginTop: 6
    }
  }, desc), action && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, action));
}

// ---------- relative time ----------
function relTime(t) {
  const d = Date.now() - t;
  if (d < 60000) return 'just now';
  if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
  if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
  if (d < 7 * 86400000) return Math.floor(d / 86400000) + 'd ago';
  const dt = new Date(t);
  return dt.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  });
}
Object.assign(window, {
  Btn,
  IconBtn,
  Input,
  SearchInput,
  Badge,
  Switch,
  Dialog,
  Sheet,
  Menu,
  useMenu,
  ToastProvider,
  useToast,
  Avatar,
  Empty,
  relTime
});