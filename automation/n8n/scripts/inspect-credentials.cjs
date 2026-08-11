const sqlite3 = require('../node_modules/sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../.n8n/.n8n/database.sqlite');
const db = new sqlite3.Database(dbPath);

db.all('SELECT * FROM webhook_entity', [], (err, rows) => {
  console.log('Webhooks in DB:', rows);
  db.close();
});
