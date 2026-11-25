import { config } from "./config.js";

const DEFAULT_TIMEOUT_MS = 10000;

const cache = {
  movies: { data: null, expiresAt: 0 },
  genres: { data: null, expiresAt: 0 },
  languages: { data: null, expiresAt: 0 },
  languageDisplay: { data: null, expiresAt: 0 },
  details: new Map(), // slug -> { data, expiresAt }
};

const TTL = {
  movies: 2 * 60 * 1000, // 2 minutes
  meta: 6 * 60 * 60 * 1000, // 6 hours
  detail: 5 * 60 * 1000, // 5 minutes
};

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "CineplexBD-TelegramBot/1.0",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Upstream catalog responded with HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function getActiveMovies({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && cache.movies.data && now < cache.movies.expiresAt) {
    return cache.movies.data;
  }

  const url = `${config.apiBaseUrl}/movies?listing=active&orgId=${encodeURIComponent(config.orgId)}`;
  const data = await fetchJson(url);
  const movies = Array.isArray(data) ? data : [];

  cache.movies = { data: movies, expiresAt: now + TTL.movies };
  return movies;
}

export async function getGenres({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && cache.genres.data && now < cache.genres.expiresAt) {
    return cache.genres.data;
  }

  const data = await fetchJson(`${config.apiBaseUrl}/genres`);
  const genres = Array.isArray(data) ? data : [];

  cache.genres = { data: genres, expiresAt: now + TTL.meta };
  return genres;
}

export async function getLanguages({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && cache.languages.data && now < cache.languages.expiresAt) {
    return cache.languages.data;
  }

  const data = await fetchJson(`${config.apiBaseUrl}/languages`);
  const languages = Array.isArray(data) ? data : [];

  cache.languages = { data: languages, expiresAt: now + TTL.meta };
  return languages;
}

export async function getLanguageDisplay({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (
    !forceRefresh &&
    cache.languageDisplay.data &&
    now < cache.languageDisplay.expiresAt
  ) {
    return cache.languageDisplay.data;
  }

  const data = await fetchJson(`${config.apiBaseUrl}/language-display`);
  const displayConfig = data && typeof data === "object" ? data : null;

  cache.languageDisplay = { data: displayConfig, expiresAt: now + TTL.meta };
  return displayConfig;
}

export async function getMovieDetail(slug, { forceRefresh = false } = {}) {
  const safeSlug = String(slug || "").trim();
  if (!safeSlug) return null;

  const now = Date.now();
  const cached = cache.details.get(safeSlug);
  if (!forceRefresh && cached && now < cached.expiresAt) {
    return cached.data;
  }

  const data = await fetchJson(
    `${config.apiBaseUrl}/movies/${encodeURIComponent(safeSlug)}`
  );
  cache.details.set(safeSlug, { data, expiresAt: now + TTL.detail });
  return data;
}

export async function getCatalogMeta() {
  const [genres, languages, languageDisplay] = await Promise.all([
    getGenres().catch(() => []),
    getLanguages().catch(() => []),
    getLanguageDisplay().catch(() => null),
  ]);

  const genresMap = new Map(genres.map((g) => [g.slug, g]));
  const languagesMap = new Map(languages.map((l) => [l.code, l]));

  return { genres, languages, genresMap, languagesMap, languageDisplay };
}
