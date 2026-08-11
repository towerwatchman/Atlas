const RPC_URL = 'http://127.0.0.1:57096';

document.addEventListener('DOMContentLoaded', async () => {
  // Installed by compat.js, which popup.html loads immediately before this file.
  const api = globalThis.atlasBrowser;

  const readout = document.getElementById('readout');
  const statusText = document.getElementById('statusText');
  const readoutEndpoint = document.getElementById('readoutEndpoint');
  const extVersion = document.getElementById('extVersion');
  const btnAddPage = document.getElementById('btnAddPage');
  const btnOpenAtlas = document.getElementById('btnOpenAtlas');
  const btnRefresh = document.getElementById('btnRefresh');

  const pairingBox = document.getElementById('pairingBox');
  const tokenInput = document.getElementById('tokenInput');
  const btnSaveToken = document.getElementById('btnSaveToken');
  const tokenMsg = document.getElementById('tokenMsg');
  const btnUnpair = document.getElementById('btnUnpair');

  const permissionBox = document.getElementById('permissionBox');
  const btnGrantAccess = document.getElementById('btnGrantAccess');

  // Promise form throughout -- see compat.js on why the callback signatures
  // are not portable to Firefox.
  const getToken = async () => {
    try {
      const r = await api.storage.local.get(['rpcToken']);
      return (r && r.rpcToken) || '';
    } catch {
      return '';
    }
  };

  // The readout's colour, label and pip are all driven off one data-state
  // attribute in CSS, so setting state in a single place is what keeps them
  // from disagreeing. Endpoint is passed separately because it is the one part
  // that stays useful when the state is bad -- knowing WHICH address failed is
  // most of diagnosing a failed connection, and the old UI never showed it.
  const setState = (state, label, endpoint) => {
    readout.dataset.state = state;
    statusText.textContent = label;
    readoutEndpoint.textContent = endpoint;
  };

  // The address the background worker dials, so it is accurate to display even
  // before Atlas answers.
  const ENDPOINT_LABEL = RPC_URL.replace(/^https?:\/\//, '');

  // Every authenticated route needs this. Two calls below used to omit it and
  // got a silent 401 that surfaced as "Added to Atlas!" on a game that was
  // never added.
  const authHeaders = (token, extra = {}) => ({
    'X-Atlas-Token': token,
    ...extra,
  });

  // ── Firefox host-permission gate ───────────────────────────────────────────
  //
  // Under Gecko MV3 the host permissions in the manifest are requests, not
  // grants: content scripts do not inject until the user opts in. Chromium
  // grants them at install and permissions.contains always answers true there,
  // so this block simply never shows.
  const refreshPermissionState = async () => {
    if (!permissionBox) return true;
    const granted = await globalThis.atlasHasHostAccess();
    permissionBox.style.display = granted ? 'none' : 'flex';
    return granted;
  };

  if (btnGrantAccess) {
    btnGrantAccess.addEventListener('click', async () => {
      try {
        // Must be called from a user gesture or Firefox rejects it outright.
        await api.permissions.request({
          origins: globalThis.atlasHostPermissions,
        });
      } catch (err) {
        console.warn('Atlas: host permission request failed:', err);
      }
      await refreshPermissionState();
    });
  }

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
      setState('offline', 'Offline', 'Start Atlas to connect');
      pairingBox.style.display = 'none';
      btnUnpair.style.display = 'none';
      return false;
    }

    try {
      const res = await fetch(`${RPC_URL}/api/status`, {
        headers: authHeaders(token),
      });
      if (res.ok) {
        const data = await res.json();
        // Atlas's version sits on the endpoint line, beside the address it came
        // from. The extension's own version lives in the footer; showing both in
        // one sentence was how they got mistaken for each other.
        const appVersion = data.version ? `  \u00b7  Atlas ${data.version}` : '';
        setState('connected', 'Connected', `${ENDPOINT_LABEL}${appVersion}`);
        pairingBox.style.display = 'none';
        btnUnpair.style.display = 'block';
        return true;
      }
      if (res.status === 401) {
        setState(
          'unpaired',
          token ? 'Token rejected' : 'Not paired',
          token ? 'Paste the current token from Atlas' : ENDPOINT_LABEL,
        );
        pairingBox.style.display = 'flex';
        btnUnpair.style.display = 'none';
        return false;
      }
    } catch {
      // fall through
    }

    setState('offline', 'Offline', 'Start Atlas to connect');
    pairingBox.style.display = 'none';
    btnUnpair.style.display = 'none';
    return false;
  };

  btnSaveToken.addEventListener('click', async () => {
    const value = (tokenInput.value || '').trim();
    if (!value) {
      tokenMsg.textContent = 'Paste the token from Atlas first.';
      tokenMsg.className = 'pairing-msg err';
      return;
    }
    await api.storage.local.set({ rpcToken: value });
    tokenMsg.textContent = 'Checking...';
    tokenMsg.className = 'pairing-msg';
    const ok = await checkStatus();
    tokenMsg.textContent = ok ? 'Paired.' : 'Atlas rejected that token.';
    tokenMsg.className = ok ? 'pairing-msg ok' : 'pairing-msg err';
    if (ok) tokenInput.value = '';
  });

  btnUnpair.addEventListener('click', async () => {
    await api.storage.local.remove('rpcToken');
    tokenMsg.textContent = '';
    tokenInput.value = '';
    await checkStatus();
  });

  // Read from the manifest rather than written into the markup. popup.html
  // carried the literal string "v1.0.0" while the manifest said 1.0.7, and no
  // version of that arrangement stays true on its own.
  try {
    extVersion.textContent = `v${api.runtime.getManifest().version}`;
  } catch {
    extVersion.textContent = '';
  }

  setState('checking', 'Checking', ENDPOINT_LABEL);
  await refreshPermissionState();
  await checkStatus();

  // Check active tab
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  if (tabs && tabs[0] && tabs[0].url) {
    const url = tabs[0].url;
    if (/threads\/(?:(?:[^\.\/]*)\.)?\d+/.test(url)) {
      btnAddPage.style.display = 'flex';
      btnAddPage.addEventListener('click', async () => {
        try {
          const token = await getToken();
          const res = await fetch(`${RPC_URL}/api/games/add`, {
            method: 'POST',
            headers: authHeaders(token, { 'Content-Type': 'application/json' }),
            body: JSON.stringify([url]),
          });
          // A 401 here means unpaired, not offline. Reporting success on any
          // response that merely arrived is how a rejected add used to look
          // identical to a successful one.
          if (!res.ok) {
            btnAddPage.textContent =
              res.status === 401 ? 'Not paired' : 'Atlas refused that';
          } else {
            btnAddPage.textContent = 'Added';
          }
          setTimeout(() => {
            btnAddPage.textContent = 'Add this page';
          }, 2000);
        } catch {
          alert('Failed to connect to Atlas Desktop!');
        }
      });
    }
  }

  btnOpenAtlas.addEventListener('click', async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${RPC_URL}/api/window/show`, {
        method: 'POST',
        headers: authHeaders(token),
      });
      if (!res.ok) {
        alert(
          res.status === 401
            ? 'Atlas rejected the pairing token. Re-pair from Atlas Settings.'
            : 'Could not focus Atlas window.',
        );
      }
    } catch {
      alert('Could not focus Atlas window. Is Atlas running?');
    }
  });

  btnRefresh.addEventListener('click', async () => {
    btnRefresh.textContent = 'Syncing';
    await refreshPermissionState();
    await checkStatus();
    setTimeout(() => {
      btnRefresh.textContent = 'Sync now';
    }, 1000);
  });
});
