const sqlite3 = require('../node_modules/sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../.n8n/.n8n/database.sqlite');
const db = new sqlite3.Database(dbPath);

db.get("SELECT data FROM execution_data WHERE executionId = 10", [], (err, row) => {
  if (row) {
    const raw = JSON.parse(row.data);
    // n8n flattens strings into an array of strings in raw
    console.log('Flattener array length:', raw.length);
    // Print all strings containing "Download" or "storage" or "status" or "error"
    raw.forEach((item, index) => {
      if (typeof item === 'string' && (item.includes('Download') || item.includes('storage') || item.includes('binary') || item.includes('sourceImage') || item.includes('error') || item.includes('401') || item.includes('403') || item.includes('404') || item.includes('200'))) {
        console.log(`[${index}]: ${item.slice(0, 300)}`);
      }
    });
  }
  db.close();
});
