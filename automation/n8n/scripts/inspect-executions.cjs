const sqlite3 = require('../node_modules/sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../.n8n/.n8n/database.sqlite');
const db = new sqlite3.Database(dbPath);

db.all("SELECT id, finished, mode, status, workflowId FROM execution_entity ORDER BY id DESC LIMIT 5", [], (err, rows) => {
  console.log('Recent Executions:', err ? err.message : rows);
  db.all("SELECT * FROM execution_data ORDER BY executionId DESC LIMIT 5", [], (err2, rows2) => {
    console.log('Execution Data:', err2 ? err2.message : rows2?.map(r => ({ id: r.executionId, data: r.data?.slice(0, 500) })));
    db.close();
  });
});
