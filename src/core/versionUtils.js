function normalizeAppVersion(version) {
  return String(version || "")
    .trim()
    .replace(/^v/i, "")
    .split("-")[0]
    .split("+")[0];
}

function compareAppVersions(a, b) {
  const aParts = normalizeAppVersion(a)
    .split(".")
    .map((part) => parseInt(part, 10) || 0);
  const bParts = normalizeAppVersion(b)
    .split(".")
    .map((part) => parseInt(part, 10) || 0);
  const length = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < length; i++) {
    const aPart = aParts[i] || 0;
    const bPart = bParts[i] || 0;
    if (aPart > bPart) return 1;
    if (aPart < bPart) return -1;
  }

  return 0;
}

function isNewerVersion(latestVersion, currentVersion) {
  return compareAppVersions(latestVersion, currentVersion) > 0;
}

module.exports = {
  compareAppVersions,
  isNewerVersion,
  normalizeAppVersion,
};
