const sqlite3 = require('../node_modules/sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../.n8n/.n8n/database.sqlite');
const db = new sqlite3.Database(dbPath);

db.all("SELECT id, finished, mode, status, workflowId FROM execution_entity ORDER BY id DESC LIMIT 5", [], (err, rows) => {
  console.log('Recent Executions:', rows);
  if (rows && rows.length > 0) {
    const lastId = rows[0].id;
    db.get("SELECT data FROM execution_data WHERE executionId = ?", [lastId], (err2, row) => {
      if (row) {
        console.log(`--- Execution ${lastId} (${rows[0].workflowId}, status: ${rows[0].status}) ---`);
        console.log(row.data.slice(0, 3500));
      }
      db.close();
    });
  } else {
    db.close();
  }
});
