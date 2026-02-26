const { parentPort } = require('worker_threads');
const SevenZip = require('7z-wasm');
const fs = require('fs');
const path = require('path');

parentPort.on('message', async (data) => {
  const { zipPath, extractPath, taskId } = data;

  try {
    parentPort.postMessage({ type: 'progress', percent: 5, taskId, message: '(loading WASM)' });

    const sevenZip = await SevenZip();

    parentPort.postMessage({ type: 'progress', percent: 10, taskId, message: '(mounting)' });

    const mountInput = "/input";
    const mountOutput = "/output";

    sevenZip.FS.mkdir(mountInput);
    sevenZip.FS.mkdir(mountOutput);

    sevenZip.FS.mount(sevenZip.NODEFS, { root: path.dirname(zipPath) }, mountInput);
    sevenZip.FS.mount(sevenZip.NODEFS, { root: extractPath }, mountOutput);

    parentPort.postMessage({ type: 'progress', percent: 20, taskId, message: '(extracting)' });

    const archiveName = path.basename(zipPath);

    // Start extraction (synchronous, but we poll in parallel)
    sevenZip.callMain([
      'x',
      `${mountInput}/${archiveName}`,
      `-o${mountOutput}`,
      '-y'
    ]);

    // Poll file count every 1.5s for progress (best we can do with sync callMain)
    const startTime = Date.now();
    const pollInterval = setInterval(() => {
      try {
        const files = fs.readdirSync(extractPath, { recursive: true });
        const count = files.length;
        // Rough % estimate: assume ~500–2000 files total, cap at 95%
        const estPercent = Math.min(95, 20 + (count / 10));
        parentPort.postMessage({ type: 'progress', percent: estPercent, taskId, message: `(${count} files)` });
      } catch {}
    }, 1500);

    // Wait for extraction to finish (blocking here, but worker thread is isolated)
    // Since callMain is sync, this line blocks until done
    // Poll keeps sending updates

    clearInterval(pollInterval);

    const files = fs.readdirSync(extractPath, { recursive: true });
    parentPort.postMessage({ 
      type: 'done', 
      success: true, 
      taskId, 
      fileCount: files.length,
      percent: 100 
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