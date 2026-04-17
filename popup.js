const toggleEnabled = document.getElementById('toggle-enabled');
const togglePause   = document.getElementById('toggle-pause');
const statusText    = document.getElementById('status-text');

function updateStatus() {
  const enabled = toggleEnabled.checked;
  const paused  = togglePause.checked;
  if (!enabled) {
    statusText.textContent = 'Protection disabled';
    statusText.className = 'status paused';
  } else if (paused) {
    statusText.textContent = 'Paused on this site';
    statusText.className = 'status paused';
  } else {
    statusText.textContent = 'Active on this site';
    statusText.className = 'status';
  }
}

// Load saved state
chrome.storage.local.get(['enabled', 'pausedSites'], async (data) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host  = new URL(tab.url).hostname;

  toggleEnabled.checked = data.enabled !== false;
  togglePause.checked   = (data.pausedSites || []).includes(host);
  updateStatus();
});

// Save global toggle
toggleEnabled.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: toggleEnabled.checked });
  chrome.runtime.sendMessage({ type: 'SET_ENABLED', value: toggleEnabled.checked });
  updateStatus();
});

// Save per-site pause
togglePause.addEventListener('change', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host  = new URL(tab.url).hostname;

  chrome.storage.local.get(['pausedSites'], (data) => {
    let sites = data.pausedSites || [];
    if (togglePause.checked) {
      sites = [...new Set([...sites, host])];
    } else {
      sites = sites.filter(s => s !== host);
    }
    chrome.storage.local.set({ pausedSites: sites });
    chrome.runtime.sendMessage({ type: 'SET_PAUSED_SITE', host, paused: togglePause.checked });
    updateStatus();
  });
});