// src/workers/extractWorker.js
const { parentPort } = require('worker_threads');
const SevenZip = require('7z-wasm');
const fs = require('fs');
const path = require('path');

parentPort.on('message', async (data) => {
  const { zipPath, extractPath, taskId } = data;

  try {
    const sevenZip = await SevenZip();

    const mountInput = "/input";
    const mountOutput = "/output";

    sevenZip.FS.mkdir(mountInput);
    sevenZip.FS.mkdir(mountOutput);

    sevenZip.FS.mount(sevenZip.NODEFS, { root: path.dirname(zipPath) }, mountInput);
    sevenZip.FS.mount(sevenZip.NODEFS, { root: extractPath }, mountOutput);

    const archiveName = path.basename(zipPath);

    sevenZip.callMain([
      'x',
      `${mountInput}/${archiveName}`,
      `-o${mountOutput}`,
      '-y'
    ]);

    sevenZip.FS.unlink(`${mountInput}/${archiveName}`).catch(() => {});

    const files = fs.readdirSync(extractPath, { recursive: true });

    parentPort.postMessage({
      type: 'done',
      success: true,
      taskId,
      fileCount: files.length
    });
  } catch (err) {
    parentPort.postMessage({
      type: 'done',
      success: false,
      taskId,
      error: err.message
    });
  }
});