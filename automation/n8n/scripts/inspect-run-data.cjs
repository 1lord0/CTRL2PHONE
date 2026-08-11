const sqlite3 = require('../node_modules/sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../.n8n/.n8n/database.sqlite');
const db = new sqlite3.Database(dbPath);

db.get("SELECT data FROM execution_data WHERE executionId = 10", [], (err, row) => {
  if (row) {
    const dataStr = row.data;
    console.log('Execution 10 data length:', dataStr.length);
    // Find "Download Private Image" node output
    const idx = dataStr.indexOf('Download Private Image');
    if (idx !== -1) {
      console.log('Download Private Image context in log:');
      console.log(dataStr.slice(idx - 200, idx + 1000));
    } else {
      console.log('Download Private Image not found in log string');
    }
  }
  db.close();
});
