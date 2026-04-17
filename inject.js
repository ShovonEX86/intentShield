(function() {
  'use strict';

  let _lastGestureTime = 0;

  const INTENT_WINDOW_MS = 500; // Acceptable gesture-to-navigation gap

  // ─── HELPER: Relay messages to content.js bridge ──────────────────────────
  function relay(type, detail) {
    window.postMessage({ __intentShield: true, type, detail }, '*');
  }

  // ─── HELPER: Show non-blocking toast in the page ──────────────────────────
  function showToast(message, onAllow, onDeny) {
    const existing = document.getElementById('__intentshield_toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = '__intentshield_toast';
    Object.assign(toast.style, {
      position:        'fixed',
      bottom:          '24px',
      right:           '24px',
      zIndex:          '2147483647',
      background:      '#1a1a2e',
      color:           '#e0e0f0',
      padding:         '14px 18px',
      borderRadius:    '10px',
      boxShadow:       '0 4px 24px rgba(0,0,0,0.4)',
      fontFamily:      'system-ui, sans-serif',
      fontSize:        '14px',
      lineHeight:      '1.5',
      maxWidth:        '360px',
      display:         'flex',
      flexDirection:   'column',
      gap:             '10px',
      userSelect:      'none',
      transition:      'opacity 0.3s'
    });

    const msg = document.createElement('span');
    msg.textContent = '⚠ IntentShield: ' + message;

    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end' });

    const mkBtn = (label, bg, action) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      Object.assign(btn.style, {
        background: bg, color: '#fff', border: 'none',
        borderRadius: '6px', padding: '5px 14px',
        cursor: 'pointer', fontSize: '13px'
      });
      btn.addEventListener('click', () => { toast.remove(); action && action(); });
      return btn;
    };

    btnRow.appendChild(mkBtn('Block',  '#c0392b', onDeny));
    btnRow.appendChild(mkBtn('Allow',  '#27ae60', onAllow));
    toast.appendChild(msg);
    toast.appendChild(btnRow);
    document.body.appendChild(toast);

    // Auto-dismiss after 8s with no action → defaults to block
    setTimeout(() => { if (toast.isConnected) { toast.remove(); onDeny && onDeny(); } }, 8000);
  }

  // ─── 1. PROXY: window.open ─────────────────────────────────────────────────
  const _nativeOpen = window.open ? window.open.bind(window) : null;
  window.open = new Proxy(_nativeOpen, {
    apply(target, thisArg, args) {
      if (!_nativeOpen) return null;
      const activation = navigator.userActivation;
      if (activation?.isActive) {
        return Reflect.apply(target, thisArg, args);
      }
      // No active user gesture — trap and prompt
      const url = args[0] || '(unknown)';
      relay('PHANTOM_REDIRECT_INTERCEPTED', { api: 'window.open', url });
      showToast(
        `Page tried to open: ${url.substring(0, 60)}`,
        () => Reflect.apply(target, thisArg, args), // allow
        () => {} // deny — do nothing
      );
      return null;
    }
  });

  // ─── 2. PROXY: location setter (href, assign, replace) ────────────────────


  // Track genuine user gesture timestamps at capture phase
document.addEventListener('click',      () => { _lastGestureTime = Date.now(); }, { capture: true });
document.addEventListener('keydown',    () => { _lastGestureTime = Date.now(); }, { capture: true });
document.addEventListener('touchstart', () => { _lastGestureTime = Date.now(); }, { capture: true });

document.addEventListener('click', () => { _lastGestureTime = Date.now(); }, { capture: true });
  function withinIntentWindow() {
    return (Date.now() - _lastGestureTime) <= INTENT_WINDOW_MS;
  }

  function interceptNavigation(navigateFn, url) {
    if (navigator.userActivation?.isActive || withinIntentWindow()) {
      navigateFn();
      return;
    }
    relay('PHANTOM_REDIRECT_INTERCEPTED', { api: 'location', url });
    showToast(
      `Unauthorized redirect to: ${String(url).substring(0, 60)}`,
      navigateFn,
      () => {}
    );
  }

  // Wrap location.href setter
  const locProto = Object.getPrototypeOf(window.location);
  const hrefDescriptor = Object.getOwnPropertyDescriptor(locProto, 'href');
  if (hrefDescriptor?.set) {
    const _nativeSetter = hrefDescriptor.set;
    Object.defineProperty(locProto, 'href', {
      ...hrefDescriptor,
      set(val) {
        interceptNavigation(() => _nativeSetter.call(window.location, val), val);
      }
    });
  }

  // Wrap location.assign
  const _nativeAssign = location.assign.bind(location);
  try {Object.defineProperty(location, 'assign', {value: (url) => interceptNavigation(() => _nativeAssign(url), url), configurable: true});
  } catch {
    //location.assign = (url) => interceptNavigation(() => _nativeAssign(url), url);
  }

  // Wrap location.replace
  const _nativeReplace = location.replace.bind(location);
  try {
  Object.defineProperty(location, 'replace', {value: (url) => interceptNavigation(() => _nativeReplace(url), url), configurable: true});
} catch {
  //location.replace = (url) => interceptNavigation(() => _nativeReplace(url), url);
}

  // Wrap history.pushState / replaceState for SPA navigations
  const _nativePush    = history.pushState.bind(history);
  const _nativeRepl    = history.replaceState.bind(history);
  try {
    Object.defineProperty(history, 'pushState', { value: (...a) => interceptNavigation(() => _nativePush(...a), a[2]), configurable: true });
  } catch {
    history.pushState = (...a) => interceptNavigation(() => _nativePush(...a), a[2]);
  }
  try {
    Object.defineProperty(history, 'replaceState', { value: (...a) => interceptNavigation(() => _nativeRepl(...a), a[2]), configurable: true });
  } catch {
    history.replaceState = (...a) => interceptNavigation(() => _nativeRepl(...a), a[2]);
  }
})();