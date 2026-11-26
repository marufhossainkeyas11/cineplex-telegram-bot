import { InlineKeyboard } from "grammy";
import { getActiveMovies, getAllBranchesShows } from "./api.js";
import { config } from "./config.js";
import {
  diffMovies,
  evaluateZeroMissAlerts,
  formatAlertNotification,
  formatTicketDropAlertWithShows,
  getDaysUntilRelease,
  isShowSelling,
} from "./core.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let isChecking = false;

function shortMovieKey(movie) {
  return String(movie?.id || movie?.slug || "").slice(0, 12);
}

async function sendAlertSafe(bot, storage, chatId, movie, text, uiLang, { showShowtimesBtn = true } = {}) {
  const kb = new InlineKeyboard();
  if (showShowtimesBtn && movie?.id) {
    kb.text(
      uiLang === "bn" ? "🕒 শোটাইম ও সিট" : "🕒 Showtimes & Seats",
      `stm:${shortMovieKey(movie)}`
    );
  }
  kb.url(
    uiLang === "bn" ? "🎟️ টিকিট কাটুন" : "🎟️ Book Tickets",
    config.publicSiteUrl
  );

  try {
    if (movie?.posterUrl) {
      try {
        await bot.api.sendPhoto(chatId, movie.posterUrl, {
          caption: text,
          parse_mode: "HTML",
          reply_markup: kb,
        });
        return true;
      } catch {
        // Fallback to text if Telegram cannot fetch poster
      }
    }

    await bot.api.sendMessage(chatId, text, {
      parse_mode: "HTML",
      reply_markup: kb,
    });
    return true;
  } catch (err) {
    const code = err?.error_code;
    if (code === 403 || code === 400) {
      await storage.removeAllForUser(chatId).catch(() => {});
    } else {
      console.error(`[monitor] Failed to alert ${chatId}:`, err?.message || err);
    }
    return false;
  }
}

export async function runCatalogCheck(bot, storage) {
  if (isChecking) {
    return { skipped: true, reason: "check_already_running" };
  }

  isChecking = true;
  const summary = {
    checkedAt: new Date().toISOString(),
    moviesCount: 0,
    venuesScraped: 0,
    venuesFailed: 0,
    totalShows: 0,
    sellingShows: 0,
    ticketAlertsSent: 0,
    catalogUpdatesSent: 0,
    remindersSent: 0,
  };

  try {
    // 1. Fetch live catalog AND scrape all 9 branches' RSC showtimes in parallel
    const [currentMovies, branchData, prevSnapshots, allAlerts] = await Promise.all([
      getActiveMovies({ forceRefresh: true }),
      getAllBranchesShows({ forceRefresh: true }),
      storage.getSnapshotsMap(),
      storage.getAllAlerts(),
    ]);

    summary.moviesCount = currentMovies.length;
    summary.venuesScraped = branchData.venuesScraped;
    summary.venuesFailed = branchData.venuesFailed;
    summary.totalShows = branchData.shows.length;
    summary.sellingShows = branchData.shows.filter(isShowSelling).length;

    // 2. ZERO-MISS TICKET DROP EVALUATION (Live Branch Shows + Catalog Fallback)
    const dispatches = evaluateZeroMissAlerts({
      alerts: allAlerts,
      currentMovies,
      currentShows: branchData.shows,
      prevSnapshotsMap: prevSnapshots,
    });

    for (const dispatch of dispatches) {
      const { alert, movie, newShowIds, shouldRemoveAfterSend } = dispatch;
      const text = formatTicketDropAlertWithShows(
        dispatch,
        branchData.venuesMap,
        branchData.hallsMap,
        alert.lang,
        config.publicBrandName
      );

      const sent = await sendAlertSafe(
        bot,
        storage,
        alert.chatId,
        movie,
        text,
        alert.lang,
        { showShowtimesBtn: true }
      );

      // Guaranteed at-least-once delivery: only mark/remove AFTER confirmed send!
      if (sent) {
        summary.ticketAlertsSent += 1;
        if (shouldRemoveAfterSend) {
          await storage.removeAlert(alert.chatId, alert.slug).catch(() => {});
        } else {
          await storage
            .markAlertNotified(alert.chatId, alert.slug, newShowIds)
            .catch(() => {});
        }
      }
      await sleep(50);
    }

    // 3. Catalog-level secondary events (Release date changes, New formats, New movies)
    const catalogEvents = diffMovies(prevSnapshots, currentMovies);
    await storage.saveSnapshots(currentMovies);

    for (const event of catalogEvents) {
      if (
        event.type === "RELEASE_DATE_CHANGED" ||
        event.type === "NEW_FORMATS_ADDED"
      ) {
        const subscribers = await storage.getSubscribersForMovie(event.slug);
        for (const sub of subscribers) {
          const text = formatAlertNotification(
            event,
            sub.lang,
            config.publicBrandName
          );
          const sent = await sendAlertSafe(
            bot,
            storage,
            sub.chatId,
            event.movie,
            text,
            sub.lang,
            { showShowtimesBtn: false }
          );
          if (sent) summary.catalogUpdatesSent += 1;
          await sleep(50);
        }
      } else if (
        event.type === "NEW_NOW_SHOWING" ||
        event.type === "NEW_UPCOMING"
      ) {
        const globalSubs = await storage.getNewMovieSubscribers();
        for (const sub of globalSubs) {
          const text = formatAlertNotification(
            event,
            sub.lang,
            config.publicBrandName
          );
          const sent = await sendAlertSafe(
            bot,
            storage,
            sub.chatId,
            event.movie,
            text,
            sub.lang,
            { showShowtimesBtn: event.type === "NEW_NOW_SHOWING" }
          );
          if (sent) summary.catalogUpdatesSent += 1;
          await sleep(50);
        }
      }
    }

    // 4. 1-day-before release reminder
    for (const movie of currentMovies) {
      if (!movie.isUpcoming) continue;
      const daysLeft = getDaysUntilRelease(
        movie.localReleaseDate || movie.releaseDate
      );
      if (daysLeft !== 1) continue;

      const subscribers = await storage.getSubscribersForMovie(movie.slug);
      for (const sub of subscribers) {
        if (sub.remindedBeforeRelease) continue;
        const text = formatAlertNotification(
          { type: "RELEASE_TOMORROW", slug: movie.slug, movie },
          sub.lang,
          config.publicBrandName
        );
        const sent = await sendAlertSafe(
          bot,
          storage,
          sub.chatId,
          movie,
          text,
          sub.lang,
          { showShowtimesBtn: false }
        );
        if (sent) {
          summary.remindersSent += 1;
          await storage.markRemindedBeforeRelease(sub.chatId, movie.slug);
        }
        await sleep(50);
      }
    }

    return summary;
  } finally {
    isChecking = false;
  }
}
