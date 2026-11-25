import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

class JsonFileStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.data = {
      users: {}, // chatId -> { chatId, lang, notifyNewMovies, createdAt }
      alerts: {}, // `${chatId}:${slug}` -> { chatId, slug, movieTitle, remindedBeforeRelease, createdAt }
      snapshots: {}, // slug -> { slug, titleEn, titleBn, isNowShowing, isUpcoming, localReleaseDate, formats, updatedAt }
    };
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.data = {
        users: parsed.users || {},
        alerts: parsed.alerts || {},
        snapshots: parsed.snapshots || {},
      };
    } catch {
      await this.#persist();
    }
  }

  async #persist() {
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), "utf8");
    await fs.rename(tmp, this.filePath);
  }

  async ensureUser(chatId) {
    const key = String(chatId);
    if (!this.data.users[key]) {
      this.data.users[key] = {
        chatId: key,
        lang: "bn",
        notifyNewMovies: false,
        createdAt: new Date().toISOString(),
      };
      await this.#persist();
    }
    return this.data.users[key];
  }

  async getUser(chatId) {
    return this.data.users[String(chatId)] || {
      chatId: String(chatId),
      lang: "bn",
      notifyNewMovies: false,
    };
  }

  async setUserLang(chatId, lang) {
    const user = await this.ensureUser(chatId);
    user.lang = lang === "en" ? "en" : "bn";
    await this.#persist();
    return user;
  }

  async toggleNewMovieAlerts(chatId) {
    const user = await this.ensureUser(chatId);
    user.notifyNewMovies = !user.notifyNewMovies;
    await this.#persist();
    return user.notifyNewMovies;
  }

  async getNewMovieSubscribers() {
    return Object.values(this.data.users).filter((u) => u.notifyNewMovies);
  }

  async hasAlert(chatId, slug) {
    return Boolean(this.data.alerts[`${chatId}:${slug}`]);
  }

  async toggleAlert(chatId, slug, movieTitle = "") {
    await this.ensureUser(chatId);
    const key = `${chatId}:${slug}`;
    if (this.data.alerts[key]) {
      delete this.data.alerts[key];
      await this.#persist();
      return false;
    }
    this.data.alerts[key] = {
      chatId: String(chatId),
      slug,
      movieTitle,
      remindedBeforeRelease: false,
      createdAt: new Date().toISOString(),
    };
    await this.#persist();
    return true;
  }

  async removeAlert(chatId, slug) {
    const key = `${chatId}:${slug}`;
    if (this.data.alerts[key]) {
      delete this.data.alerts[key];
      await this.#persist();
    }
  }

  async removeAllForUser(chatId) {
    const keyPrefix = `${chatId}:`;
    for (const k of Object.keys(this.data.alerts)) {
      if (k.startsWith(keyPrefix)) delete this.data.alerts[k];
    }
    if (this.data.users[String(chatId)]) {
      this.data.users[String(chatId)].notifyNewMovies = false;
    }
    await this.#persist();
  }

  async getUserAlerts(chatId) {
    const id = String(chatId);
    return Object.values(this.data.alerts).filter((a) => a.chatId === id);
  }

  async getSubscribersForMovie(slug) {
    const subs = Object.values(this.data.alerts).filter((a) => a.slug === slug);
    return subs.map((a) => ({
      ...a,
      lang: this.data.users[a.chatId]?.lang || "bn",
    }));
  }

  async markRemindedBeforeRelease(chatId, slug) {
    const key = `${chatId}:${slug}`;
    if (this.data.alerts[key]) {
      this.data.alerts[key].remindedBeforeRelease = true;
      await this.#persist();
    }
  }

  async getSnapshotsMap() {
    return new Map(Object.entries(this.data.snapshots));
  }

  async saveSnapshots(movies) {
    const now = new Date().toISOString();
    for (const m of movies) {
      this.data.snapshots[m.slug] = {
        slug: m.slug,
        titleEn: m.title?.en || "",
        titleBn: m.title?.bn || "",
        isNowShowing: Boolean(m.isNowShowing),
        isUpcoming: Boolean(m.isUpcoming),
        localReleaseDate: m.localReleaseDate || m.releaseDate || "",
        formats: Array.isArray(m.formats) ? m.formats : [],
        updatedAt: now,
      };
    }
    await this.#persist();
  }

  async getStats() {
    return {
      users: Object.keys(this.data.users).length,
      alerts: Object.keys(this.data.alerts).length,
      snapshots: Object.keys(this.data.snapshots).length,
      backend: "json-file",
    };
  }
}

class PostgresStore {
  constructor(connectionString) {
    this.pool = new Pool({
      connectionString,
      ssl: connectionString.includes("localhost")
        ? false
        : { rejectUnauthorized: false },
      max: 5,
    });
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS bot_users (
        chat_id TEXT PRIMARY KEY,
        lang TEXT NOT NULL DEFAULT 'bn',
        notify_new_movies BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS movie_alerts (
        chat_id TEXT NOT NULL REFERENCES bot_users(chat_id) ON DELETE CASCADE,
        slug TEXT NOT NULL,
        movie_title TEXT NOT NULL DEFAULT '',
        reminded_before_release BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (chat_id, slug)
      );

      CREATE TABLE IF NOT EXISTS movie_snapshots (
        slug TEXT PRIMARY KEY,
        title_en TEXT NOT NULL DEFAULT '',
        title_bn TEXT NOT NULL DEFAULT '',
        is_now_showing BOOLEAN NOT NULL DEFAULT FALSE,
        is_upcoming BOOLEAN NOT NULL DEFAULT FALSE,
        local_release_date TEXT NOT NULL DEFAULT '',
        formats JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  async ensureUser(chatId) {
    const id = String(chatId);
    const { rows } = await this.pool.query(
      `INSERT INTO bot_users (chat_id) VALUES ($1)
       ON CONFLICT (chat_id) DO UPDATE SET chat_id = EXCLUDED.chat_id
       RETURNING chat_id, lang, notify_new_movies`,
      [id]
    );
    return {
      chatId: rows[0].chat_id,
      lang: rows[0].lang,
      notifyNewMovies: rows[0].notify_new_movies,
    };
  }

  async getUser(chatId) {
    const { rows } = await this.pool.query(
      `SELECT chat_id, lang, notify_new_movies FROM bot_users WHERE chat_id = $1`,
      [String(chatId)]
    );
    if (!rows[0]) {
      return { chatId: String(chatId), lang: "bn", notifyNewMovies: false };
    }
    return {
      chatId: rows[0].chat_id,
      lang: rows[0].lang,
      notifyNewMovies: rows[0].notify_new_movies,
    };
  }

  async setUserLang(chatId, lang) {
    const safeLang = lang === "en" ? "en" : "bn";
    await this.ensureUser(chatId);
    await this.pool.query(`UPDATE bot_users SET lang = $2 WHERE chat_id = $1`, [
      String(chatId),
      safeLang,
    ]);
    return this.getUser(chatId);
  }

  async toggleNewMovieAlerts(chatId) {
    await this.ensureUser(chatId);
    const { rows } = await this.pool.query(
      `UPDATE bot_users SET notify_new_movies = NOT notify_new_movies
       WHERE chat_id = $1 RETURNING notify_new_movies`,
      [String(chatId)]
    );
    return Boolean(rows[0]?.notify_new_movies);
  }

  async getNewMovieSubscribers() {
    const { rows } = await this.pool.query(
      `SELECT chat_id, lang FROM bot_users WHERE notify_new_movies = TRUE`
    );
    return rows.map((r) => ({ chatId: r.chat_id, lang: r.lang }));
  }

  async hasAlert(chatId, slug) {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM movie_alerts WHERE chat_id = $1 AND slug = $2`,
      [String(chatId), slug]
    );
    return rows.length > 0;
  }

  async toggleAlert(chatId, slug, movieTitle = "") {
    await this.ensureUser(chatId);
    const exists = await this.hasAlert(chatId, slug);
    if (exists) {
      await this.pool.query(
        `DELETE FROM movie_alerts WHERE chat_id = $1 AND slug = $2`,
        [String(chatId), slug]
      );
      return false;
    }
    await this.pool.query(
      `INSERT INTO movie_alerts (chat_id, slug, movie_title)
       VALUES ($1, $2, $3) ON CONFLICT (chat_id, slug) DO NOTHING`,
      [String(chatId), slug, movieTitle]
    );
    return true;
  }

  async removeAlert(chatId, slug) {
    await this.pool.query(
      `DELETE FROM movie_alerts WHERE chat_id = $1 AND slug = $2`,
      [String(chatId), slug]
    );
  }

  async removeAllForUser(chatId) {
    const id = String(chatId);
    await this.pool.query(`DELETE FROM movie_alerts WHERE chat_id = $1`, [id]);
    await this.pool.query(
      `UPDATE bot_users SET notify_new_movies = FALSE WHERE chat_id = $1`,
      [id]
    );
  }

  async getUserAlerts(chatId) {
    const { rows } = await this.pool.query(
      `SELECT chat_id, slug, movie_title, reminded_before_release, created_at
       FROM movie_alerts WHERE chat_id = $1 ORDER BY created_at DESC`,
      [String(chatId)]
    );
    return rows.map((r) => ({
      chatId: r.chat_id,
      slug: r.slug,
      movieTitle: r.movie_title,
      remindedBeforeRelease: r.reminded_before_release,
      createdAt: r.created_at,
    }));
  }

  async getSubscribersForMovie(slug) {
    const { rows } = await this.pool.query(
      `SELECT a.chat_id, a.slug, a.movie_title, a.reminded_before_release, u.lang
       FROM movie_alerts a
       JOIN bot_users u ON u.chat_id = a.chat_id
       WHERE a.slug = $1`,
      [slug]
    );
    return rows.map((r) => ({
      chatId: r.chat_id,
      slug: r.slug,
      movieTitle: r.movie_title,
      remindedBeforeRelease: r.reminded_before_release,
      lang: r.lang || "bn",
    }));
  }

  async markRemindedBeforeRelease(chatId, slug) {
    await this.pool.query(
      `UPDATE movie_alerts SET reminded_before_release = TRUE
       WHERE chat_id = $1 AND slug = $2`,
      [String(chatId), slug]
    );
  }

  async getSnapshotsMap() {
    const { rows } = await this.pool.query(`SELECT * FROM movie_snapshots`);
    const map = new Map();
    for (const r of rows) {
      map.set(r.slug, {
        slug: r.slug,
        titleEn: r.title_en,
        titleBn: r.title_bn,
        isNowShowing: r.is_now_showing,
        isUpcoming: r.is_upcoming,
        localReleaseDate: r.local_release_date,
        formats: Array.isArray(r.formats) ? r.formats : [],
        updatedAt: r.updated_at,
      });
    }
    return map;
  }

  async saveSnapshots(movies) {
    for (const m of movies) {
      await this.pool.query(
        `INSERT INTO movie_snapshots (slug, title_en, title_bn, is_now_showing, is_upcoming, local_release_date, formats, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
         ON CONFLICT (slug) DO UPDATE SET
           title_en = EXCLUDED.title_en,
           title_bn = EXCLUDED.title_bn,
           is_now_showing = EXCLUDED.is_now_showing,
           is_upcoming = EXCLUDED.is_upcoming,
           local_release_date = EXCLUDED.local_release_date,
           formats = EXCLUDED.formats,
           updated_at = NOW()`,
        [
          m.slug,
          m.title?.en || "",
          m.title?.bn || "",
          Boolean(m.isNowShowing),
          Boolean(m.isUpcoming),
          m.localReleaseDate || m.releaseDate || "",
          JSON.stringify(Array.isArray(m.formats) ? m.formats : []),
        ]
      );
    }
  }

  async getStats() {
    const [u, a, s] = await Promise.all([
      this.pool.query(`SELECT COUNT(*)::int AS c FROM bot_users`),
      this.pool.query(`SELECT COUNT(*)::int AS c FROM movie_alerts`),
      this.pool.query(`SELECT COUNT(*)::int AS c FROM movie_snapshots`),
    ]);
    return {
      users: u.rows[0].c,
      alerts: a.rows[0].c,
      snapshots: s.rows[0].c,
      backend: "postgres",
    };
  }
}

export async function createStorage() {
  if (config.databaseUrl) {
    const store = new PostgresStore(config.databaseUrl);
    await store.init();
    console.log("[storage] Connected to PostgreSQL.");
    return store;
  }

  console.warn(
    "[storage] DATABASE_URL not set. Using local JSON fallback (data resets on Render Free restarts)."
  );
  const store = new JsonFileStore(config.localStorePath);
  await store.init();
  return store;
}
