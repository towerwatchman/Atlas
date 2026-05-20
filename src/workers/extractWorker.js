// workers/extractWorker.js
const { parentPort, workerData } = require("worker_threads");
const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

const {
  archivePath,
  extractPath,
  sevenZipBin,
  totalUncompressedBytes = 0, // Passed from main
  totalFiles = 0, // Passed from main (optional fallback)
} = workerData;

async function extractInWorker() {
  let lastPercent = 0;
  let lastBytes = 0;
  let lastFileCount = 0;

  console.log(`[worker] Starting extraction: ${archivePath} → ${extractPath}`);
  console.log(
    `[worker] Known totals: ${totalFiles} files, ${totalUncompressedBytes} bytes uncompressed`,
  );

  // Progress reporting interval
  const interval = setInterval(async () => {
    try {
      let currentBytes = 0;
      let currentFiles = 0;

      // Get all entries recursively
      const entries = await fs.readdir(extractPath, {
        recursive: true,
        withFileTypes: true,
      });
      currentFiles = entries.length;

      // Sum file sizes
      for (const entry of entries) {
        if (entry.isFile()) {
          try {
            const fullPath = path.join(extractPath, entry.path || entry.name);
            const stat = await fs.stat(fullPath);
            currentBytes += stat.size;
          } catch {
            // skip inaccessible files
          }
        }
      }

      let percent = 0;
      let progressText = "";

      // 1. Primary: size-based progress (preferred when available)
      if (totalUncompressedBytes > 1024 * 1024 * 5) {
        // > ~5 MB to trust
        percent = Math.min(
          95,
          Math.round((currentBytes / totalUncompressedBytes) * 100),
        );
        progressText = `Extracting... ${percent}% (${Math.round(currentBytes / 1024 / 1024)} / ${Math.round(totalUncompressedBytes / 1024 / 1024)} MiB)`;
      }
      // 2. Fallback: file-count based
      else if (totalFiles > 10) {
        percent = Math.min(95, Math.round((currentFiles / totalFiles) * 100));
        progressText = `Extracting... ${percent}% (${currentFiles} / ${totalFiles} files)`;
      }
      // 3. Very rough fallback
      else {
        percent = Math.min(95, Math.round(currentFiles / 20));
        progressText = `Extracting... ~${percent}% (${currentFiles} files)`;
      }

      // Only send if meaningfully changed
      if (percent > lastPercent + 1 || percent === 100) {
        lastPercent = percent;

        parentPort.postMessage({
          type: "progress",
          percent,
          text: progressText,
          bytes: currentBytes,
          files: currentFiles,
        });

        console.log(`[worker] Sent progress: ${progressText}`);
      }

      lastBytes = currentBytes;
      lastFileCount = currentFiles;
    } catch (err) {
      // Folder not ready yet or access denied → skip tick
    }
  }, 1500); // 1.5 seconds — good balance

  return new Promise((resolve, reject) => {
    const child = spawn(sevenZipBin, [
      "x",
      archivePath,
      `-o${extractPath}`,
      "-y",
    ]);

    // Optional: log stderr for debugging
    child.stderr.on("data", (data) => {
      console.log(`[worker 7z stderr]: ${data.toString().trim()}`);
    });

    child.on("error", (err) => {
      clearInterval(interval);
      console.error(`[worker] Spawn error:`, err);
      reject(err);
    });

    child.on("close", (code) => {
      clearInterval(interval);

      if (code === 0) {
        console.log(`[worker] Extraction success (code 0)`);
        parentPort.postMessage({
          type: "progress",
          percent: 100,
          text: "Extraction complete — 100%",
        });
        resolve({ success: true });
      } else {
        console.error(`[worker] 7z failed with code ${code}`);
        reject(new Error(`7z exited with code ${code}`));
      }
    });
  });
}

extractInWorker()
  .then(() => {
    parentPort.postMessage({ type: "done", success: true });
    console.log(`[worker] Sent done: success`);
  })
  .catch((err) => {
    parentPort.postMessage({
      type: "done",
      success: false,
      error: err.message,
    });
    console.error(`[worker] Sent done: error - ${err.message}`);
  });
