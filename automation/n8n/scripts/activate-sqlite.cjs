const sqlite3 = require('../node_modules/sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../.n8n/.n8n/database.sqlite');
console.log('Opening SQLite DB:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to open DB:', err);
    process.exit(1);
  }
});

db.all('SELECT id, name, active FROM workflow_entity', [], (err, rows) => {
  if (err) {
    console.error('Failed to select workflows:', err);
  } else {
    console.log('Current workflows in DB:', rows);
  }

  db.run('UPDATE workflow_entity SET active = 1', [], function(err2) {
    if (err2) {
      console.error('Failed to update active state:', err2);
    } else {
      console.log(`Updated ${this.changes} workflows to active = 1`);
    }

    db.close();
  });
});
