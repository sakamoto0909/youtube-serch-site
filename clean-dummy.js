// clean-dummy.js
const sqlite3 = require("sqlite3").verbose();

// プロジェクト直下の database.sqlite を開く
const db = new sqlite3.Database("./database.sqlite");

db.serialize(() => {
  console.log("Deleting dummy videos (https://www.example.com/...) ...");

  const sql = `
    DELETE FROM videos
    WHERE url LIKE 'https://www.example.com/%'
  `;

  db.run(sql, [], function (err) {
    if (err) {
      console.error("Error:", err);
    } else {
      console.log(`Deleted rows: ${this.changes}`);
    }
    db.close();
  });
});
