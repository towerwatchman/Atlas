// workers/extractWorker.js
const { parentPort, workerData } = require("worker_threads");
const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

const { archivePath, extractPath, sevenZipBin } = workerData;

async function extractInWorker() {
  let lastPercent = 0;
  let lastFileCount = 0;

  // Progress reporting interval (file count based)
  const interval = setInterval(async () => {
    try {
      const files = await fs.readdir(extractPath, { recursive: true });
      const count = files.length;

      const estimated = Math.min(95, Math.round(count / 12)); // tune divisor as needed

      if (estimated > lastPercent) {
        lastPercent = estimated;
        parentPort.postMessage({
          type: "progress",
          percent: estimated,
          text: `Extracting... ${estimated}% (${count} files)`,
          fileCount: count,
        });
      }

      lastFileCount = count;
    } catch {
      // ignore if folder not ready
    }
  }, 1000);

  return new Promise((resolve, reject) => {
    const child = spawn(sevenZipBin, [
      "x",
      archivePath,
      `-o${extractPath}`,
      "-y",
    ]);

    child.on("error", (err) => {
      clearInterval(interval);
      reject(err);
    });

    child.on("close", (code) => {
      clearInterval(interval);

      if (code === 0) {
        parentPort.postMessage({
          type: "progress",
          percent: 100,
          text: "Extraction complete — 100%",
        });
        resolve({ success: true });
      } else {
        reject(new Error(`7z exited with code ${code}`));
      }
    });
  });
}

extractInWorker()
  .then(() => parentPort.postMessage({ type: "done", success: true }))
  .catch((err) =>
    parentPort.postMessage({
      type: "done",
      success: false,
      error: err.message,
    }),
  );
