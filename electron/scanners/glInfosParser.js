const fs = require("fs");
const path = require("path");

const GL_INFOS_FILENAME = "GL_Infos.ini";

function cleanValue(value) {
  return String(value || "").trim();
}

function extractF95ThreadId(threadUrl) {
  const value = cleanValue(threadUrl);
  if (!value) return "";

  const threadMatch = value.match(/\/threads\/(?:[^/?#.\s]+[.\-])?(\d+)(?:[/?#]|$)/i);
  if (threadMatch?.[1]) return threadMatch[1];

  const numericMatch = value.match(/(?:^|[^\d])(\d{3,})(?:[^\d]|$)/);
  return numericMatch?.[1] || "";
}

function parseGlInfosContent(content) {
  const gameList = {};
  let currentSection = "";

  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim().toLowerCase();
      continue;
    }

    if (currentSection !== "gamelist") continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    if (key) gameList[key] = value;
  }

  const threadUrl = cleanValue(gameList.thread);
  const threadF95Id = extractF95ThreadId(threadUrl);

  return {
    version: cleanValue(gameList.version),
    f95Id: threadF95Id,
    title: cleanValue(gameList.name),
    threadUrl,
    source: GL_INFOS_FILENAME,
  };
}

function readGlInfosFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return null;
    }
    return parseGlInfosContent(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.warn(`Failed to parse ${filePath}: ${err.message}`);
    return null;
  }
}

function findGlInfosForGameFolder(gameFolder, selectedExecutable = "") {
  const candidates = [];
  const selectedDir = path.dirname(String(selectedExecutable || ""));
  if (selectedDir && selectedDir !== ".") {
    candidates.push(path.join(gameFolder, selectedDir, GL_INFOS_FILENAME));
  }
  candidates.push(path.join(gameFolder, GL_INFOS_FILENAME));

  const seen = new Set();
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const metadata = readGlInfosFile(candidate);
    if (metadata) {
      return {
        ...metadata,
        filePath: candidate,
        hasGlInfos: true,
      };
    }
  }

  return null;
}

module.exports = {
  extractF95ThreadId,
  parseGlInfosContent,
  findGlInfosForGameFolder,
};
