const sqlite3 = require('sqlite3').verbose()
const dbPath = 'C:\\Users\\D4\\AppData\\Local\\Programs\\Atlas\\data\\data.db'
const db = new sqlite3.Database(dbPath)

db.all(`PRAGMA table_info(lewdcorner_data)`, [], (err, cols) => {
  console.log('Columns in lewdcorner_data:', cols.map(c => c.name))
})

db.all(`PRAGMA table_info(lewdcorner_mappings)`, [], (err, cols) => {
  console.log('Columns in lewdcorner_mappings:', cols.map(c => c.name))
})
