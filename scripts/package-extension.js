'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const extDir = path.join(rootDir, 'extension');
const iconDir = path.join(extDir, 'icons');
const srcLogo = path.join(rootDir, 'logo.png');
const targetLogo = path.join(iconDir, 'logo.png');
const outDir = path.join(rootDir, 'release');
const zipFile = path.join(outDir, 'atlas-extension.zip');

async function buildExtension() {
  console.log('[Packaging Extension] Preparing extension build...');

  if (!fs.existsSync(iconDir)) {
    await fsp.mkdir(iconDir, { recursive: true });
  }

  if (fs.existsSync(srcLogo)) {
    await fsp.copyFile(srcLogo, targetLogo);
    console.log('[Packaging Extension] Copied logo.png to extension/icons/logo.png');
  }

  if (!fs.existsSync(outDir)) {
    await fsp.mkdir(outDir, { recursive: true });
  }

  if (fs.existsSync(zipFile)) {
    await fsp.unlink(zipFile);
  }

  if (process.platform === 'win32') {
    const cmd = `powershell -Command "Compress-Archive -Path '${extDir}\\*' -DestinationPath '${zipFile}' -Force"`;
    execSync(cmd, { stdio: 'inherit' });
  } else {
    const cmd = `cd "${extDir}" && zip -r "${zipFile}" .`;
    execSync(cmd, { stdio: 'inherit' });
  }

  console.log(`[Packaging Extension] Extension successfully packaged at: ${zipFile}`);
}

buildExtension().catch((err) => {
  console.error('[Packaging Extension] Error packaging extension:', err);
  process.exit(1);
});
