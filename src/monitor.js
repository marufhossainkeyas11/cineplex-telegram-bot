import { InlineKeyboard } from "grammy";
import { getActiveMovies } from "./api.js";
import { config } from "./config.js";
import {
  diffMovies,
  formatAlertNotification,
  getDaysUntilRelease,
} from "./core.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let isChecking = false;

async function sendAlertSafe(bot, storage, chatId, movie, text, uiLang) {
  const kb = new InlineKeyboard()
    .text(uiLang === "bn" ? "📖 বিস্তারিত" : "📖 Details", `movie:${movie.slug}`)
    .url(
      uiLang === "bn" ? "🎟️ টিকিট কাটুন" : "🎟️ Book Tickets",
      config.publicSiteUrl
    );

  try {
    if (movie.posterUrl) {
      try {
        await bot.api.sendPhoto(chatId, movie.posterUrl, {
          caption: text,
          parse_mode: "HTML",
          reply_markup: kb,
        });
        return true;
      } catch {
        // Fallback to text if Telegram cannot fetch the poster image
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
      // User blocked the bot or chat is invalid; clean up alerts
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
    eventsDetected: 0,
    notificationsSent: 0,
    remindersSent: 0,
  };

  try {
    const currentMovies = await getActiveMovies({ forceRefresh: true });
    summary.moviesCount = currentMovies.length;

    const prevSnapshots = await storage.getSnapshotsMap();
    const events = diffMovies(prevSnapshots, currentMovies);
    summary.eventsDetected = events.length;

    // Persist new snapshots before sending so repeated crashes won't double-send
    await storage.saveSnapshots(currentMovies);

    for (const event of events) {
      if (
        event.type === "TICKET_RELEASED" ||
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
            sub.lang
          );
          if (sent) summary.notificationsSent += 1;

          // Auto-remove movie alert once tickets are released
          if (event.type === "TICKET_RELEASED") {
            await storage.removeAlert(sub.chatId, event.slug).catch(() => {});
          }
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
            sub.lang
          );
          if (sent) summary.notificationsSent += 1;
          await sleep(50);
        }
      }
    }

    // 1-day-before release reminder for subscribed upcoming movies
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
          sub.lang
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
