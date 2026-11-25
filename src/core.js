/**
 * Pure domain logic for movie formatting, localization, subtitle rules,
 * countdowns, search, and state-diff alert detection.
 */

export function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function getLocalizedText(value, lang = "bn") {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  const preferred = lang === "en" ? value.en : value.bn;
  const fallback = lang === "en" ? value.bn : value.en;
  return (preferred || fallback || "").trim();
}

export function formatDuration(minutes, lang = "bn") {
  const mins = Number(minutes);
  if (!Number.isFinite(mins) || mins <= 0) return "";
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (lang === "bn") {
    if (hrs > 0 && rem > 0) return `${hrs} ঘণ্টা ${rem} মি.`;
    if (hrs > 0) return `${hrs} ঘণ্টা`;
    return `${rem} মি.`;
  }
  if (hrs > 0 && rem > 0) return `${hrs}h ${rem}m`;
  if (hrs > 0) return `${hrs}h`;
  return `${rem}m`;
}

export function formatLanguageWithSubtitle(
  langCode,
  languagesMap,
  languageDisplay,
  uiLang = "bn"
) {
  if (!langCode) return "";
  const langEntry = languagesMap?.get(langCode);
  const langName = langEntry
    ? getLocalizedText(langEntry.name, uiLang)
    : langCode.toUpperCase();

  if (
    languageDisplay?.subtitleNoteEnabled &&
    Array.isArray(languageDisplay.exemptLanguageCodes) &&
    !languageDisplay.exemptLanguageCodes.includes(langCode)
  ) {
    const note = getLocalizedText(languageDisplay.subtitleNote, uiLang);
    if (note) {
      const cleaned = note.replace(/^\(|\)$/g, "").trim();
      return `${langName} (${cleaned})`;
    }
  }
  return langName;
}

export function formatGenres(genreSlugs, genresMap, uiLang = "bn") {
  if (!Array.isArray(genreSlugs) || genreSlugs.length === 0) return "";
  return genreSlugs
    .map((slug) => {
      const entry = genresMap?.get(slug);
      return entry ? getLocalizedText(entry.name, uiLang) : slug;
    })
    .filter(Boolean)
    .join(", ");
}

export function getTrailerUrl(movie) {
  if (!movie) return "";
  const direct = (movie.trailerUrl || "").trim();
  if (direct && /^https?:\/\//i.test(direct)) return direct;
  const ytId = (movie.enrichment?.trailerYoutubeId || "").trim();
  if (ytId) return `https://www.youtube.com/watch?v=${encodeURIComponent(ytId)}`;
  return "";
}

export function getDaysUntilRelease(dateStr, nowDate = new Date()) {
  if (!dateStr) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
  if (!match) return null;

  // Compare in Dhaka timezone (+06:00) calendar days
  const targetUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const dhakaNow = new Date(nowDate.getTime() + 6 * 60 * 60 * 1000);
  const todayUtc = Date.UTC(
    dhakaNow.getUTCFullYear(),
    dhakaNow.getUTCMonth(),
    dhakaNow.getUTCDate()
  );

  return Math.round((targetUtc - todayUtc) / (24 * 60 * 60 * 1000));
}

export function formatReleaseCountdown(dateStr, uiLang = "bn", nowDate = new Date()) {
  const days = getDaysUntilRelease(dateStr, nowDate);
  if (days === null) return "";
  if (uiLang === "bn") {
    if (days < 0) return "রিলিজ হয়েছে";
    if (days === 0) return "আজ রিলিজ!";
    if (days === 1) return "আগামীকাল রিলিজ!";
    return `আর ${days} দিন বাকি`;
  }
  if (days < 0) return "Released";
  if (days === 0) return "Releasing today!";
  if (days === 1) return "Releasing tomorrow!";
  return `In ${days} days`;
}

export function searchMovies(movies, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  return movies.filter((m) => {
    const en = (m.title?.en || "").toLowerCase();
    const bn = (m.title?.bn || "").toLowerCase();
    const slug = (m.slug || "").toLowerCase();
    return en.includes(q) || bn.includes(q) || slug.includes(q);
  });
}

/**
 * Compares previous catalog snapshots against freshly fetched movies
 * and emits structured alert events.
 */
export function diffMovies(previousSnapshotsMap, currentMovies) {
  const events = [];
  const hasBaseline = previousSnapshotsMap && previousSnapshotsMap.size > 0;

  for (const movie of currentMovies) {
    const prev = previousSnapshotsMap?.get(movie.slug);
    const currentFormats = Array.isArray(movie.formats) ? movie.formats : [];

    if (!prev) {
      if (hasBaseline) {
        events.push({
          type: movie.isNowShowing ? "NEW_NOW_SHOWING" : "NEW_UPCOMING",
          slug: movie.slug,
          movie,
        });
      }
      continue;
    }

    // 1. Upcoming -> Now Showing (Ticket Released!)
    const becameNowShowing =
      (!prev.isNowShowing && Boolean(movie.isNowShowing)) ||
      (prev.isUpcoming && !movie.isUpcoming && Boolean(movie.isNowShowing));

    if (becameNowShowing) {
      events.push({
        type: "TICKET_RELEASED",
        slug: movie.slug,
        movie,
      });
    }

    // 2. Local Release Date Changed (only for still-upcoming movies)
    const prevDate = prev.localReleaseDate || "";
    const currDate = movie.localReleaseDate || "";
    if (movie.isUpcoming && prevDate && currDate && prevDate !== currDate) {
      events.push({
        type: "RELEASE_DATE_CHANGED",
        slug: movie.slug,
        movie,
        oldDate: prevDate,
        newDate: currDate,
      });
    }

    // 3. New screening formats added (e.g., 3D, IMAX)
    const prevFormats = new Set(Array.isArray(prev.formats) ? prev.formats : []);
    const addedFormats = currentFormats.filter((f) => !prevFormats.has(f));
    if (addedFormats.length > 0) {
      events.push({
        type: "NEW_FORMATS_ADDED",
        slug: movie.slug,
        movie,
        addedFormats,
      });
    }
  }

  return events;
}

export function formatMovieSummaryCard(movie, meta, uiLang = "bn", brandName = "STAR Cineplex") {
  const title = escapeHtml(getLocalizedText(movie.title, uiLang));
  const statusBadge = movie.isNowShowing
    ? uiLang === "bn"
      ? "🟢 এখন চলছে"
      : "🟢 Now Showing"
    : uiLang === "bn"
      ? "🗓️ আসছে শীঘ্রই"
      : "🗓️ Coming Soon";

  const formats = (movie.formats || []).join(" • ");
  const duration = formatDuration(movie.duration, uiLang);
  const langLabel = formatLanguageWithSubtitle(
    movie.language,
    meta.languagesMap,
    meta.languageDisplay,
    uiLang
  );
  const genres = formatGenres(movie.genres, meta.genresMap, uiLang);
  const releaseDate = movie.localReleaseDate || movie.releaseDate || "";
  const countdown = movie.isUpcoming
    ? formatReleaseCountdown(releaseDate, uiLang)
    : "";

  const lines = [
    `<b>🎬 ${title}</b>`,
    `${statusBadge}${formats ? `  |  🎞 ${escapeHtml(formats)}` : ""}`,
  ];

  const metaParts = [];
  if (duration) metaParts.push(`⏱ ${escapeHtml(duration)}`);
  if (movie.certificate) metaParts.push(`🔞 ${escapeHtml(movie.certificate)}`);
  if (metaParts.length) lines.push(metaParts.join("  •  "));

  if (langLabel) lines.push(`🗣 ${escapeHtml(langLabel)}`);
  if (genres) lines.push(`🎭 ${escapeHtml(genres)}`);

  if (releaseDate) {
    const dateLabel = uiLang === "bn" ? "রিলিজ" : "Release";
    lines.push(
      `📅 ${dateLabel}: <b>${escapeHtml(releaseDate)}</b>${
        countdown ? ` (${escapeHtml(countdown)})` : ""
      }`
    );
  }

  lines.push(`\n🏛 <i>${escapeHtml(brandName)}</i>`);
  return lines.join("\n");
}

export function formatMovieDetailCard(movie, meta, uiLang = "bn", brandName = "STAR Cineplex") {
  const title = escapeHtml(getLocalizedText(movie.title, uiLang));
  const tagline = escapeHtml(getLocalizedText(movie.tagline, uiLang));
  const rawSynopsis = getLocalizedText(movie.synopsis, uiLang);
  const synopsis =
    rawSynopsis.length > 420
      ? `${escapeHtml(rawSynopsis.slice(0, 417))}...`
      : escapeHtml(rawSynopsis);

  const statusBadge = movie.isNowShowing
    ? uiLang === "bn"
      ? "🟢 এখন চলছে"
      : "🟢 Now Showing"
    : uiLang === "bn"
      ? "🗓️ আসছে শীঘ্রই"
      : "🗓️ Coming Soon";

  const formats = (movie.formats || []).join(" • ");
  const duration = formatDuration(movie.duration, uiLang);
  const langLabel = formatLanguageWithSubtitle(
    movie.language,
    meta.languagesMap,
    meta.languageDisplay,
    uiLang
  );
  const genres = formatGenres(movie.genres, meta.genresMap, uiLang);
  const releaseDate = movie.localReleaseDate || movie.releaseDate || "";
  const countdown = movie.isUpcoming
    ? formatReleaseCountdown(releaseDate, uiLang)
    : "";

  const tmdbScore = Number(movie.enrichment?.voteAverage || 0);
  const ratingText =
    tmdbScore > 0
      ? `⭐ TMDB: <b>${tmdbScore.toFixed(1)}/10</b>`
      : movie.rating > 0
        ? `⭐ ${Number(movie.rating).toFixed(1)}/10`
        : "";

  const lines = [`<b>🎬 ${title}</b>`];
  if (tagline) lines.push(`<i>"${tagline}"</i>`);
  lines.push("");
  lines.push(`${statusBadge}${formats ? `  |  🎞 ${escapeHtml(formats)}` : ""}`);

  const infoParts = [];
  if (duration) infoParts.push(`⏱ ${escapeHtml(duration)}`);
  if (movie.certificate) infoParts.push(`🔞 ${escapeHtml(movie.certificate)}`);
  if (ratingText) infoParts.push(ratingText);
  if (infoParts.length) lines.push(infoParts.join("  •  "));

  if (langLabel) lines.push(`🗣 ${escapeHtml(langLabel)}`);
  if (genres) lines.push(`🎭 ${escapeHtml(genres)}`);

  if (releaseDate) {
    const label = uiLang === "bn" ? "রিলিজ ডেট" : "Release Date";
    lines.push(
      `📅 ${label}: <b>${escapeHtml(releaseDate)}</b>${
        countdown ? ` (${escapeHtml(countdown)})` : ""
      }`
    );
  }

  if (synopsis) {
    lines.push("");
    lines.push(synopsis);
  }

  if (Array.isArray(movie.cast) && movie.cast.length > 0) {
    const castHeader = uiLang === "bn" ? "👥 অভিনয়ে:" : "👥 Cast:";
    const castList = movie.cast
      .slice(0, 5)
      .map((c) => {
        const name = escapeHtml(getLocalizedText(c.artistName, uiLang));
        const role = c.characterName ? ` (${escapeHtml(c.characterName)})` : "";
        return `• ${name}${role}`;
      })
      .join("\n");
    lines.push("");
    lines.push(`<b>${castHeader}</b>\n${castList}`);
  }

  lines.push(`\n🏛 <i>${escapeHtml(brandName)}</i>`);
  return lines.join("\n");
}

export function formatAlertNotification(event, uiLang = "bn", brandName = "STAR Cineplex") {
  const title = escapeHtml(getLocalizedText(event.movie?.title, uiLang));
  const formats = (event.movie?.formats || []).join(", ");

  if (event.type === "TICKET_RELEASED") {
    return uiLang === "bn"
      ? `🎟️ <b>টিকিট ছেড়ে দিয়েছে!</b>\n\n🎬 <b>${title}</b> এখন ${escapeHtml(brandName)}-এ চলছে!\n${formats ? `🎞 ফরম্যাট: ${escapeHtml(formats)}\n` : ""}নিচের বাটনে ক্লিক করে এখনই টিকিট কাটুন।`
      : `🎟️ <b>Tickets Are Now Live!</b>\n\n🎬 <b>${title}</b> is now showing at ${escapeHtml(brandName)}!\n${formats ? `🎞 Formats: ${escapeHtml(formats)}\n` : ""}Tap below to book your tickets.`;
  }

  if (event.type === "RELEASE_DATE_CHANGED") {
    return uiLang === "bn"
      ? `📅 <b>রিলিজ ডেট আপডেট!</b>\n\n🎬 <b>${title}</b>-এর রিলিজ ডেট পরিবর্তন হয়েছে:\nআগে: <s>${escapeHtml(event.oldDate)}</s>\nনতুন: <b>${escapeHtml(event.newDate)}</b>`
      : `📅 <b>Release Date Updated!</b>\n\n🎬 <b>${title}</b> has a new release date:\nPrevious: <s>${escapeHtml(event.oldDate)}</s>\nNew: <b>${escapeHtml(event.newDate)}</b>`;
  }

  if (event.type === "NEW_FORMATS_ADDED") {
    const added = escapeHtml((event.addedFormats || []).join(", "));
    return uiLang === "bn"
      ? `🎞 <b>নতুন ফরম্যাট যুক্ত হয়েছে!</b>\n\n🎬 <b>${title}</b> এখন <b>${added}</b> ফরম্যাটেও পাওয়া যাচ্ছে।`
      : `🎞 <b>New Format Added!</b>\n\n🎬 <b>${title}</b> is now also listed in <b>${added}</b>.`;
  }

  if (event.type === "RELEASE_TOMORROW") {
    return uiLang === "bn"
      ? `⏰ <b>আগামীকাল রিলিজ!</b>\n\n🎬 <b>${title}</b> আগামীকাল (${escapeHtml(event.movie?.localReleaseDate || "")}) ${escapeHtml(brandName)}-এ রিলিজ হচ্ছে।`
      : `⏰ <b>Releasing Tomorrow!</b>\n\n🎬 <b>${title}</b> releases tomorrow (${escapeHtml(event.movie?.localReleaseDate || "")}) at ${escapeHtml(brandName)}.`;
  }

  if (event.type === "NEW_NOW_SHOWING" || event.type === "NEW_UPCOMING") {
    const tag =
      event.type === "NEW_NOW_SHOWING"
        ? uiLang === "bn"
          ? "এখন চলছে"
          : "Now Showing"
        : uiLang === "bn"
          ? "আপকামিং লিস্টে যুক্ত হয়েছে"
          : "Added to Upcoming";
    return uiLang === "bn"
      ? `🆕 <b>নতুন মুভি আপডেট (${tag})</b>\n\n🎬 <b>${title}</b>\n📅 রিলিজ: ${escapeHtml(event.movie?.localReleaseDate || "TBA")}`
      : `🆕 <b>New Movie Update (${tag})</b>\n\n🎬 <b>${title}</b>\n📅 Release: ${escapeHtml(event.movie?.localReleaseDate || "TBA")}`;
  }

  return `🎬 <b>${title}</b>`;
}
