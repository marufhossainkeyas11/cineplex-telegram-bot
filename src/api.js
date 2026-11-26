import { config } from "./config.js";
import { parseBranchRscHtml } from "./rsc.js";

const DEFAULT_TIMEOUT_MS = 10000;

const cache = {
  movies: { data: null, expiresAt: 0 },
  venues: { data: null, expiresAt: 0 },
  genres: { data: null, expiresAt: 0 },
  languages: { data: null, expiresAt: 0 },
  languageDisplay: { data: null, expiresAt: 0 },
  details: new Map(), // slug -> { data, expiresAt }
  branchShows: new Map(), // venueSlug -> { data, expiresAt }
};

const TTL = {
  movies: 90 * 1000, // 1.5 minutes
  branchShows: 90 * 1000, // 1.5 minutes (bypassed on cron forceRefresh)
  meta: 6 * 60 * 60 * 1000, // 6 hours
  detail: 5 * 60 * 1000, // 5 minutes
};

async function fetchWithTimeout(url, { accept = "application/json" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: accept,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "sec-fetch-dest": accept.includes("html") ? "document" : "empty",
        "sec-fetch-mode": accept.includes("html") ? "navigate" : "cors",
        "sec-fetch-site": "none",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Upstream responded with HTTP ${res.status}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url) {
  const res = await fetchWithTimeout(url, { accept: "application/json" });
  return res.json();
}

async function fetchHtmlWithRetry(url, retries = 1) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url, {
        accept: "text/html,application/xhtml+xml",
      });
      return await res.text();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
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

export async function getVenues({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && cache.venues.data && now < cache.venues.expiresAt) {
    return cache.venues.data;
  }

  const url = `${config.apiBaseUrl}/venues?orgId=${encodeURIComponent(config.orgId)}`;
  const data = await fetchJson(url);
  const venues = Array.isArray(data) ? data : [];

  cache.venues = { data: venues, expiresAt: now + TTL.meta };
  return venues;
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

export async function getBranchShows(venueSlug, { forceRefresh = false } = {}) {
  const safeSlug = String(venueSlug || "").trim();
  if (!safeSlug) return { shows: [], halls: [], venue: null };

  const now = Date.now();
  const cached = cache.branchShows.get(safeSlug);
  if (!forceRefresh && cached && now < cached.expiresAt) {
    return cached.data;
  }

  const url = `${config.branchScrapeBaseUrl}/${encodeURIComponent(safeSlug)}`;
  const html = await fetchHtmlWithRetry(url, 1);
  const parsed = parseBranchRscHtml(html);

  cache.branchShows.set(safeSlug, { data: parsed, expiresAt: now + TTL.branchShows });
  return parsed;
}

export async function getAllBranchesShows({ forceRefresh = false } = {}) {
  const venues = await getVenues();
  const venuesMap = new Map(venues.map((v) => [v.id, v]));
  const hallsMap = new Map();
  const allShows = [];
  let venuesScraped = 0;
  let venuesFailed = 0;

  // Pre-seed halls if venues endpoint includes them
  for (const v of venues) {
    if (Array.isArray(v.halls)) {
      for (const h of v.halls) {
        if (h?.id) hallsMap.set(h.id, h);
      }
    }
  }

  // Bounded concurrency scrape across all venues
  const queue = [...venues];
  const workerCount = Math.min(config.scrapeConcurrency, queue.length || 1);

  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const venue = queue.shift();
      if (!venue?.slug) continue;
      try {
        const parsed = await getBranchShows(venue.slug, { forceRefresh });
        venuesScraped += 1;

        for (const h of parsed.halls || []) {
          if (h?.id) hallsMap.set(h.id, h);
        }
        for (const s of parsed.shows || []) {
          allShows.push({
            ...s,
            venueId: s.venueId || venue.id,
            venueSlug: venue.slug,
          });
        }
      } catch (err) {
        venuesFailed += 1;
        console.warn(`[api] Failed to scrape branch "${venue.slug}":`, err?.message || err);
      }
    }
  });

  await Promise.all(workers);

  return {
    venues,
    venuesMap,
    hallsMap,
    shows: allShows,
    venuesScraped,
    venuesFailed,
  };
}

export async function getCatalogMeta() {
  const [genres, languages, languageDisplay, venues] = await Promise.all([
    getGenres().catch(() => []),
    getLanguages().catch(() => []),
    getLanguageDisplay().catch(() => null),
    getVenues().catch(() => []),
  ]);

  const genresMap = new Map(genres.map((g) => [g.slug, g]));
  const languagesMap = new Map(languages.map((l) => [l.code, l]));
  const venuesMap = new Map(venues.map((v) => [v.id, v]));

  return {
    genres,
    languages,
    venues,
    genresMap,
    languagesMap,
    venuesMap,
    languageDisplay,
  };
}
