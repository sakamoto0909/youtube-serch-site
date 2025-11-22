// init-db.js
const sqlite3 = require("sqlite3").verbose();

// database.sqlite というファイルでDBを作る（なければ新規作成）
const db = new sqlite3.Database("./database.sqlite");

db.serialize(() => {
  // videos テーブルを作成（なければ）
  db.run(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      tags_text TEXT DEFAULT ''
    )
  `);

  // とりあえず既存データは全部消して、サンプルを入れ直す
  db.run(`DELETE FROM videos`, [], (err) => {
    if (err) {
      console.error("DELETE error:", err);
      return;
    }

    const stmt = db.prepare(
      "INSERT INTO videos (title, url, tags_text) VALUES (?, ?, ?)"
    );

    stmt.finalize((err2) => {
      if (err2) {
        console.error("finalize error:", err2);
      } else {
        console.log("サンプルデータを videos テーブルに投入しました。");
      }
      db.close();
    });
  });
});
