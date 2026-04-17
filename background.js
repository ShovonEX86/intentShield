'use strict';

// ─── STATE ─────────────────────────────────────────────────────────────────
// Map<tabId, {createdAt, openerTabId}> — tracks recently opened tabs
const recentTabMap = new Map();

// Event log (in-memory; could be persisted via chrome.storage.local)
const eventLog = [];
const MAX_LOG = 200;

function pushLog(entry) {
  eventLog.unshift({ ...entry, ts: new Date().toISOString() });
  if (eventLog.length > MAX_LOG) eventLog.pop();
}

// ─── 1. TAB FOCUS INTEGRITY ────────────────────────────────────────────────
// Detect pop-unders: new tab spawned, opener immediately tries to regain focus

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.openerTabId !== undefined) {
    recentTabMap.set(tab.id, {
      createdAt:   Date.now(),
      openerTabId: tab.openerTabId
    });
    // Clean up entry after 2 seconds
    setTimeout(() => recentTabMap.delete(tab.id), 2000);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  // If activation switched away from a newly created tab's OPENER immediately,
  // that's a pop-under pattern: opener stole focus back.
  for (const [newTabId, meta] of recentTabMap) {
    const AGE_MS = Date.now() - meta.createdAt;
    if (tabId === meta.openerTabId && AGE_MS < 800) {
      console.warn(`[IntentShield] Pop-under detected. Discarding tab ${newTabId}`);
      pushLog({ type: 'POP_UNDER_BLOCKED', newTabId, openerTabId: tabId });
      try {
        await chrome.tabs.discard(newTabId);
        await notify(
          'Pop-under Blocked',
          `A background tab attempted to hijack your focus. It has been discarded.`
        );
      } catch (err) {
        console.error('[IntentShield] Could not discard tab:', err);
      }
      recentTabMap.delete(newTabId);
    }
  }
});

// ─── 2. DOWNLOAD GUARDIAN (webRequest response headers) ───────────────────
// declarativeNetRequest blocks known patterns statically (see rules JSON).
// webRequest gives us dynamic initiator cross-referencing.
const EXECUTABLE_EXTENSIONS = new Set([
  '.exe', '.msi', '.apk', '.dmg', '.pkg', '.bat', '.cmd', '.sh', '.ps1'
]);

function isExecutableUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return [...EXECUTABLE_EXTENSIONS].some((ext) => pathname.endsWith(ext));
  } catch { return false; }
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const contentDisposition = details.responseHeaders
      ?.find((h) => h.name.toLowerCase() === 'content-disposition')
      ?.value || '';

    const isAttachment = contentDisposition.toLowerCase().startsWith('attachment');
    const isExec       = isExecutableUrl(details.url);

    if (!isAttachment || !isExec) return;

    // Cross-reference: was this triggered by a script, not a direct anchor click?
    const initiatorType = details.initiator; // origin string
    const isScriptInitiated = details.type === 'xmlhttprequest'
      || details.type === 'fetch'
      || (details.type === 'other' && details.initiator);

    if (isScriptInitiated) {
      pushLog({ type: 'DOWNLOAD_BLOCKED', url: details.url, initiator: initiatorType });
      notify(
        'Unauthorized Download Blocked',
        `A script attempted to download an executable:\n${details.url.substring(0, 80)}`
      );
    }
  },
  { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame', 'xmlhttprequest', 'other'] },
  ['responseHeaders', 'extraHeaders']
);

// ─── 3. MESSAGE HANDLER (from content.js bridge) ──────────────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg?.type) return;
  pushLog({ ...msg, tabId: sender.tab?.id, url: sender.tab?.url });

  switch (msg.type) {
    case 'OVERLAY_BLOCKED':
    case 'OVERLAY_REMOVED':
      console.info('[IntentShield]', msg.type, msg.detail);
      break;
    case 'PHANTOM_REDIRECT_INTERCEPTED':
      notify('Redirect Intercepted', `Phantom redirect to: ${msg.detail?.url || '?'}`);
      break;
  }
});

// ─── 4. NOTIFICATION HELPER ────────────────────────────────────────────────
async function notify(title, message) {
  const id = 'intentshield_' + Date.now();
  chrome.notifications.create(id, {
    type:     'basic',
    iconUrl:  'icons/icon48.png',
    title:    'IntentShield — ' + title,
    message,
    priority: 2
  });
  // Auto-clear after 6s
  setTimeout(() => chrome.notifications.clear(id), 6000);
}

// ─── 5. EXPOSE LOG VIA MESSAGE (for a future popup/devtools panel) ─────────
chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
  if (msg?.type === 'GET_LOG') {
    sendResponse({ log: eventLog });
    return true;
  }
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'loading' || !tab.url?.startsWith('http')) return;

  chrome.storage.local.get(['enabled', 'pausedSites'], (data) => {
    const host   = new URL(tab.url).hostname;
    const active = data.enabled !== false && !(data.pausedSites || []).includes(host);
    if (active)
      chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['inject.js'] });
  });
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SET_ENABLED' || msg.type === 'SET_PAUSED_SITE') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) return;

      chrome.storage.local.get(['enabled', 'pausedSites'], (data) => {
        const host   = new URL(tab.url).hostname;
        const active = data.enabled !== false && !(data.pausedSites || []).includes(host);
        chrome.tabs.sendMessage(tab.id, { type: 'SHIELD_STATE', active });
      });
    });
  }
});
