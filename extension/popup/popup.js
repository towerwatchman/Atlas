const RPC_URL = 'http://127.0.0.1:57096';

document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const btnAddPage = document.getElementById('btnAddPage');
  const btnOpenAtlas = document.getElementById('btnOpenAtlas');
  const btnRefresh = document.getElementById('btnRefresh');

  const pairingBox = document.getElementById('pairingBox');
  const tokenInput = document.getElementById('tokenInput');
  const btnSaveToken = document.getElementById('btnSaveToken');
  const tokenMsg = document.getElementById('tokenMsg');
  const btnUnpair = document.getElementById('btnUnpair');

  const getToken = () =>
    new Promise((resolve) =>
      chrome.storage.local.get(['rpcToken'], (r) => resolve(r.rpcToken || '')),
    );

  // Three outcomes worth telling apart, because the fix differs for each:
  //   offline      -> Atlas isn't running
  //   unpaired     -> Atlas is running but rejected our token (401)
  //   connected    -> all good
  // Collapsing the middle case into "offline" is what makes a pairing problem
  // look like a broken app.
  const checkStatus = async () => {
    const token = await getToken();

    let reachable = false;
    try {
      const ping = await fetch(`${RPC_URL}/api/ping`);
      reachable = ping.ok;
    } catch {
      reachable = false;
    }

    if (!reachable) {
      statusDot.className = 'status-dot offline';
      statusText.textContent = 'Atlas Desktop Offline';
      pairingBox.style.display = 'none';
      btnUnpair.style.display = 'none';
      return false;
    }

    try {
      const res = await fetch(`${RPC_URL}/api/status`, {
        headers: { 'X-Atlas-Token': token },
      });
      if (res.ok) {
        const data = await res.json();
        statusDot.className = 'status-dot connected';
        statusText.textContent = `Connected to Atlas (${data.version || ''})`.trim();
        pairingBox.style.display = 'none';
        btnUnpair.style.display = 'block';
        return true;
      }
      if (res.status === 401) {
        statusDot.className = 'status-dot offline';
        statusText.textContent = token
          ? 'Token rejected by Atlas'
          : 'Not paired with Atlas yet';
        pairingBox.style.display = 'flex';
        btnUnpair.style.display = 'none';
        return false;
      }
    } catch {
      // fall through
    }

    statusDot.className = 'status-dot offline';
    statusText.textContent = 'Atlas Desktop Offline';
    pairingBox.style.display = 'none';
    btnUnpair.style.display = 'none';
    return false;
  };

  btnSaveToken.addEventListener('click', async () => {
    const value = (tokenInput.value || '').trim();
    if (!value) {
      tokenMsg.textContent = 'Paste the token from Atlas Settings first.';
      tokenMsg.className = 'pairing-msg err';
      return;
    }
    await new Promise((resolve) =>
      chrome.storage.local.set({ rpcToken: value }, resolve),
    );
    tokenMsg.textContent = 'Checking...';
    tokenMsg.className = 'pairing-msg';
    const ok = await checkStatus();
    tokenMsg.textContent = ok ? 'Paired.' : 'Atlas rejected that token.';
    tokenMsg.className = ok ? 'pairing-msg ok' : 'pairing-msg err';
    if (ok) tokenInput.value = '';
  });

  btnUnpair.addEventListener('click', async () => {
    await new Promise((resolve) =>
      chrome.storage.local.remove('rpcToken', resolve),
    );
    tokenMsg.textContent = '';
    tokenInput.value = '';
    await checkStatus();
  });

  await checkStatus();

  // Check active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].url) {
      const url = tabs[0].url;
      if (/threads\/(?:(?:[^\.\/]*)\.)?\d+/.test(url)) {
        btnAddPage.style.display = 'flex';
        btnAddPage.addEventListener('click', async () => {
          try {
            await fetch(`${RPC_URL}/api/games/add`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify([url]),
            });
            btnAddPage.textContent = 'Added to Atlas!';
            setTimeout(() => {
              btnAddPage.textContent = 'Add Current Page to Atlas';
            }, 2000);
          } catch {
            alert('Failed to connect to Atlas Desktop!');
          }
        });
      }
    }
  });

  btnOpenAtlas.addEventListener('click', async () => {
    try {
      await fetch(`${RPC_URL}/api/window/show`, { method: 'POST' });
    } catch {
      alert('Could not focus Atlas window. Is Atlas running?');
    }
  });

  btnRefresh.addEventListener('click', async () => {
    btnRefresh.textContent = 'Syncing...';
    await checkStatus();
    setTimeout(() => {
      btnRefresh.textContent = 'Sync Atlas Data';
    }, 1000);
  });
});
