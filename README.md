# 🛡️ IntentShield

> **Intent-based browser security extension for Chromium browsers.**

IntentShield guards against clickjacking, phantom redirects, pop-under tabs, and unauthorized executable downloads — all in real time, without disrupting legitimate browsing.

---

## 🔍 What It Protects Against

| Threat | How It Works | IntentShield's Defense |
|--------|-------------|----------------------|
| **Clickjacking** | Invisible overlays layered over UI to hijack clicks | Detects & neutralizes transparent DOM elements via `MutationObserver` |
| **Phantom Redirects** | Scripts navigating the user without any gesture | Wraps `window.open`, `location`, and `history` APIs using `Proxy` |
| **Pop-Under Tabs** | New tab spawned silently in background | Detects focus-stealing pattern via tab lifecycle timing |
| **Unauthorized Downloads** | Scripts triggering `.exe`, `.apk`, `.msi` downloads | Dual-layer blocking via `declarativeNetRequest` + `webRequest` headers |

---

## 🧱 Architecture

```
intentShield/
├── manifest.json              # Manifest V3 config
├── background.js              # Service worker — tab monitoring, download guardian, notifications
├── content.js                 # Isolated world — overlay scanner + event shield
├── inject.js                  # Main world — native API proxying (window.open, location, history)
├── popup.html                 # Extension popup UI (enable/disable per site)
├── icons/                     # Extension icons (16px, 48px, 128px)
└── rules/
    └── download_rules.json    # Static declarativeNetRequest block rules
```

**Three execution contexts working together:**
- `background.js` — browser-level (tab lifecycle, network headers)
- `content.js` — extension isolated world (DOM scanning, event interception, message bridge)
- `inject.js` — page main world (wraps native JS APIs inaccessible from isolated world)

---

## ⚙️ How Each Defense Works

### 1. Clickjacking Defense (`content.js`)
A `MutationObserver` watches every DOM change. New or restyled elements are checked for:
- Opacity < 0.1 while still capturing pointer events
- Covering > 30% of viewport with no visible content
- z-index > 10,000 with no visible children and size > 50% of viewport

Detected overlays have `pointerEvents` set to `none` — neutralized without breaking the page.

### 2. Phantom Redirect Interception (`inject.js`)
Runs in the **page's main world** and wraps navigation APIs:
- `window.open` via `Proxy`
- `location.href` via `Object.defineProperty` on the prototype
- `location.assign` and `location.replace` via `Object.defineProperty` with `try/catch` fallback
- `history.pushState` and `history.replaceState` with the same pattern

Checks `navigator.userActivation.isActive` before allowing navigation. If no user gesture → shows a toast prompt:

```
⚠ IntentShield: Unauthorized redirect to: example.com
                          [ Block ]  [ Allow ]
```
Auto-dismisses after 8 seconds, defaulting to **Block**.

### 3. Pop-Under Detection (`background.js`)
Tracks newly opened tabs and their `openerTabId`. If the opener tab regains focus within **800ms** of spawning the new tab — a classic pop-under pattern — the background tab is discarded and the user is notified.

### 4. Download Guardian (`background.js` + `rules/download_rules.json`)
Two-layer approach:
- **Static rules** via `declarativeNetRequest` block executable file URLs loaded from subframes or scripts
- **Dynamic inspection** via `webRequest.onHeadersReceived` checks for `Content-Disposition: attachment` on executable URLs triggered by `xmlhttprequest`, `fetch`, or scripted requests

---

## 🚀 Installation (Developer Mode)

> IntentShield is not yet on the Chrome Web Store. Load it manually:

1. Clone or download this repository
2. Go to `chrome://extensions`
3. Enable **Developer mode** (toggle, top-right)
4. Click **Load unpacked**
5. Select the `intentShield/` folder

The extension activates on all tabs immediately. Click the toolbar icon to enable/disable per site.

---

## 🌐 Browser Compatibility

| Browser | Status |
|---------|--------|
| Google Chrome | ✅ Supported |
| Microsoft Edge | ✅ Supported |
| Brave | ✅ Supported |
| Opera | ✅ Supported |
| Firefox | ❌ Requires rewrite (partial MV3 support) |
| Safari | ❌ Not supported |

---

## 🔐 Permissions Explained

| Permission | Why It's Needed |
|------------|----------------|
| `declarativeNetRequest` | Static blocking of executable download URLs |
| `webRequest` | Inspecting response headers dynamically |
| `tabs` | Monitoring tab creation and focus for pop-under detection |
| `scripting` | Injecting `inject.js` into the page's main world |
| `notifications` | Alerting the user when a threat is blocked |
| `storage` | Persisting enabled/paused-site preferences |
| `host_permissions: <all_urls>` | Required to operate across all websites |

---

## ⚠️ Known Limitations

- On some sites, `location.assign` and `location.replace` are non-configurable — wrapping is silently skipped on those pages
- Event log is in-memory only and does not persist across browser sessions
- Overlay thresholds (opacity, viewport coverage, z-index) may need tuning on some sites

---

## 🛠️ Built With

- Chrome Extensions **Manifest V3**
- `declarativeNetRequest` API
- `webRequest` API
- `MutationObserver`
- `navigator.userActivation`
- ES6 `Proxy` + `Object.defineProperty`
- `chrome.storage.local`

---

## 👤 Author

Md. Rakibur Rahman Shovon

---

## 📄 License

[MIT License](LICENSE) — free to use, modify, and distribute.
