'use strict'

const dbModule = require('./index')
const getDb = () => dbModule.db


// How a mapping's key is read. 'extension' matches every file with that
// suffix; 'filename' matches one exact file name. Anything else is treated as
// 'extension', which is what every row written before file-name matching
// existed is.
const EMULATOR_MATCH_TYPES = ['extension', 'filename']

const normalizeMatchType = (value) =>
  EMULATOR_MATCH_TYPES.includes(String(value || '')) ? String(value) : 'extension'

// Keys are stored already normalised so that what the settings UI accepted
// ("EXE", ".exe", "Game.SH") cannot silently fail to match at launch. Matching
// is case-insensitive on both sides — on Linux that is technically laxer than
// the filesystem, but a user who types "Game.sh" for a file called "game.sh"
// meant that file, and a mapping that quietly never fires is the worse bug.
//
// The dot is the difference between the two kinds: an extension has its
// leading dots stripped ("sh"), a file name keeps everything ("game.sh").
const normalizeEmulatorKey = (value, matchType) => {
  const trimmed = String(value ?? '').trim()
  if (normalizeMatchType(matchType) === 'filename') {
    // Someone who browsed to the file (or pasted a path) means the file, not
    // the path — keeping the directory would tie the mapping to one install
    // location and break the moment the game is moved or reinstalled.
    return (trimmed.split(/[\\/]/).pop() || '').toLowerCase()
  }
  return trimmed.replace(/^\.+/, '').toLowerCase()
}

// Which SQL expression turns the stored key into its comparable form. Split
// out because the two kinds normalise differently and every lookup, delete and
// write below has to agree with normalizeEmulatorKey above.
const keyExpressionFor = (matchType) =>
  matchType === 'filename' ? "LOWER(extension)" : "LOWER(LTRIM(extension, '.'))"

const saveEmulatorConfig = (emulator) => {
  const matchType = normalizeMatchType(emulator?.match_type ?? emulator?.matchType)
  const key = normalizeEmulatorKey(emulator?.extension, matchType)
  return new Promise((resolve, reject) => {
    if (!key) {
      reject(new Error('An emulator mapping needs a file extension or a file name.'))
      return
    }
    getDb().run(
      `INSERT OR REPLACE INTO emulators (extension, program_path, parameters, match_type)
       VALUES (?, ?, ?, ?)`,
      [key, emulator.program_path, emulator.parameters || "", matchType],
      (err) => {
        if (err) {
          console.error("Error saving emulator config:", err);
          reject(err);
        } else {
          resolve({ extension: key, program_path: emulator.program_path, parameters: emulator.parameters || "", match_type: matchType });
        }
      },
    );
  });
};

const getEmulatorConfig = () => {
  return new Promise((resolve, reject) => {
    getDb().all(
      `SELECT extension, program_path, parameters, COALESCE(match_type, 'extension') AS match_type
         FROM emulators`,
      [],
      (err, rows) => {
        if (err) {
          console.error("Error fetching emulator config:", err);
          reject(err);
        } else {
          resolve(rows || []);
        }
      },
    );
  });
};

// The match type has to travel with the delete now that two rows can share a
// key string. Callers that pass nothing mean the extension mapping — that is
// the only kind that existed when this took one argument.
const removeEmulatorConfig = (key, matchType) => {
  const type = normalizeMatchType(matchType)
  const normalized = normalizeEmulatorKey(key, type)
  return new Promise((resolve, reject) => {
    if (!normalized) return resolve()
    getDb().run(
      `DELETE FROM emulators
        WHERE COALESCE(match_type, 'extension') = ?
          AND ${keyExpressionFor(type)} = ?`,
      [type, normalized],
      (err) => {
        if (err) {
          console.error("Error removing emulator config:", err);
          reject(err);
        } else {
          resolve();
        }
      },
    );
  });
};

const getEmulatorByExtension = (extension) => {
  // Normalised both sides: the launcher passes a bare lowercase extension, but
  // what the settings UI stored could carry a leading dot or different case, and
  // an exact match would silently miss it.
  const normalized = normalizeEmulatorKey(extension, 'extension')
  return new Promise((resolve, reject) => {
    if (!normalized) return resolve(undefined)
    getDb().get(
      `SELECT * FROM emulators
        WHERE COALESCE(match_type, 'extension') = 'extension'
          AND LOWER(LTRIM(extension, '.')) = ?
        LIMIT 1`,
      [normalized],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      },
    );
  });
};

// The exact-file mapping: ".sh" says how to run every shell script, "game.sh"
// says how to run one of them.
const getEmulatorByFileName = (fileName) => {
  const normalized = normalizeEmulatorKey(fileName, 'filename')
  return new Promise((resolve, reject) => {
    if (!normalized) return resolve(undefined)
    getDb().get(
      `SELECT * FROM emulators
        WHERE COALESCE(match_type, 'extension') = 'filename'
          AND LOWER(extension) = ?
        LIMIT 1`,
      [normalized],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      },
    );
  });
};

// What the launcher asks. The specific mapping beats the general one: a user
// who configured "game.sh" did so BECAUSE the ".sh" rule was wrong for it, so
// letting the extension win would leave no way to express the exception.
const getEmulatorForFile = async ({ fileName, extension }) => {
  const byFileName = await getEmulatorByFileName(fileName)
  if (byFileName) return byFileName
  return getEmulatorByExtension(extension)
};

//STEAM SPECIFIC FUNCTIONS

module.exports = {
  saveEmulatorConfig,
  getEmulatorConfig,
  removeEmulatorConfig,
  getEmulatorByExtension,
  getEmulatorByFileName,
  getEmulatorForFile,
  normalizeEmulatorKey,
  normalizeMatchType,
  EMULATOR_MATCH_TYPES,
}
