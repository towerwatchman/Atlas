const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { searchAtlas, getSteamIDbyRecord, getBannerUrl, getScreensUrlList, downloadAndConvertBanner, downloadAndConvertScreens } = require('../../database');

async function getSteamGameData(steamId) {
  try {
    const steamResponse = await fetch(`https://store.steampowered.com/api/appdetails?appids=${steamId}`);
    const steamJson = await steamResponse.json();
    if (!steamJson[steamId] || !steamJson[steamId].success) {
      return null;
    }
    const data = steamJson[steamId].data;

    const spyResponse = await fetch(`https://steamspy.com/api.php?request=appdetails&appid=${steamId}`);
    const spy = await spyResponse.json();

    const langHtml = data.supported_languages || '';
    const languages = langHtml.replace(/<strong>\*<\/strong>/g, '*').split(',').map(l => l.trim());
    const voiceLangs = languages.filter(l => l.endsWith('*')).map(l => l.replace(/\*$/, '').trim());
    const textLangs = languages.map(l => l.replace(/\*$/, '').trim());

    const osArr = [];
    if (data.platforms.windows) osArr.push('Windows');
    if (data.platforms.mac) osArr.push('Mac');
    if (data.platforms.linux) osArr.push('Linux');

    const possibleEngines = ['Unity', 'Unreal Engine', 'Godot', 'RPG Maker'];
    const engine = Object.keys(spy.tags || {}).find(tag => possibleEngines.includes(tag)) || '';

    const censored = (data.required_age > 0 || (data.content_descriptors && data.content_descriptors.ids && data.content_descriptors.ids.length > 0)) ? 'yes' : 'no';

    const screenshots = data.screenshots ? data.screenshots.map(s => s.path_full) : [];

    const game = {
      steam_id: parseInt(steamId),
      title: data.name || '',
      category: data.categories ? data.categories.map(c => c.description).join(',') : '',
      engine: engine,
      developer: data.developers ? data.developers.join(',') : '',
      publisher: data.publishers ? data.publishers.join(',') : '',
      overview: data.detailed_description || '',
      censored: censored,
      language: textLangs.join(','),
      translations: textLangs.join(','),
      genre: data.genres ? data.genres.map(g => g.description).join(',') : '',
      tags: spy.tags ? Object.keys(spy.tags).join(',') : '',
      voice: voiceLangs.join(','),
      os: osArr.join(','),
      release_state: data.release_date.coming_soon ? 'upcoming' : 'released',
      release_date: data.release_date.date || '',
      header: data.header_image || '',
      library_hero: `https://steamcdn-a.akamaihd.net/steam/apps/${steamId}/library_hero.jpg`,
      logo: `https://steamcdn-a.akamaihd.net/steam/apps/${steamId}/library_600x900.jpg`,
      last_record_update: new Date().toISOString()
    };

    return { game, screenshots };
  } catch (error) {
    console.error('Error fetching game data:', error);
    return null;
  }
}

async function insertSteamData(db, data) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO steam_data (
        steam_id, atlas_id, title, category, engine, developer, publisher, overview, censored, language, translations, genre, tags, voice, os, release_state, release_date, header, library_hero, logo, last_record_update
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.steam_id, data.atlas_id || null, data.title, data.category, data.engine, data.developer, data.publisher, data.overview, data.censored, data.language, data.translations, data.genre, data.tags, data.voice, data.os, data.release_state, data.release_date, data.header, data.library_hero, data.logo, data.last_record_update],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

async function insertSteamScreens(db, steamId, screens) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      const stmt = db.prepare(`INSERT OR IGNORE INTO steam_screens (steam_id, screen_url) VALUES (?, ?)`);
      for (const url of screens) {
        stmt.run([steamId, url]);
      }
      stmt.finalize();
      db.run('COMMIT', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

async function getSteamLibraryFolders() {
  let steamPath;
  if (process.platform === 'win32') {
    steamPath = path.join('C:', 'Program Files (x86)', 'Steam');
  } else if (process.platform === 'darwin') {
    steamPath = path.join(os.homedir(), 'Library', 'Application Support', 'Steam');
  } else if (process.platform === 'linux') {
    steamPath = path.join(os.homedir(), '.steam', 'steam');
  }
  if (!fs.existsSync(steamPath)) {
    throw new Error('Steam installation not found');
  }
  const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  const vdfContent = await fs.readFile(vdfPath, 'utf8');
  const libraries = [path.join(steamPath, 'steamapps')];
  const lines = vdfContent.split('\n');
  for (const line of lines) {
    const match = line.match(/\s*"\d+"\s*"(.+)"\s*/);
    if (match) {
      libraries.push(path.join(match[1].replace(/\\\\/g, '\\'), 'steamapps'));
    }
  }
  return libraries;
}

async function getInstalledSteamGames() {
  const libraries = await getSteamLibraryFolders();
  const games = [];
  for (const lib of libraries) {
    const files = await fs.readdir(lib);
    for (const file of files) {
      if (file.startsWith('appmanifest_') && file.endsWith('.acf')) {
        const appid = file.replace('appmanifest_', '').replace('.acf', '');
        const acfContent = await fs.readFile(path.join(lib, file), 'utf8');
        const nameMatch = acfContent.match(/"name"\s*"(.+)"/);
        const installDirMatch = acfContent.match(/"installdir"\s*"(.+)"/);
        const sizeMatch = acfContent.match(/"SizeOnDisk"\s*"(\d+)"/);
        if (nameMatch && installDirMatch) {
          games.push({
            appid,
            name: nameMatch[1],
            installDir: path.join(lib, 'common', installDirMatch[1]),
            size: sizeMatch ? parseInt(sizeMatch[1]) : 0
          });
        }
      }
    }
  }
  return games;
}

async function startSteamScan(db, params, event) {
  try {
    const installedGames = await getInstalledSteamGames();
    const gamesList = [];
    let value = 0;
    const total = installedGames.length;
    let potential = 0;
    event.sender.send('scan-progress', { value, total, potential });
    for (const steamGame of installedGames) {
      const { game: data, screenshots } = await getSteamGameData(steamGame.appid);
      if (!data) continue;
      potential++;
      event.sender.send('scan-progress', { value, total, potential });
      const searchResults = await searchAtlas(data.title, data.developer);
      const game = {
        title: data.title,
        creator: data.developer,
        engine: data.engine || 'Unknown',
        version: 'Steam',
        folder: steamGame.installDir,
        executables: [{ key: 'steam', value: 'Launch via Steam' }],
        selectedValue: 'steam',
        multipleVisible: 'hidden',
        singleExecutable: 'Launch via Steam',
        atlasId: '',
        f95Id: '',
        steamId: data.steam_id,
        folderSize: steamGame.size,
        results: [],
        resultVisibility: 'visible',
        resultSelectedValue: 'match'
      };
      if (searchResults.length === 0) {
        game.results = [{ key: 'match', value: 'No match found - Added as Steam game' }];
        game.resultVisibility = 'hidden';
      } else {
        game.results = searchResults.map(r => ({
          key: r.atlas_id,
          value: `${r.atlas_id} | ${r.f95_id || ''} | ${r.title} | ${r.creator}`
        }));
        if (searchResults.length === 1) {
          game.atlasId = searchResults[0].atlas_id;
          game.f95Id = searchResults[0].f95_id || '';
          game.resultSelectedValue = game.results[0].key;
          game.resultVisibility = 'hidden';
        } else {
          game.results.unshift({ key: 'match', value: 'Multiple matches found' });
          game.resultSelectedValue = 'match';
        }
      }
      gamesList.push(game);
      event.sender.send('scan-complete', game);
      value++;
      event.sender.send('scan-progress', { value, total, potential });
    }
    event.sender.send('scan-complete-final', gamesList);
    return { success: true };
  } catch (error) {
    console.error('Steam scan error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  getSteamGameData,
  insertSteamData,
  insertSteamScreens,
  getSteamLibraryFolders,
  getInstalledSteamGames,
  startSteamScan
};