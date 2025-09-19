const fs = require('fs');
const path = require('path');
const { searchAtlas, findF95Id, checkRecordExist } = require('../../database');

const engineMap = {
  rpgm: ['rpgmv.exe', 'rpgmk.exe', 'rpgvx.exe', 'rpgvxace.exe', 'rpgmktranspatch.exe'],
  renpy: ['renpy.exe', 'renpy.sh'],
  unity: ['unityplayer.dll'],
  html: ['index.html'],
  flash: ['.swf']
};

const blacklist = [
  'UnityCrashHandler64.exe',
  'UnityCrashHandler32.exe',
  'payload.exe',
  'nwjc.exe',
  'notification_helper.exe',
  'nacl64.exe',
  'chromedriver.exe',
  'Squirrel.exe',
  'zsync.exe',
  'zsyncmake.exe',
  'cmake.exe',
  'pythonw.exe',
  'python.exe',
  'dxwebsetup.exe',
  'README.html',
  'manual.htm',
  'unins000.exe',
  'UE4PrereqSetup_X64.exe',
  'UEPrereqSetup_x64.exe',
  'credits.html',
  'LICENSES.chromium.html',
  'Uninstall.exe',
  'CONFIG_dl.exe'
];

async function startScan(params, window) {
  const { folder, format, gameExt, archiveExt, isCompressed, deleteAfter, scanSize, downloadBannerImages, downloadPreviewImages, previewLimit, downloadVideos } = params;
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
        const success = await findGame(file, format, extensions, folder, 5, true, games, window, params, []);
        if (success) {
          potential = games.length;
          window.webContents.send('scan-complete', games[games.length - 1]); // Send each game incrementally
        }
        window.webContents.send('scan-progress', { value: i + 1, total: files.length, potential });
      }
    }
  } else {
    const directories = fs.readdirSync(folder, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => path.join(folder, d.name));
    const totalDirs = directories.length + 1; // Include root folder
    let ittr = 0;

    console.log(`Found ${totalDirs} directories to scan (including root): ${folder}, ${directories.join(', ')}`);

    // Scan files in the root folder first
    console.log(`Scanning root directory: ${folder}`);
    ittr++;
    const rootFiles = fs.readdirSync(folder, { withFileTypes: true })
      .filter(f => f.isFile())
      .map(f => path.join(folder, f.name));
    console.log(`Checking files in ${folder}: ${rootFiles.join(', ')}`);
    let foundInRoot = false;
    const rootExecutables = rootFiles.filter(f => extensions.includes(path.extname(f).toLowerCase().slice(1)) && !blacklist.includes(path.basename(f)));
    if (rootExecutables.length > 0) {
      console.log(`Scanning root directory with executables: ${folder} (isFile: false)`);
      const res = await findGame(folder, format, extensions, folder, 0, false, games, window, params, rootExecutables);
      if (res) {
        foundInRoot = true;
        potential = games.length;
        window.webContents.send('scan-complete', games[games.length - 1]); // Send each game incrementally
      }
    }
    window.webContents.send('scan-progress', { value: ittr, total: totalDirs, potential });

    // Scan top-level directories if no match in root or deeper scanning is needed
    if (!foundInRoot) {
      for (const dir of directories) {
        console.log(`Scanning directory: ${dir}`);
        ittr++;
        // Check files in the current directory
        const files = fs.readdirSync(dir, { withFileTypes: true })
          .filter(f => f.isFile())
          .map(f => path.join(dir, f.name));
        console.log(`Checking files in ${dir}: ${files.join(', ')}`);
        let found = false;
        const dirExecutables = files.filter(f => extensions.includes(path.extname(f).toLowerCase().slice(1)) && !blacklist.includes(path.basename(f)));
        if (dirExecutables.length > 0) {
          console.log(`Scanning directory with executables: ${dir} (isFile: false)`);
          const res = await findGame(dir, format, extensions, folder, 0, false, games, window, params, dirExecutables);
          if (res) {
            found = true;
            potential = games.length;
            window.webContents.send('scan-complete', games[games.length - 1]); // Send each game incrementally
          }
        }
        // Only scan subdirectories if no match was found
        if (!found) {
          const maxDepth = format && format.trim() !== '' ? 3 : Infinity; // Limit to 3 levels for structured format
          const subdirs = getAllSubdirs(dir, folder, maxDepth);
          // Filter directories matching the expected format (e.g., {creator}/{title}/{version})
          const versionDirs = format && format.trim() !== ''
            ? subdirs.filter(subdir => {
                const relativePath = subdir.replace(`${folder}${path.sep}`, '');
                const pathParts = relativePath.split(path.sep);
                return pathParts.length === 3; // e.g., ArcGames/Corrupted Kingdoms/0.19.4
              })
            : subdirs;
          console.log(`Version directories for ${dir}: ${versionDirs.join(', ')}`);
          for (const t of versionDirs) {
            console.log(`Processing version directory: ${t}`);
            const filesInSubdir = fs.readdirSync(t, { withFileTypes: true })
              .filter(f => f.isFile())
              .map(f => path.join(t, f.name));
            console.log(`Checking files in ${t}: ${filesInSubdir.join(', ')}`);
            const subdirExecutables = filesInSubdir.filter(f => extensions.includes(path.extname(f).toLowerCase().slice(1)) && !blacklist.includes(path.basename(f)));
            if (subdirExecutables.length > 0) {
              console.log(`Scanning version Directory with executables: ${t} (isFile: false)`);
              const res = await findGame(t, format, extensions, folder, 0, false, games, window, params, subdirExecutables);
              if (res) {
                found = true;
                potential = games.length;
                window.webContents.send('scan-complete', games[games.length - 1]); // Send each game incrementally
              }
            }
          }
        }
        window.webContents.send('scan-progress', { value: ittr, total: totalDirs, potential });
      }
    }
  }

  console.log(`Scan complete. Total games found: ${games.length}`);
  // Send final scan-complete to ensure any remaining games are processed
  window.webContents.send('scan-complete-final', games);
}

function getAllSubdirs(root, basePath, maxDepth = Infinity) {
  const dirs = [];
  const stack = [{ path: root, depth: 0 }];
  while (stack.length) {
    const { path: current, depth } = stack.pop();
    if (depth >= maxDepth) continue; // Skip if depth exceeds limit
    console.log(`Exploring directory: ${current}`);
    const items = fs.readdirSync(current, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        dirs.push(full);
        stack.push({ path: full, depth: depth + 1 });
      }
    }
  }
  return dirs;
}

async function findGame(t, format, extensions, rootPath, stopLevel, isFile, games, window, params, executables) {
  console.log(`Finding game in: ${t} (isFile: ${isFile}) with extensions: ${extensions.join(', ')}`);
  let potentialExecutables = executables || [];
  let singleExecutable = '';
  let selectedValue = '';
  let singleVisible = 'hidden';
  let multipleVisible = 'hidden';
  let gameEngine = '';
  let isArchive = false;

  try {
    if (!isFile) {
      if (potentialExecutables.length === 0) {
        console.log(`No executable files provided for ${t}`);
        return false;
      }

      // Use only filenames for executables
      potentialExecutables = potentialExecutables.map(f => path.basename(f));

      // Sort executables: non-32-bit first, -32 last
      potentialExecutables.sort((a, b) => {
        const aIs32 = a.includes('-32');
        const bIs32 = b.includes('-32');
        if (aIs32 && !bIs32) return 1; // -32 goes to bottom
        if (!aIs32 && bIs32) return -1; // non-32 stays at top
        return 0;
      });

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
        selectedValue = potentialExecutables[0]; // Default to first (non-32-bit if available)
      }
    } else {
     丧病
      const ext = path.extname(t).toLowerCase().slice(1);
      console.log(`Checking file ${t}, Extension: ${ext}`);
      if (!extensions.includes(ext) || blacklist.includes(path.basename(t))) {
        console.log(`File ${t} has unsupported extension ${ext} or is blacklisted`);
        return false;
      }
      isArchive = params.isCompressed;
      singleExecutable = path.basename(t);
      selectedValue = singleExecutable;
      singleVisible = 'visible';
      potentialExecutables = [singleExecutable]; // Use filename only
    }

    let title = '';
    let creator = 'Unknown';
    let version = '';

    const relativePath = t.replace(`${rootPath}${path.sep}`, '');
    console.log(`Relative path: ${relativePath}, Format: ${format}`);
    if (format && format.trim() !== '') {
      // For files, use the parent directory structure; for directories, use the current path
      const parsePath = isFile ? path.dirname(relativePath) : relativePath;
      const pathParts = parsePath.split(path.sep);
      console.log(`Path parts: ${pathParts.join(', ')}`);
      const formatParts = format.split('/').map(part => part.replace(/\{|\}/g, ''));
      if (pathParts.length >= formatParts.length) {
        const mapping = {};
        formatParts.forEach((part, index) => {
          mapping[part] = pathParts[index] || '';
        });
        creator = mapping.creator || 'Unknown';
        title = mapping.title || '';
        version = mapping.version || '';
        console.log(`Structured match: creator=${creator}, title=${title}, version=${version}`);
      } else {
        console.log(`Path parts (${pathParts.length}) do not match format parts (${formatParts.length}) for ${parsePath}`);
      }
    }

    // Fallback to filename parsing if structured parsing fails or no format is provided
    if (!title || title.trim() === '') {
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

    console.log(`Processing game: ${title}, Creator: ${creator}, Version: ${version}, Engine: ${gameEngine}`);
    const data = await searchAtlas(title, creator);
    let atlasId = '';
    let f95Id = '';
    let results = [];
    if (data.length === 1) {
      atlasId = data[0].atlas_id;
      f95Id = data[0].f95_id || '';
      title = data[0].title;
      creator = data[0].creator;
      gameEngine = data[0].engine || gameEngine;
      results = [{ key: 'match', value: 'Match Found' }]; // Single match indicator
    } else if (data.length > 1) {
      results = data.map(d => ({ key: d.atlas_id, value: `${d.atlas_id} | ${d.f95_id || ''} | ${d.title} | ${d.creator}` }));
    }

    // Ensure engine is not empty to avoid SQLite errors
    const engine = gameEngine || 'Unknown';
    let recordExist = false;
    try {
      recordExist = await checkRecordExist(title, creator, version);
    } catch (err) {
      console.error(`Error checking record existence for ${title}: ${err.message}`);
      return false;
    }

    if (!recordExist) {
      const gd = {
        atlasId,
        f95Id,
        title,
        creator,
        engine,
        version,
        singleExecutable,
        executables: potentialExecutables.map(e => ({ key: e, value: e })),
        selectedValue,
        singleVisible,
        multipleVisible,
        folder: isFile ? path.dirname(t) : t, // Use directory for folder, not file path
        results,
        resultSelectedValue: results[0]?.key || '',
        resultVisibility: results.length > 0 ? 'visible' : 'hidden',
        recordExist,
        isArchive
      };
      console.log(`Adding game to list: ${JSON.stringify(gd)}`);
      games.push(gd);
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