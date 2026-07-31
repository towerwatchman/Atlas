'use strict'

const dbModule = require('./index')
const getDb = () => dbModule.db


const saveEmulatorConfig = (emulator) => {
  return new Promise((resolve, reject) => {
    getDb().run(
      `INSERT OR REPLACE INTO emulators (extension, program_path, parameters) VALUES (?, ?, ?)`,
      [emulator.extension, emulator.program_path, emulator.parameters || ""],
      (err) => {
        if (err) {
          console.error("Error saving emulator config:", err);
          reject(err);
        } else {
          resolve();
        }
      },
    );
  });
};

const getEmulatorConfig = () => {
  return new Promise((resolve, reject) => {
    getDb().all(
      `SELECT extension, program_path, parameters FROM emulators`,
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

const removeEmulatorConfig = (extension) => {
  return new Promise((resolve, reject) => {
    getDb().run(`DELETE FROM emulators WHERE extension = ?`, [extension], (err) => {
      if (err) {
        console.error("Error removing emulator config:", err);
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

const getEmulatorByExtension = (extension) => {
  // Normalised both sides: the launcher passes a bare lowercase extension, but
  // what the settings UI stored could carry a leading dot or different case, and
  // an exact match would silently miss it.
  const normalized = String(extension ?? '').trim().replace(/^\.+/, '').toLowerCase()
  return new Promise((resolve, reject) => {
    if (!normalized) return resolve(undefined)
    getDb().get(
      `SELECT * FROM emulators
        WHERE LOWER(LTRIM(extension, '.')) = ?
        LIMIT 1`,
      [normalized],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      },
    );
  });
};

//STEAM SPECIFIC FUNCTIONS

module.exports = {
  saveEmulatorConfig,
  getEmulatorConfig,
  removeEmulatorConfig,
  getEmulatorByExtension,
}
