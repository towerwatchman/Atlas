const fs = require('fs');
const path = require('path');
const { searchAtlas, findF95Id, checkRecordExist, checkPathExist } = require('../../database');

const engineMap = {
  rpgm: ['rpgmv.exe', 'rpgmk.exe', 'rpgvx.exe', 'rpgvxace.exe', 'rpgmktranspatch.exe'],
  renpy: ['renpy.exe', 'renpy.sh'],
  unity: ['unityplayer.dll', 'unitycrashhandler64.exe'],
  html: ['index.html'],
  flash: ['.swf']
};

async function startScan(params, window) {
  const { folder, format, gameExt, archiveExt, isCompressed } = params;
  const extensions = isCompressed ? archiveExt : gameExt;
  const games = [];
  let potential = 0;

  console.log(`Starting scan in folder: ${folder} with extensions: ${extensions.join(', ')}`);

  if (isCompressed) {
    const files = fs.readdirSync(folder).map(f => path.join(folder, f));
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (fs.statSync(file).isFile()) {
        console.log(`Scanning file: ${file} (isFile: true)`);
        await findGame(file, format, extensions, folder, 5, true, games, window, params);
        window.webContents.send('scan-progress', { value: i + 1, total: files.length, potential: games.length });
      }
    }
  }

  const directories = fs.readdirSync(folder, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(folder, d.name));
  const totalDirs = directories.length;
  let ittr = 0;

  console.log(`Found ${totalDirs} initial directories to scan: ${directories.join(', ')}`);

  for (const dir of directories) {
    console.log(`Scanning directory: ${dir}`);
    const subdirs = getAllSubdirs(dir);
    let found = false;
    let stopLevel = 15;
    for (const t of subdirs) {
      const level = t.split(path.sep).length - dir.split(path.sep).length;
      if (level <= stopLevel) {
        console.log(`Processing subdirectory: ${t} (level ${level})`);
        const res = await findGame(t, format, extensions, folder, stopLevel, false, games, window, params);
        if (!found && res) {
          found = true;
          stopLevel = level;
        }
      }
    }
    if (!found || isCompressed) {
      const files = fs.readdirSync(dir).map(f => path.join(dir, f));
      console.log(`Checking files in ${dir}: ${files.join(', ')}`);
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (fs.statSync(f).isFile()) {
          console.log(`Scanning file in ${dir}: ${f} (isFile: true)`);
          await findGame(f, format, extensions, folder, stopLevel, true, games, window, params, { creator, title, version });
          window.webContents.send('scan-progress', { value: ittr + 1, total: totalDirs, potential: games.length });
        } else {
          console.log(`Skipping ${f} (not a file)`);
        }
      }
    }
    ittr++;
    potential = games.length;
    window.webContents.send('scan-progress', { value: ittr, total: totalDirs, potential });
  }

  console.log(`Scan complete. Found ${games.length} games: ${games.map(g => g.title).join(', ')}`);
  window.webContents.send('scan-complete', games);
}

function getAllSubdirs(root) {
  const dirs = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    console.log(`Exploring directory: ${current}`);
    const items = fs.readdirSync(current, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        dirs.push(full);
        stack.push(full);
      }
    }
  }
  return dirs;
}

async function findGame(t, format, extensions, rootPath, stopLevel, isFile, games, window, params, metadata = {}) {
  console.log(`Finding game in: ${t} (isFile: ${isFile}) with extensions: ${extensions.join(', ')}`);
  let potentialExecutables = [];
  let singleExecutable = '';
  let selectedValue = '';
  let singleVisible = 'hidden';
  let multipleVisible = 'hidden';
  let gameEngine = ''; // Default to empty string
  let isArchive = false;

  try {
    if (!isFile) {
      console.log(`Checking directory ${t} for files`);
      const files = fs.readdirSync(t);
      potentialExecutables = files.filter(f => {
        const ext = path.extname(f).toLowerCase().slice(1);
        const matches = extensions.includes(ext);
        console.log(`File: ${f}, Extension: ${ext}, Matches: ${matches}`);
        return matches;
      });
      if (potentialExecutables.length === 0) {
        console.log(`No executable files found in ${t}`);
        return false;
      }

      for (const exec of potentialExecutables) {
        for (const [engine, patterns] of Object.entries(engineMap)) {
          if (patterns.some(p => exec.toLowerCase().includes(p))) {
            gameEngine = engine;
            console.log(`Matched engine ${gameEngine} for ${exec}`);
            break;
          }
        }
        if (gameEngine) break;
      }

      if (potentialExecutables.length === 1) {
        singleExecutable = potentialExecutables[0];
        selectedValue = singleExecutable;
        singleVisible = 'visible';
      } else if (potentialExecutables.length > 1) {
        multipleVisible = 'visible';
        selectedValue = potentialExecutables[0];
      }
    } else {
      const ext = path.extname(t).toLowerCase().slice(1);
      console.log(`Checking file ${t}, Extension: ${ext}`);
      if (!extensions.includes(ext)) {
        console.log(`File ${t} has unsupported extension ${ext}`);
        return false;
      }
      isArchive = params.isCompressed;
      singleExecutable = path.basename(t);
      selectedValue = singleExecutable;
      singleVisible = 'visible';
    }

    let title = metadata.title || '';
    let creator = metadata.creator || 'Unknown';
    let version = metadata.version || '';

    const relativePath = t.replace(`${rootPath}${path.sep}`, '');
    console.log(`Relative path: ${relativePath}, Format: ${format}`);
    if (format && format.trim() !== '' && !isFile) {
      const pathParts = relativePath.split(path.sep);
      console.log(`Path parts: ${pathParts.join(', ')}`);
      const formatParts = format.split('/').map(part => part.replace(/\{|\}/g, ''));
      if (pathParts.length === formatParts.length) {
        const mapping = {};
        formatParts.forEach((part, index) => {
          mapping[part] = pathParts[index];
        });
        creator = mapping.creator || 'Unknown';
        title = mapping.title || '';
        version = mapping.version || '';
        console.log(`Structured match: creator=${creator}, title=${title}, version=${version}`);
      } else {
        console.log(`Path parts (${pathParts.length}) do not match format parts (${formatParts.length}) for ${relativePath}`);
      }
    } else if (isFile && metadata.title) {
      // Use metadata from directory for file
      title = metadata.title;
      creator = metadata.creator;
      version = metadata.version;
      console.log(`Using metadata for file: creator=${creator}, title=${title}, version=${version}`);
    } else {
      let filename = isFile ? path.basename(t, path.extname(t)) : path.basename(t);
      console.log(`Parsing filename: ${filename}`);
      filename = filename.replace(/\[(.*?)\]/g, '$1').trim();
      const parts = filename.split('-').map(p => p.trim());
      if (parts.length > 0) {
        let versionIndex = -1;
        for (let i = parts.length - 1; i >= 0; i--) {
          if (/^\d+(\.\d+)?$/.test(parts[i])) {
            versionIndex = i;
            break;
          }
        }
        if (versionIndex >= 0) {
          version = parts[versionIndex];
          title = parts.slice(0, versionIndex).join(' ');
        } else {
          title = parts.join(' ');
          version = '1.0';
        }
        console.log(`Parsed: title=${title}, version=${version}`);
      }
    }

    if (!title || title.trim() === '') {
      console.log(`No valid title extracted from ${t}, parsing failed`);
      return false;
    }

    console.log(`Processing game: ${title}, Creator: ${creator}, Version: ${version}, Engine: ${gameEngine}`); // Use gameEngine
    const data = await searchAtlas(title, creator);
    let atlasId = '';
    let f95Id = '';
    let results = [];
    if (data.length === 1) {
      atlasId = data[0].atlas_id;
      f95Id = await findF95Id(atlasId);
      title = data[0].title;
      creator = data[0].creator;
      gameEngine = data[0].engine || gameEngine; // Use gameEngine
    } else if (data.length > 1) {
      results = data.map(d => ({ key: d.atlas_id, value: `${d.atlas_id} | ${d.title} | ${d.creator}` }));
    }

    const recordExist = await checkRecordExist(title, creator, gameEngine, version, t); // Use gameEngine

    if (!recordExist) {
      const gd = {
        atlasId,
        f95Id,
        title,
        creator,
        engine: gameEngine, // Use gameEngine
        version,
        singleExecutable,
        executables: potentialExecutables.map(e => ({ key: e, value: e })),
        selectedValue,
        singleVisible,
        multipleVisible,
        folder: t,
        results,
        resultSelectedValue: results[0]?.key || '',
        resultVisibility: results.length > 0 ? 'visible' : 'hidden',
        recordExist,
        isArchive
      };
      console.log(`Adding game to list: ${JSON.stringify(gd)}`);
      games.push(gd);
      window.webContents.send('scan-progress', { value: games.length, total: totalDirs, potential: games.length });
      return true;
    }
    console.log(`Game ${title} already exists or failed to add`);
    return false;
  } catch (err) {
    console.error(`Error processing ${t}: ${err.message}`);
    return false;
  }
}

module.exports = { startScan };