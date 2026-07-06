// workers/extractWorker.js
const { parentPort, workerData } = require("worker_threads");
const { spawn } = require("child_process");
const fs = require("fs");

const {
  archivePath,
  extractPath,
  sevenZipBin,
  useBundledRarExtractor,
  rarWasmPath,
} = workerData;

let child = null;
let canceled = false;
let lastPercent = -1;
let lastActivityMessageAt = 0;

function formatPercent(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "0%";
  const roundedValue = Math.ceil(Math.min(100, Math.max(0, numericValue)) * 10) / 10;
  return Number.isInteger(roundedValue)
    ? `${roundedValue}%`
    : `${roundedValue.toFixed(1)}%`;
}

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
      postProgress(percent, `Extracting... ${formatPercent(Math.min(percent, 99))}`);
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

async function extractRarInWorker() {
  const { createExtractorFromFile } = require("node-unrar-js");
  const wasmBinary = fs.readFileSync(rarWasmPath);
  postProgress(0, "Starting bundled RAR extraction...", "starting");

  const extractor = await createExtractorFromFile({
    filepath: archivePath,
    targetPath: extractPath,
    wasmBinary,
  });
  const headers = [...extractor.getFileList().fileHeaders];
  const totalFiles = headers.filter((header) => !header.flags.directory).length;
  const extracted = extractor.extract();
  let extractedCount = 0;

  for (const file of extracted.files) {
    if (canceled) throw createCanceledError();
    if (file.fileHeader.flags.directory) continue;
    extractedCount += 1;
    const percent = totalFiles > 0
      ? Math.min(99, Math.floor((extractedCount / totalFiles) * 100))
      : undefined;
    postProgress(percent, `Extracting RAR... ${extractedCount}/${totalFiles || "?"}`);
  }

  if (extractedCount === 0) {
    throw new Error("RAR extraction completed but no files were extracted");
  }
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

const extraction = useBundledRarExtractor
  ? extractRarInWorker()
  : extractInWorker();

extraction
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
