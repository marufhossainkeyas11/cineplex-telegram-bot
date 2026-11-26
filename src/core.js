/**
 * Pure domain logic for movie formatting, localization, subtitle rules,
 * live showtimes (paisa -> Taka, 12h time, seats, hall resolution),
 * search, and zero-miss multi-signal ticket alert evaluation.
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

export function getVenueName(venue, lang = "bn") {
  if (!venue) return "";
  return getLocalizedText(venue.name || venue.displayName || venue.slug, lang);
}

export function getHallName(hallId, hallsMap, lang = "bn") {
  if (!hallId || !hallsMap) return "";
  const hall = hallsMap.get(hallId);
  if (!hall) return "";
  return getLocalizedText(hall.name || hall.displayName || hall.hallName, lang);
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

export function formatTaka(paisa) {
  const val = Number(paisa);
  if (!Number.isFinite(val) || val <= 0) return "";
  const taka = Math.round(val / 100);
  return `৳${taka}`;
}

export function formatShowPriceRange(show) {
  if (!show) return "";
  const minP = show.priceRange?.minPaisa;
  const maxP = show.priceRange?.maxPaisa;
  if (minP && maxP) {
    if (minP === maxP) return formatTaka(minP);
    return `${formatTaka(minP)}–${formatTaka(maxP)}`;
  }
  if (Array.isArray(show.pricing) && show.pricing.length > 0) {
    const prices = show.pricing
      .map((p) => Number(p.price))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (prices.length > 0) {
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      return min === max ? formatTaka(min) : `${formatTaka(min)}–${formatTaka(max)}`;
    }
  }
  return "";
}

export function formatTime12h(timeStr = "") {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(timeStr).trim());
  if (!match) return String(timeStr || "");
  let hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${hour}:${minute} ${suffix}`;
}

export function isShowSelling(show) {
  if (!show) return false;
  const status = String(show.status || "").trim().toLowerCase();
  const isOpenStatus =
    status === "selling" ||
    status === "open" ||
    status === "available" ||
    status === "active";
  if (!isOpenStatus) return false;
  // If seat count is present, require at least 1 seat available
  if (Number.isFinite(Number(show.totalSeats)) && Number(show.totalSeats) > 0) {
    return Number(show.availableSeats) > 0;
  }
  return true;
}

export function formatSeatBadge(available, total, uiLang = "bn") {
  const avail = Number(available);
  const tot = Number(total);
  if (!Number.isFinite(tot) || tot <= 0) return "";
  if (avail <= 0) {
    return uiLang === "bn" ? "🔴 হাউসফুল" : "🔴 Sold Out";
  }
  const ratio = avail / tot;
  const icon = ratio <= 0.15 ? "🟠" : ratio <= 0.4 ? "🟡" : "🟢";
  return uiLang === "bn"
    ? `${icon} ${avail}/${tot} সিট`
    : `${icon} ${avail}/${tot} seats`;
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
 * Catalog-level diff (for release date changes, new formats, and new movies).
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

/**
 * ZERO-MISS MULTI-SIGNAL TICKET ALERT ENGINE
 * Evaluates every active user alert against BOTH:
 *  1) Live scraped branch `shows[]` (status === "Selling" & seats > 0) — catches advance tickets immediately!
 *  2) Catalog `isNowShowing === true` fallback (when alert has no branch filter and shows weren't scraped yet)
 *
 * Guarantees at-least-once delivery: an alert only marks `notifiedShowIds` / `ticketNotified`
 * AFTER Telegram confirms delivery.
 */
export function evaluateZeroMissAlerts({
  alerts,
  currentMovies,
  currentShows,
  prevSnapshotsMap,
}) {
  const moviesBySlug = new Map(currentMovies.map((m) => [m.slug, m]));
  const moviesById = new Map(currentMovies.map((m) => [m.id, m]));

  // Index live selling shows by movieId
  const sellingByMovieId = new Map();
  for (const show of currentShows || []) {
    if (!isShowSelling(show)) continue;
    if (!sellingByMovieId.has(show.movieId)) {
      sellingByMovieId.set(show.movieId, []);
    }
    sellingByMovieId.get(show.movieId).push(show);
  }

  const dispatches = [];

  for (const alert of alerts || []) {
    const movie =
      moviesBySlug.get(alert.slug) ||
      (alert.movieId ? moviesById.get(alert.movieId) : null);
    if (!movie) continue;

    const alreadyNotifiedIds = new Set(
      Array.isArray(alert.notifiedShowIds) ? alert.notifiedShowIds : []
    );

    const allMovieSellingShows = sellingByMovieId.get(movie.id) || [];
    const matchingShows = alert.targetVenueId
      ? allMovieSellingShows.filter((s) => s.venueId === alert.targetVenueId)
      : allMovieSellingShows;

    const freshShows = matchingShows.filter((s) => !alreadyNotifiedIds.has(s.id));

    // Signal 1 (Primary & Fastest): Live selling shows found at target branch (or any branch)
    if (freshShows.length > 0) {
      const isContinuous = alert.alertMode === "new_shows";
      if (!alert.ticketNotified || isContinuous) {
        dispatches.push({
          reason: alert.ticketNotified ? "NEW_SHOWS_DROPPED" : "LIVE_TICKETS_DROPPED",
          alert,
          movie,
          freshShows,
          newShowIds: freshShows.map((s) => s.id),
          shouldRemoveAfterSend: !isContinuous,
        });
        continue;
      }
    }

    // Signal 2 (Backup): Catalog flipped to isNowShowing=true (only if user watches All Branches
    // and we haven't already notified them via Signal 1)
    if (!alert.targetVenueId && !alert.ticketNotified) {
      const prev = prevSnapshotsMap?.get(movie.slug);
      const flippedNowShowing =
        Boolean(movie.isNowShowing) && (!prev || !prev.isNowShowing || prev.isUpcoming);

      if (flippedNowShowing) {
        dispatches.push({
          reason: "CATALOG_NOW_SHOWING",
          alert,
          movie,
          freshShows: [],
          newShowIds: [],
          shouldRemoveAfterSend: alert.alertMode !== "new_shows",
        });
      }
    }
  }

  return dispatches;
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
    rawSynopsis.length > 400
      ? `${escapeHtml(rawSynopsis.slice(0, 397))}...`
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

export function formatShowtimesByBranch(
  movie,
  venue,
  shows,
  hallsMap,
  uiLang = "bn",
  brandName = "STAR Cineplex"
) {
  const movieTitle = escapeHtml(getLocalizedText(movie.title, uiLang));
  const venueName = escapeHtml(getVenueName(venue, uiLang));

  if (!shows || shows.length === 0) {
    return uiLang === "bn"
      ? `🎬 <b>${movieTitle}</b>\n🏢 <b>${venueName}</b>\n\n😔 এই ব্রাঞ্চে এখন কোনো সক্রিয় শোটাইম নেই। নিচে অ্যালার্ট সেট করে রাখলে টিকিট ছাড়ার সাথে সাথেই খবর পাবেন!`
      : `🎬 <b>${movieTitle}</b>\n🏢 <b>${venueName}</b>\n\n😔 No active showtimes at this branch right now. Set a branch alert below to get notified the second tickets go live!`;
  }

  // Group shows by date
  const byDate = new Map();
  const sorted = [...shows].sort((a, b) =>
    `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)
  );
  for (const s of sorted) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }

  const lines = [
    `🎬 <b>${movieTitle}</b>`,
    `🏢 <b>${venueName}</b>`,
    "",
  ];

  let dateCount = 0;
  for (const [date, dayShows] of byDate.entries()) {
    if (dateCount >= 4) break;
    dateCount += 1;
    lines.push(`📅 <b>${escapeHtml(date)}</b>`);
    for (const s of dayShows.slice(0, 8)) {
      const time = formatTime12h(s.time);
      const hall = getHallName(s.hallId, hallsMap, uiLang);
      const price = formatShowPriceRange(s);
      const seat = formatSeatBadge(s.availableSeats, s.totalSeats, uiLang);
      const parts = [
        `🕒 <b>${escapeHtml(time)}</b>`,
        s.format ? `[${escapeHtml(s.format)}]` : "",
        hall ? `• ${escapeHtml(hall)}` : "",
        price ? `• ${escapeHtml(price)}` : "",
        seat ? `• ${seat}` : "",
      ].filter(Boolean);
      lines.push(`  ${parts.join(" ")}`);
    }
    lines.push("");
  }

  lines.push(`🏛 <i>${escapeHtml(brandName)}</i>`);
  return lines.join("\n").trim();
}

export function formatTicketDropAlertWithShows(
  dispatch,
  venuesMap,
  hallsMap,
  uiLang = "bn",
  brandName = "STAR Cineplex"
) {
  const title = escapeHtml(getLocalizedText(dispatch.movie.title, uiLang));
  const isNewShows = dispatch.reason === "NEW_SHOWS_DROPPED";
  const header =
    uiLang === "bn"
      ? isNewShows
        ? "🔥 <b>নতুন শোটাইম ছেড়েছে!</b>"
        : "🚨🎟️ <b>টিকিট ছেড়ে দিয়েছে!</b>"
      : isNewShows
        ? "🔥 <b>New Showtimes Just Dropped!</b>"
        : "🚨🎟️ <b>Tickets Are Live Now!</b>";

  const lines = [header, "", `🎬 <b>${title}</b>`];

  if (dispatch.freshShows && dispatch.freshShows.length > 0) {
    // Group fresh shows by venueId
    const byVenue = new Map();
    for (const s of dispatch.freshShows) {
      if (!byVenue.has(s.venueId)) byVenue.set(s.venueId, []);
      byVenue.get(s.venueId).push(s);
    }

    let venueShown = 0;
    for (const [venueId, vShows] of byVenue.entries()) {
      if (venueShown >= 3) {
        const remaining = byVenue.size - venueShown;
        lines.push(
          uiLang === "bn"
            ? `<i>+ আরও ${remaining}টি ব্রাঞ্চে টিকিট চালু হয়েছে</i>`
            : `<i>+ ${remaining} more branch(es) live</i>`
        );
        break;
      }
      venueShown += 1;
      const venue = venuesMap?.get(venueId);
      const vName = escapeHtml(
        getVenueName(venue, uiLang) || dispatch.alert.targetVenueName || brandName
      );
      lines.push(`\n🏢 <b>${vName}</b>`);

      const sorted = [...vShows].sort((a, b) =>
        `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)
      );
      for (const s of sorted.slice(0, 4)) {
        const hall = getHallName(s.hallId, hallsMap, uiLang);
        const price = formatShowPriceRange(s);
        const seat = formatSeatBadge(s.availableSeats, s.totalSeats, uiLang);
        const row = [
          `📅 ${escapeHtml(s.date)}`,
          `🕒 <b>${escapeHtml(formatTime12h(s.time))}</b>`,
          s.format ? `(${escapeHtml(s.format)})` : "",
          hall ? `• ${escapeHtml(hall)}` : "",
          price ? `• ${escapeHtml(price)}` : "",
          seat ? `• ${seat}` : "",
        ].filter(Boolean);
        lines.push(`• ${row.join(" ")}`);
      }
      if (sorted.length > 4) {
        lines.push(
          uiLang === "bn"
            ? `  <i>...আরও ${sorted.length - 4}টি শো আছে</i>`
            : `  <i>...+${sorted.length - 4} more show(s)</i>`
        );
      }
    }
  } else {
    const formats = (dispatch.movie.formats || []).join(", ");
    lines.push(
      uiLang === "bn"
        ? `🟢 এখন ${escapeHtml(brandName)}-এ চলছে${formats ? ` (${escapeHtml(formats)})` : ""}।`
        : `🟢 Now showing at ${escapeHtml(brandName)}${formats ? ` (${escapeHtml(formats)})` : ""}.`
    );
  }

  lines.push(
    uiLang === "bn"
      ? "\n⚡ ভালো সিট পেতে নিচের বাটনে ট্যাপ করে দ্রুত টিকিট কেটে নিন!"
      : "\n⚡ Tap below to grab the best seats now!"
  );

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
