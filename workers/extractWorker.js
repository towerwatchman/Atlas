// workers/extractWorker.js
const { parentPort, workerData } = require("worker_threads");
const { spawn } = require("child_process");

const { archivePath, extractPath, sevenZipBin } = workerData;

let child = null;
let canceled = false;
let lastPercent = -1;
let lastActivityMessageAt = 0;

function postProgress(percent, text, phase = "extracting") {
  if (typeof percent === "number") {
    const nextPercent = Math.max(0, Math.min(99, Math.floor(percent)));
    if (nextPercent <= lastPercent) return;
    lastPercent = nextPercent;
    parentPort.postMessage({
      type: "progress",
      percent: nextPercent,
      text,
      phase,
    });
    return;
  }

  const now = Date.now();
  if (now - lastActivityMessageAt < 4000) return;
  lastActivityMessageAt = now;
  parentPort.postMessage({ type: "progress", text, phase });
}

function parseSevenZipProgress(chunk) {
  const text = chunk.toString();
  const matches = [...text.matchAll(/(\d{1,3})%/g)];
  if (matches.length > 0) {
    const percent = Number(matches[matches.length - 1][1]);
    if (Number.isFinite(percent)) {
      postProgress(percent, `Extracting... ${Math.min(percent, 99)}%`);
    }
    return;
  }

  if (text.trim()) {
    postProgress(undefined, "Extracting archive...", "extracting");
  }
}

function createCanceledError() {
  const err = new Error("Archive extraction canceled");
  err.code = "IMPORT_CANCELED";
  return err;
}

parentPort.on("message", (message) => {
  if (message !== "cancel") return;
  canceled = true;
  if (child && !child.killed) {
    child.kill();
  }
});

function extractInWorker() {
  return new Promise((resolve, reject) => {
    postProgress(0, "Starting archive extraction...", "starting");

    child = spawn(
      sevenZipBin,
      ["x", archivePath, `-o${extractPath}`, "-y", "-bb0", "-bsp1"],
      { windowsHide: true },
    );

    let output = "";
    child.stdout.on("data", (data) => {
      output += data.toString();
      if (output.length > 12000) output = output.slice(-12000);
      parseSevenZipProgress(data);
    });
    child.stderr.on("data", (data) => {
      output += data.toString();
      if (output.length > 12000) output = output.slice(-12000);
      parseSevenZipProgress(data);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      child = null;
      if (canceled) {
        reject(createCanceledError());
        return;
      }
      if (code === 0) {
        parentPort.postMessage({
          type: "progress",
          percent: 100,
          text: "Extraction complete - 100%",
          phase: "complete",
        });
        resolve();
        return;
      }

      reject(
        new Error(
          `7-Zip extraction failed with exit code ${code}: ${
            output.trim() || "No output"
          }`,
        ),
      );
    });
  });
}

extractInWorker()
  .then(() => {
    parentPort.postMessage({
      type: "done",
      success: true,
      finalPath: extractPath,
    });
  })
  .catch((err) => {
    parentPort.postMessage({
      type: "done",
      success: false,
      canceled: err.code === "IMPORT_CANCELED",
      error: err.message,
    });
  });
