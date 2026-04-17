// ─── 1. MAIN-WORLD INJECTOR ────────────────────────────────────────────────
// Inject inject.js into the page's main world so it can wrap native APIs.


// ─── 2. VISIBILITY AUDIT ENGINE ────────────────────────────────────────────
const VIEWPORT_COVER_THRESHOLD = 0.30; // 30% of viewport area
const OPACITY_THRESHOLD       = 0.1;

function getComputedStyles(el) {
  try { return window.getComputedStyle(el); }
  catch { return null; }
}

function isEffectivelyInvisible(el) {
  const cs = getComputedStyles(el);
  if (!cs) return false;
  const opacity      = parseFloat(cs.opacity);
  const visibility   = cs.visibility;
  const bg           = cs.backgroundColor;
  const pointerEvts  = cs.pointerEvents;
  // Element is transparent/invisible but still captures pointer events
  const isTransparent = opacity < OPACITY_THRESHOLD
    || visibility === 'hidden'
    || isTransparentColor(bg);
  const capturesInput = pointerEvts !== 'none';
  return isTransparent && capturesInput;
}

function isTransparentColor(colorStr) {
  if (!colorStr || colorStr === 'transparent') return true;
  const rgbaMatch = colorStr.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
  if (rgbaMatch) return parseFloat(rgbaMatch[1]) < OPACITY_THRESHOLD;
  return false;
}

function coversLargeViewportArea(el) {
  const rect = el.getBoundingClientRect();
  const vpArea = window.innerWidth * window.innerHeight;
  const elArea = rect.width * rect.height;
  return elArea / vpArea > VIEWPORT_COVER_THRESHOLD;
}

function hasVisibleContent(el) {
  if (el.textContent.trim().length > 0) return true;
  const imgs = el.querySelectorAll('img, svg, canvas, video');
  for (const img of imgs) {
    const r = img.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return true;
  }
  return false;
}

// Returns true if the element looks like a click-hijacking overlay
function isHijackingOverlay(el) {
  if (isEffectivelyInvisible(el) && coversLargeViewportArea(el)) return true;
  if (coversLargeViewportArea(el) && !hasVisibleContent(el)) return true;
  const parent = el.parentElement;
  if (parent && isEffectivelyInvisible(parent) && coversLargeViewportArea(parent)) return true;
  return false;
}

// ─── 3. CAPTURE-PHASE EVENT SHIELD ────────────────────────────────────────
const SHIELDED_EVENTS = ['click', 'mousedown', 'touchstart'];

function shieldHandler(e) {
  if (!shieldActive) return; // Check if shield is active (can be toggled via popup)
  const target = e.target;
  if (!target || target === document.body || target === document.documentElement) return;
  if (isHijackingOverlay(target)) {
    e.stopImmediatePropagation();
    e.preventDefault();
    //console.warn('[IntentShield] Blocked suspicious overlay click:', target);
    // Notify background for logging
    chrome.runtime.sendMessage({
      type: 'OVERLAY_BLOCKED',
      detail: {
        tag:      target.tagName,
        id:       target.id,
        classes:  target.className,
        href:     window.location.href
      }
    });
  }
}

for (const evt of SHIELDED_EVENTS) {
  document.addEventListener(evt, shieldHandler, { capture: true, passive: false });
}

// ─── 4. Z-INDEX / OVERLAY SCANNER (MutationObserver) ──────────────────────
const ZINDEX_THRESHOLD = 10_000;

function isMaliciousOverlayNode(el) {
  if (!(el instanceof HTMLElement)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < window.innerWidth * 0.5 || rect.height < window.innerHeight * 0.5) return false;
  const cs = getComputedStyles(el);
  if (!cs) return false;
  const zIndex  = parseInt(cs.zIndex, 10);
  const opacity = parseFloat(cs.opacity);
  if (isNaN(zIndex) || zIndex <= ZINDEX_THRESHOLD) return false;
  // High z-index AND (nearly invisible OR no visible child nodes)
  const tooTransparent  = opacity < OPACITY_THRESHOLD;
  const noVisibleChildren = !hasVisibleContent(el);
  return tooTransparent || noVisibleChildren;
}

function auditNode(el) {
  if (isMaliciousOverlayNode(el)) {
    el.style.pointerEvents = 'none';
    chrome.runtime.sendMessage({ type: 'OVERLAY_REMOVED', detail: { tag: el.tagName, id: el.id } });
  }
}

const domObserver = new MutationObserver((mutations) => {
  if (!shieldActive) return; // Skip scanning if shield is inactive
  for (const mut of mutations) {
    for (const node of mut.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      auditNode(node);
      // Recursively check subtrees of newly added nodes
      node.querySelectorAll('*').forEach(auditNode);
    }
    if (mut.type === 'attributes' && mut.target instanceof HTMLElement) {
      auditNode(mut.target);
    }
  }
});

domObserver.observe(document.documentElement, {
  childList:  true,
  subtree:    true,
  attributes: true,
  attributeFilter: ['style', 'class']
});

// ─── 5. MESSAGE BRIDGE FROM inject.js ─────────────────────────────────────
// inject.js runs in main world (no chrome.* access), so it postMessages here.
window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  if (!e.data?.__intentShield) return;
  chrome.runtime.sendMessage(e.data);
});

//------- Pause or Turn off in a Tab using the popup (future) -------
let shieldActive = true;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SHIELD_STATE') {
    shieldActive = msg.active;
    console.info('[IntentShield] Shield state updated:', shieldActive ? 'ACTIVE' : 'INACTIVE');
  }
});
