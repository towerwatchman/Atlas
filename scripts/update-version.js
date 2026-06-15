const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// Split version into major, minor, patch
const versionParts = packageJson.version.split('.').map(Number);
versionParts[2] += 1; // Increment patch version
packageJson.version = versionParts.join('.');

// Write updated package.json back to file
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
console.log(`Version updated to ${packageJson.version}`);