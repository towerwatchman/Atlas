'use strict';

const assert = require('assert');
const http = require('http');
const {
  extractThreadInfo,
  startExtensionServer,
  stopExtensionServer,
  isExtensionServerRunning,
} = require('../electron/rpc/extensionServer');

let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks += 1;
};

// 1. Thread URL Parser checks
const f95Test = extractThreadInfo('https://f95zone.to/threads/re-lord-1-the-witch-of-hertfort.12345/');
check(f95Test !== null, 'F95 thread parsed');
check(f95Test.forum === 'f95', 'F95 forum type matched');
check(f95Test.id === '12345', 'F95 thread ID extracted');
check(f95Test.slugTitle === 're lord 1 the witch of hertfort', 'Slug title cleaned');

const lcTest = extractThreadInfo('https://lewdcorner.com/threads/my-game-title.998877/page-3');
check(lcTest !== null, 'LewdCorner thread parsed');
check(lcTest.forum === 'lewdcorner', 'LewdCorner forum type matched');
check(lcTest.id === '998877', 'LewdCorner thread ID extracted');

check(extractThreadInfo('https://example.com') === null, 'Non-thread URL returns null');

// 2. HTTP RPC Server checks
const TEST_PORT = 57098;

startExtensionServer({
  port: TEST_PORT,
  getConfig: () => ({
    Extension: {
      rpcEnabled: true,
      rpcPort: TEST_PORT,
      iconGlow: true,
      highlightTags: false,
    },
  }),
});

check(isExtensionServerRunning(), 'Extension server running');

const fetchUrl = (url, options = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });

async function runServerTests() {
  try {
    const statusRes = await fetchUrl(`http://127.0.0.1:${TEST_PORT}/api/status`);
    check(statusRes.statusCode === 200, 'GET /api/status HTTP 200');
    const statusData = JSON.parse(statusRes.body);
    check(statusData.status === 'ok', 'Status payload ok');
    check(statusData.app === 'Atlas', 'App name Atlas');

    const settingsRes = await fetchUrl(`http://127.0.0.1:${TEST_PORT}/api/settings`);
    check(settingsRes.statusCode === 200, 'GET /api/settings HTTP 200');
    const settingsData = JSON.parse(settingsRes.body);
    check(settingsData.rpc_port === TEST_PORT, 'Configured RPC port returned');
    check(settingsData.icon_glow === true, 'Icon glow setting returned');

    const optionsRes = await fetchUrl(`http://127.0.0.1:${TEST_PORT}/api/games`, {
      method: 'OPTIONS',
    });
    check(optionsRes.statusCode === 200, 'OPTIONS preflight HTTP 200');
    check(optionsRes.headers['access-control-allow-origin'] === '*', 'CORS Allow-Origin *');

    console.log(`[check-extension-server] All ${checks} checks passed clean.`);
  } finally {
    stopExtensionServer();
  }
}

runServerTests().catch((err) => {
  console.error('[check-extension-server] Test failed:', err);
  process.exit(1);
});
