// server.js
const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const session = require("express-session");

const app = express();

// ==== SQLite DB オープン ====
const db = new sqlite3.Database("./database.sqlite");

// ==== ミドルウェア ====
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-this-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 1週間
    },
  })
);

// ==== ルート: index.html を返す ====
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ==== ヘルパ: YouTube API を叩いて JSON を返す ====
async function fetchJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text();
    console.error("YouTube API HTTP error:", resp.status, text);
    throw new Error(`YouTube API error: ${resp.status}`);
  }
  return resp.json();
}

// ==== URL から videoId / playlistId を抽出するヘルパ ====
function extractVideoIdFromUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();

    if (host === "youtu.be") {
      return u.pathname.replace("/", "");
    }
    if (host.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
    }
  } catch (e) {
    return null;
  }
  return null;
}

function extractPlaylistIdFromUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();

    if (host.endsWith("youtube.com")) {
      const list = u.searchParams.get("list");
      if (list) return list;
    }
  } catch (e) {
    return null;
  }
  return null;
}

// ==== 管理者認証関連 ====

// 管理者だけに許可したいルート用ミドルウェア
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.status(401).json({ error: "管理者としてログインが必要です" });
}

// 管理者ログイン
app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  const adminPassword = process.env.ADMIN_PASSWORD || "change-me";

  if (!password) {
    return res.status(400).json({ error: "password が必要です" });
  }

  if (password === adminPassword) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }

  return res.status(401).json({ error: "パスワードが違います" });
});

// 管理者ログアウト
app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// 管理者ログイン状態確認
app.get("/api/admin/status", (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// ==== API: DBから動画一覧を取得して返す ====
app.get("/api/videos", (req, res) => {
  const sql = `
    SELECT id, title, url, tags_text
    FROM videos
    ORDER BY id
  `;
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    const videos = rows.map((row) => ({
      id: row.id,
      title: row.title,
      url: row.url,
      tags: (row.tags_text || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    }));

    res.json({ videos });
  });
});

// ==== API: タグ編集（★ 誰でもOK ★） ====
app.post("/api/videos/update-tags", (req, res) => {
  const { id, tagsText } = req.body || {};
  if (id === undefined || id === null) {
    return res.status(400).json({ error: "id が必要です" });
  }

  const text = (tagsText || "").trim();
  const sql = "UPDATE videos SET tags_text = ? WHERE id = ?";

  db.run(sql, [text, id], function (err) {
    if (err) {
      console.error("update-tags DB error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json({ ok: true, changed: this.changes });
  });
});

// ==== API: 単一動画URLから登録（管理者のみ） ====
app.post("/api/register/video", requireAdmin, async (req, res) => {
  const { videoUrl } = req.body || {};
  if (!videoUrl) {
    return res.status(400).json({ error: "videoUrl が必要です" });
  }

  const videoId = extractVideoIdFromUrl(videoUrl);
  if (!videoId) {
    return res.status(400).json({ error: "不正なYouTube動画URLです" });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "YOUTUBE_API_KEY が設定されていません" });
  }

  try {
    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(
      videoId
    )}&key=${apiKey}`;
    const data = await fetchJson(apiUrl);

    if (!data.items || data.items.length === 0) {
      return res.status(400).json({ error: "動画が見つかりません" });
    }

    const title = data.items[0].snippet.title;
    const urlToSave = videoUrl;

    const selectSql = "SELECT id, title FROM videos WHERE url = ?";
    db.get(selectSql, [urlToSave], (err, row) => {
      if (err) {
        console.error("DB select error:", err);
        return res.status(500).json({ error: "Database error" });
      }

      if (row) {
        return res.json({
          ok: true,
          alreadyExisted: true,
          id: row.id,
          title: row.title,
        });
      }

      const insertSql =
        "INSERT INTO videos (title, url, tags_text) VALUES (?, ?, ?)";
      db.run(insertSql, [title, urlToSave, ""], function (err2) {
        if (err2) {
          console.error("DB insert error:", err2);
          return res.status(500).json({ error: "Database error" });
        }

        return res.json({
          ok: true,
          alreadyExisted: false,
          id: this.lastID,
          title,
        });
      });
    });
  } catch (e) {
    console.error("register/video error:", e);
    res.status(500).json({ error: e.message || "YouTube API error" });
  }
});

// ==== API: 再生リストURLから登録（管理者のみ） ====
app.post("/api/register/playlist", requireAdmin, async (req, res) => {
  const { playlistUrl } = req.body || {};
  if (!playlistUrl) {
    return res.status(400).json({ error: "playlistUrl が必要です" });
  }

  const playlistId = extractPlaylistIdFromUrl(playlistUrl);
  if (!playlistId) {
    return res.status(400).json({ error: "不正な再生リストURLです" });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "YOUTUBE_API_KEY が設定されていません" });
  }

  let fetched = 0;
  let inserted = 0;
  let skipped = 0;
  let pageToken = "";

  try {
    while (true) {
      let apiUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${encodeURIComponent(
        playlistId
      )}&key=${apiKey}`;
      if (pageToken) {
        apiUrl += `&pageToken=${pageToken}`;
      }

      const data = await fetchJson(apiUrl);
      const items = data.items || [];
      if (items.length === 0) break;

      fetched += items.length;

      // items をDBに反映
      await new Promise((resolve, reject) => {
        let pending = items.length;
        if (pending === 0) return resolve();

        items.forEach((item) => {
          const snippet = item.snippet;
          if (
            !snippet ||
            !snippet.resourceId ||
            snippet.resourceId.kind !== "youtube#video"
          ) {
            if (--pending === 0) resolve();
            return;
          }

          const videoId = snippet.resourceId.videoId;
          const title = snippet.title;
          const url = `https://www.youtube.com/watch?v=${videoId}`;

          const selectSql = "SELECT id FROM videos WHERE url = ?";
          db.get(selectSql, [url], (err, row) => {
            if (err) {
              return reject(err);
            }
            if (row) {
              skipped++;
              if (--pending === 0) resolve();
              return;
            }

            const insertSql =
              "INSERT INTO videos (title, url, tags_text) VALUES (?, ?, ?)";
            db.run(insertSql, [title, url, ""], function (err2) {
              if (err2) {
                return reject(err2);
              }
              inserted++;
              if (--pending === 0) resolve();
            });
          });
        });
      });

      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }

    res.json({ ok: true, fetched, inserted, skipped });
  } catch (e) {
    console.error("register/playlist error:", e);
    res.status(500).json({ error: e.message || "YouTube API error" });
  }
});

// ==== サーバー起動 ====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
