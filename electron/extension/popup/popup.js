const RPC_URL = 'http://127.0.0.1:57096';

document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const btnAddPage = document.getElementById('btnAddPage');
  const btnOpenAtlas = document.getElementById('btnOpenAtlas');
  const btnRefresh = document.getElementById('btnRefresh');

  const checkStatus = async () => {
    try {
      const res = await fetch(`${RPC_URL}/api/status`);
      if (res.ok) {
        const data = await res.json();
        statusDot.className = 'status-dot connected';
        statusText.textContent = `Connected to Atlas (${data.version || 'v0.9.8'})`;
        return true;
      }
    } catch {
      // Failed to connect
    }
    statusDot.className = 'status-dot offline';
    statusText.textContent = 'Atlas Desktop Offline';
    return false;
  };

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
