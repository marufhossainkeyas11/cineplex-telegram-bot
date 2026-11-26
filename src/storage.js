import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

class JsonFileStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.data = {
      users: {},
      alerts: {}, // `${chatId}:${slug}` -> alert object
      snapshots: {}, // slug -> catalog snapshot
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
        preferredVenueId: null,
        preferredVenueName: "",
        createdAt: new Date().toISOString(),
      };
      await this.#persist();
    }
    return this.data.users[key];
  }

  async getUser(chatId) {
    const u = this.data.users[String(chatId)];
    if (!u) {
      return {
        chatId: String(chatId),
        lang: "bn",
        notifyNewMovies: false,
        preferredVenueId: null,
        preferredVenueName: "",
      };
    }
    return {
      preferredVenueId: null,
      preferredVenueName: "",
      ...u,
    };
  }

  async setUserLang(chatId, lang) {
    const user = await this.ensureUser(chatId);
    user.lang = lang === "en" ? "en" : "bn";
    await this.#persist();
    return user;
  }

  async setPreferredVenue(chatId, venueId, venueName = "") {
    const user = await this.ensureUser(chatId);
    user.preferredVenueId = venueId || null;
    user.preferredVenueName = venueName || "";
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

  async getAlert(chatId, slug) {
    return this.data.alerts[`${chatId}:${slug}`] || null;
  }

  async hasAlert(chatId, slug) {
    return Boolean(this.data.alerts[`${chatId}:${slug}`]);
  }

  async upsertAlert(
    chatId,
    {
      slug,
      movieId = "",
      movieTitle = "",
      targetVenueId = null,
      targetVenueName = "",
      alertMode = "ticket_drop",
    }
  ) {
    await this.ensureUser(chatId);
    const key = `${chatId}:${slug}`;
    const existing = this.data.alerts[key];
    this.data.alerts[key] = {
      chatId: String(chatId),
      slug,
      movieId,
      movieTitle,
      targetVenueId: targetVenueId || null,
      targetVenueName: targetVenueName || "",
      alertMode: alertMode === "new_shows" ? "new_shows" : "ticket_drop",
      notifiedShowIds:
        existing && existing.targetVenueId === (targetVenueId || null)
          ? existing.notifiedShowIds || []
          : [],
      ticketNotified:
        existing && existing.targetVenueId === (targetVenueId || null)
          ? Boolean(existing.ticketNotified)
          : false,
      remindedBeforeRelease: existing ? Boolean(existing.remindedBeforeRelease) : false,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    await this.#persist();
    return this.data.alerts[key];
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

  async getAllAlerts() {
    return Object.values(this.data.alerts).map((a) => ({
      ...a,
      lang: this.data.users[a.chatId]?.lang || "bn",
    }));
  }

  async getSubscribersForMovie(slug) {
    const subs = Object.values(this.data.alerts).filter((a) => a.slug === slug);
    return subs.map((a) => ({
      ...a,
      lang: this.data.users[a.chatId]?.lang || "bn",
    }));
  }

  async markAlertNotified(chatId, slug, newShowIds = []) {
    const key = `${chatId}:${slug}`;
    const item = this.data.alerts[key];
    if (!item) return;
    const merged = Array.from(
      new Set([...(item.notifiedShowIds || []), ...newShowIds])
    );
    item.notifiedShowIds = merged.slice(-200);
    item.ticketNotified = true;
    await this.#persist();
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
        movieId: m.id || "",
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
        preferred_venue_id TEXT,
        preferred_venue_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS movie_alerts (
        chat_id TEXT NOT NULL REFERENCES bot_users(chat_id) ON DELETE CASCADE,
        slug TEXT NOT NULL,
        movie_id TEXT NOT NULL DEFAULT '',
        movie_title TEXT NOT NULL DEFAULT '',
        target_venue_id TEXT,
        target_venue_name TEXT NOT NULL DEFAULT '',
        alert_mode TEXT NOT NULL DEFAULT 'ticket_drop',
        notified_show_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        ticket_notified BOOLEAN NOT NULL DEFAULT FALSE,
        reminded_before_release BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (chat_id, slug)
      );

      CREATE TABLE IF NOT EXISTS movie_snapshots (
        slug TEXT PRIMARY KEY,
        movie_id TEXT NOT NULL DEFAULT '',
        title_en TEXT NOT NULL DEFAULT '',
        title_bn TEXT NOT NULL DEFAULT '',
        is_now_showing BOOLEAN NOT NULL DEFAULT FALSE,
        is_upcoming BOOLEAN NOT NULL DEFAULT FALSE,
        local_release_date TEXT NOT NULL DEFAULT '',
        formats JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Safe idempotent migrations for existing Neon/Supabase deployments
      ALTER TABLE bot_users ADD COLUMN IF NOT EXISTS preferred_venue_id TEXT;
      ALTER TABLE bot_users ADD COLUMN IF NOT EXISTS preferred_venue_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE movie_alerts ADD COLUMN IF NOT EXISTS movie_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE movie_alerts ADD COLUMN IF NOT EXISTS target_venue_id TEXT;
      ALTER TABLE movie_alerts ADD COLUMN IF NOT EXISTS target_venue_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE movie_alerts ADD COLUMN IF NOT EXISTS alert_mode TEXT NOT NULL DEFAULT 'ticket_drop';
      ALTER TABLE movie_alerts ADD COLUMN IF NOT EXISTS notified_show_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE movie_alerts ADD COLUMN IF NOT EXISTS ticket_notified BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE movie_snapshots ADD COLUMN IF NOT EXISTS movie_id TEXT NOT NULL DEFAULT '';
    `);
  }

  #mapUser(row) {
    return {
      chatId: row.chat_id,
      lang: row.lang || "bn",
      notifyNewMovies: Boolean(row.notify_new_movies),
      preferredVenueId: row.preferred_venue_id || null,
      preferredVenueName: row.preferred_venue_name || "",
    };
  }

  #mapAlert(row) {
    return {
      chatId: row.chat_id,
      slug: row.slug,
      movieId: row.movie_id || "",
      movieTitle: row.movie_title || "",
      targetVenueId: row.target_venue_id || null,
      targetVenueName: row.target_venue_name || "",
      alertMode: row.alert_mode || "ticket_drop",
      notifiedShowIds: Array.isArray(row.notified_show_ids)
        ? row.notified_show_ids
        : [],
      ticketNotified: Boolean(row.ticket_notified),
      remindedBeforeRelease: Boolean(row.reminded_before_release),
      lang: row.lang || "bn",
      createdAt: row.created_at,
    };
  }

  async ensureUser(chatId) {
    const id = String(chatId);
    const { rows } = await this.pool.query(
      `INSERT INTO bot_users (chat_id) VALUES ($1)
       ON CONFLICT (chat_id) DO UPDATE SET chat_id = EXCLUDED.chat_id
       RETURNING chat_id, lang, notify_new_movies, preferred_venue_id, preferred_venue_name`,
      [id]
    );
    return this.#mapUser(rows[0]);
  }

  async getUser(chatId) {
    const { rows } = await this.pool.query(
      `SELECT chat_id, lang, notify_new_movies, preferred_venue_id, preferred_venue_name
       FROM bot_users WHERE chat_id = $1`,
      [String(chatId)]
    );
    if (!rows[0]) {
      return {
        chatId: String(chatId),
        lang: "bn",
        notifyNewMovies: false,
        preferredVenueId: null,
        preferredVenueName: "",
      };
    }
    return this.#mapUser(rows[0]);
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

  async setPreferredVenue(chatId, venueId, venueName = "") {
    await this.ensureUser(chatId);
    await this.pool.query(
      `UPDATE bot_users SET preferred_venue_id = $2, preferred_venue_name = $3 WHERE chat_id = $1`,
      [String(chatId), venueId || null, venueName || ""]
    );
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
    return rows.map((r) => ({ chatId: r.chat_id, lang: r.lang || "bn" }));
  }

  async getAlert(chatId, slug) {
    const { rows } = await this.pool.query(
      `SELECT a.*, u.lang FROM movie_alerts a
       JOIN bot_users u ON u.chat_id = a.chat_id
       WHERE a.chat_id = $1 AND a.slug = $2`,
      [String(chatId), slug]
    );
    return rows[0] ? this.#mapAlert(rows[0]) : null;
  }

  async hasAlert(chatId, slug) {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM movie_alerts WHERE chat_id = $1 AND slug = $2`,
      [String(chatId), slug]
    );
    return rows.length > 0;
  }

  async upsertAlert(
    chatId,
    {
      slug,
      movieId = "",
      movieTitle = "",
      targetVenueId = null,
      targetVenueName = "",
      alertMode = "ticket_drop",
    }
  ) {
    await this.ensureUser(chatId);
    const safeMode = alertMode === "new_shows" ? "new_shows" : "ticket_drop";
    const { rows } = await this.pool.query(
      `INSERT INTO movie_alerts
         (chat_id, slug, movie_id, movie_title, target_venue_id, target_venue_name, alert_mode, notified_show_ids, ticket_notified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '[]'::jsonb, FALSE)
       ON CONFLICT (chat_id, slug) DO UPDATE SET
         movie_id = EXCLUDED.movie_id,
         movie_title = EXCLUDED.movie_title,
         target_venue_id = EXCLUDED.target_venue_id,
         target_venue_name = EXCLUDED.target_venue_name,
         alert_mode = EXCLUDED.alert_mode,
         notified_show_ids = CASE
           WHEN movie_alerts.target_venue_id IS DISTINCT FROM EXCLUDED.target_venue_id THEN '[]'::jsonb
           ELSE movie_alerts.notified_show_ids
         END,
         ticket_notified = CASE
           WHEN movie_alerts.target_venue_id IS DISTINCT FROM EXCLUDED.target_venue_id THEN FALSE
           ELSE movie_alerts.ticket_notified
         END
       RETURNING *`,
      [
        String(chatId),
        slug,
        movieId || "",
        movieTitle || "",
        targetVenueId || null,
        targetVenueName || "",
        safeMode,
      ]
    );
    return this.#mapAlert(rows[0]);
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
      `SELECT a.*, u.lang FROM movie_alerts a
       JOIN bot_users u ON u.chat_id = a.chat_id
       WHERE a.chat_id = $1 ORDER BY a.created_at DESC`,
      [String(chatId)]
    );
    return rows.map((r) => this.#mapAlert(r));
  }

  async getAllAlerts() {
    const { rows } = await this.pool.query(
      `SELECT a.*, u.lang FROM movie_alerts a
       JOIN bot_users u ON u.chat_id = a.chat_id`
    );
    return rows.map((r) => this.#mapAlert(r));
  }

  async getSubscribersForMovie(slug) {
    const { rows } = await this.pool.query(
      `SELECT a.*, u.lang FROM movie_alerts a
       JOIN bot_users u ON u.chat_id = a.chat_id
       WHERE a.slug = $1`,
      [slug]
    );
    return rows.map((r) => this.#mapAlert(r));
  }

  async markAlertNotified(chatId, slug, newShowIds = []) {
    const existing = await this.getAlert(chatId, slug);
    if (!existing) return;
    const merged = Array.from(
      new Set([...(existing.notifiedShowIds || []), ...newShowIds])
    ).slice(-200);
    await this.pool.query(
      `UPDATE movie_alerts
       SET notified_show_ids = $3::jsonb, ticket_notified = TRUE
       WHERE chat_id = $1 AND slug = $2`,
      [String(chatId), slug, JSON.stringify(merged)]
    );
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
        movieId: r.movie_id || "",
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
        `INSERT INTO movie_snapshots (slug, movie_id, title_en, title_bn, is_now_showing, is_upcoming, local_release_date, formats, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
         ON CONFLICT (slug) DO UPDATE SET
           movie_id = EXCLUDED.movie_id,
           title_en = EXCLUDED.title_en,
           title_bn = EXCLUDED.title_bn,
           is_now_showing = EXCLUDED.is_now_showing,
           is_upcoming = EXCLUDED.is_upcoming,
           local_release_date = EXCLUDED.local_release_date,
           formats = EXCLUDED.formats,
           updated_at = NOW()`,
        [
          m.slug,
          m.id || "",
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
    console.log("[storage] Connected to PostgreSQL (auto-migrated).");
    return store;
  }

  console.warn(
    "[storage] DATABASE_URL not set. Using local JSON fallback (data resets on Render Free restarts)."
  );
  const store = new JsonFileStore(config.localStorePath);
  await store.init();
  return store;
}
