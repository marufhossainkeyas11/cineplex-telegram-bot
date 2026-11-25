import { Bot, InlineKeyboard, Keyboard } from "grammy";
import { getActiveMovies, getCatalogMeta, getMovieDetail } from "./api.js";
import { config } from "./config.js";
import {
  escapeHtml,
  formatMovieDetailCard,
  formatMovieSummaryCard,
  getLocalizedText,
  getTrailerUrl,
  searchMovies,
} from "./core.js";

function buildMainReplyKeyboard(lang) {
  if (lang === "en") {
    return new Keyboard()
      .text("🎬 Now Showing")
      .text("🗓️ Upcoming")
      .row()
      .text("🎭 Genres")
      .text("🌐 Languages")
      .row()
      .text("🔔 My Alerts")
      .text("🌐 বাংলা / EN")
      .resized();
  }
  return new Keyboard()
    .text("🎬 এখন চলছে")
    .text("🗓️ আসছে শীঘ্রই")
    .row()
    .text("🎭 জনরা")
    .text("🌐 ভাষা")
    .row()
    .text("🔔 আমার অ্যালার্ট")
    .text("🌐 বাংলা / EN")
    .resized();
}

async function sendPhotoOrText(ctx, photoUrl, text, replyMarkup) {
  if (photoUrl) {
    try {
      await ctx.replyWithPhoto(photoUrl, {
        caption: text,
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      });
      return;
    } catch {
      // Fallback to text if photo cannot be sent
    }
  }
  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: replyMarkup,
  });
}

async function renderMovieCard(ctx, storage, { listKey, movies, index, lang }) {
  if (!movies.length) {
    const emptyMsg =
      lang === "bn"
        ? "এই ক্যাটাগরিতে এখন কোনো মুভি পাওয়া যায়নি।"
        : "No movies found in this category right now.";
    await ctx.reply(emptyMsg);
    return;
  }

  const safeIndex = ((index % movies.length) + movies.length) % movies.length;
  const movie = movies[safeIndex];
  const meta = await getCatalogMeta();
  const hasAlert = await storage.hasAlert(ctx.chat.id, movie.slug);

  const caption =
    formatMovieSummaryCard(movie, meta, lang, config.publicBrandName) +
    `\n\n📄 ${safeIndex + 1} / ${movies.length}`;

  const kb = new InlineKeyboard();

  // Primary action row
  kb.text(lang === "bn" ? "📖 বিস্তারিত" : "📖 Details", `movie:${movie.slug}`);
  if (movie.isUpcoming) {
    kb.text(
      hasAlert
        ? lang === "bn"
          ? "🔕 অ্যালার্ট চালু আছে"
          : "🔕 Alert Active"
        : lang === "bn"
          ? "🔔 টিকিট ছাড়লে জানাও"
          : "🔔 Notify Me",
      `alert:${movie.slug}`
    );
  } else {
    kb.url(
      lang === "bn" ? "🎟️ টিকিট কাটুন" : "🎟️ Book Tickets",
      config.publicSiteUrl
    );
  }

  // Pagination row
  if (movies.length > 1) {
    kb.row()
      .text("⬅️", `page:${listKey}:${safeIndex - 1}`)
      .text(`${safeIndex + 1}/${movies.length}`, "noop")
      .text("➡️", `page:${listKey}:${safeIndex + 1}`);
  }

  await sendPhotoOrText(ctx, movie.posterUrl, caption, kb);
}

async function getFilteredMovies(listKey) {
  const all = await getActiveMovies();
  if (listKey === "now") return all.filter((m) => m.isNowShowing);
  if (listKey === "up") return all.filter((m) => m.isUpcoming);
  if (listKey.startsWith("genre_")) {
    const slug = listKey.slice("genre_".length);
    return all.filter((m) => Array.isArray(m.genres) && m.genres.includes(slug));
  }
  if (listKey.startsWith("lang_")) {
    const code = listKey.slice("lang_".length);
    return all.filter((m) => m.language === code);
  }
  return all;
}

export function createBot(storage) {
  if (!config.botToken) {
    throw new Error("BOT_TOKEN is missing in environment variables.");
  }

  const bot = new Bot(config.botToken);

  // /start
  bot.command("start", async (ctx) => {
    const user = await storage.ensureUser(ctx.chat.id);
    const lang = user.lang;
    const text =
      lang === "bn"
        ? `👋 <b>${escapeHtml(config.publicBrandName)} বটে স্বাগতম!</b>\n\nএখান থেকে আপনি জানতে পারবেন:\n• 🎬 এখন কোন মুভি চলছে\n• 🗓️ সামনে কোন মুভি আসছে\n• 🔔 আপকামিং মুভির টিকিট ছাড়লেই অটো অ্যালার্ট\n• 🎭 জনরা ও ভাষা অনুযায়ী ফিল্টার এবং সার্চ\n\nনিচের মেনু থেকে বাছুন অথবা যেকোনো মুভির নাম লিখে পাঠান!`
        : `👋 <b>Welcome to ${escapeHtml(config.publicBrandName)} Bot!</b>\n\nHere you can:\n• 🎬 Browse Now Showing movies\n• 🗓️ Explore Upcoming releases\n• 🔔 Set automatic Ticket Release alerts\n• 🎭 Filter by genre, language, or search by title\n\nPick an option below or simply type any movie name!`;

    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: buildMainReplyKeyboard(lang),
    });
  });

  // /help
  bot.command("help", async (ctx) => {
    const user = await storage.getUser(ctx.chat.id);
    const text =
      user.lang === "bn"
        ? `<b>📌 কমান্ড তালিকা</b>\n/nowshowing — এখন চলছে এমন মুভি\n/upcoming — আপকামিং মুভি ও টিকিট অ্যালার্ট\n/genres — জনরা অনুযায়ী মুভি\n/languages — ভাষা অনুযায়ী মুভি\n/search &lt;নাম&gt; — মুভি খুঁজুন\n/myalerts — আপনার সেট করা অ্যালার্ট\n/lang — বাংলা / English পরিবর্তন\n\n🌐 ওয়েবসাইট: ${escapeHtml(config.publicSiteUrl)}`
        : `<b>📌 Commands</b>\n/nowshowing — Currently playing movies\n/upcoming — Upcoming movies & ticket alerts\n/genres — Browse by genre\n/languages — Browse by language\n/search &lt;name&gt; — Search movies\n/myalerts — Manage your active alerts\n/lang — Switch Bangla / English\n\n🌐 Website: ${escapeHtml(config.publicSiteUrl)}`;

    await ctx.reply(text, { parse_mode: "HTML" });
  });

  // /nowshowing
  const handleNowShowing = async (ctx) => {
    const user = await storage.ensureUser(ctx.chat.id);
    const movies = await getFilteredMovies("now");
    await renderMovieCard(ctx, storage, {
      listKey: "now",
      movies,
      index: 0,
      lang: user.lang,
    });
  };
  bot.command("nowshowing", handleNowShowing);
  bot.hears(["🎬 এখন চলছে", "🎬 Now Showing"], handleNowShowing);

  // /upcoming
  const handleUpcoming = async (ctx) => {
    const user = await storage.ensureUser(ctx.chat.id);
    const movies = await getFilteredMovies("up");
    await renderMovieCard(ctx, storage, {
      listKey: "up",
      movies,
      index: 0,
      lang: user.lang,
    });
  };
  bot.command("upcoming", handleUpcoming);
  bot.hears(["🗓️ আসছে শীঘ্রই", "🗓️ Upcoming"], handleUpcoming);

  // /genres
  const handleGenres = async (ctx) => {
    const user = await storage.ensureUser(ctx.chat.id);
    const { genres } = await getCatalogMeta();
    const kb = new InlineKeyboard();

    genres.forEach((g, idx) => {
      kb.text(getLocalizedText(g.name, user.lang), `filter:genre_${g.slug}`);
      if (idx % 2 === 1) kb.row();
    });

    await ctx.reply(
      user.lang === "bn"
        ? "🎭 কোন জনরার মুভি দেখতে চান?"
        : "🎭 Choose a genre:",
      { reply_markup: kb }
    );
  };
  bot.command("genres", handleGenres);
  bot.hears(["🎭 জনরা", "🎭 Genres"], handleGenres);

  // /languages
  const handleLanguages = async (ctx) => {
    const user = await storage.ensureUser(ctx.chat.id);
    const { languages } = await getCatalogMeta();
    const kb = new InlineKeyboard();

    languages.forEach((l, idx) => {
      kb.text(getLocalizedText(l.name, user.lang), `filter:lang_${l.code}`);
      if (idx % 2 === 1) kb.row();
    });

    await ctx.reply(
      user.lang === "bn"
        ? "🌐 কোন ভাষার মুভি দেখতে চান?"
        : "🌐 Choose a language:",
      { reply_markup: kb }
    );
  };
  bot.command("languages", handleLanguages);
  bot.hears(["🌐 ভাষা", "🌐 Languages"], handleLanguages);

  // /lang toggle
  const handleLangToggle = async (ctx) => {
    const current = await storage.ensureUser(ctx.chat.id);
    const nextLang = current.lang === "bn" ? "en" : "bn";
    await storage.setUserLang(ctx.chat.id, nextLang);

    const msg =
      nextLang === "bn"
        ? "✅ ভাষা <b>বাংলা</b>-তে সেট করা হয়েছে।"
        : "✅ Language switched to <b>English</b>.";
    await ctx.reply(msg, {
      parse_mode: "HTML",
      reply_markup: buildMainReplyKeyboard(nextLang),
    });
  };
  bot.command("lang", handleLangToggle);
  bot.hears("🌐 বাংলা / EN", handleLangToggle);

  // /myalerts
  const handleMyAlerts = async (ctx) => {
    const user = await storage.ensureUser(ctx.chat.id);
    const alerts = await storage.getUserAlerts(ctx.chat.id);
    const kb = new InlineKeyboard();

    alerts.forEach((a) => {
      const label = a.movieTitle || a.slug;
      kb.text(`📖 ${label}`, `movie:${a.slug}`)
        .text("❌", `unalert:${a.slug}`)
        .row();
    });

    kb.text(
      user.notifyNewMovies
        ? user.lang === "bn"
          ? "🔕 নতুন মুভি অ্যালার্ট: চালু"
          : "🔕 New Movie Alerts: ON"
        : user.lang === "bn"
          ? "🆕 নতুন মুভি এলে জানাও: বন্ধ"
          : "🆕 New Movie Alerts: OFF",
      "toggle_global_new"
    );

    const text =
      alerts.length > 0
        ? user.lang === "bn"
          ? `🔔 <b>আপনার সেট করা টিকিট অ্যালার্ট (${alerts.length}টি):</b>\nটিকিট ছাড়লেই আপনাকে মেসেজ পাঠানো হবে।`
          : `🔔 <b>Your Active Ticket Alerts (${alerts.length}):</b>\nYou'll be notified the moment tickets go live.`
        : user.lang === "bn"
          ? "🔔 আপনার কোনো মুভির টিকিট অ্যালার্ট সেট করা নেই।\n<b>🗓️ আসছে শীঘ্রই</b> থেকে যেকোনো মুভিতে অ্যালার্ট চালু করুন।"
          : "🔔 You don't have any active ticket alerts yet.\nOpen <b>🗓️ Upcoming</b> to set alerts on any movie.";

    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
  };
  bot.command("myalerts", handleMyAlerts);
  bot.hears(["🔔 আমার অ্যালার্ট", "🔔 My Alerts"], handleMyAlerts);

  // /search <query>
  const runSearch = async (ctx, query) => {
    const user = await storage.ensureUser(ctx.chat.id);
    if (!query) {
      await ctx.reply(
        user.lang === "bn"
          ? "🔍 মুভির নাম লিখুন। উদাহরণ: <code>/search Avengers</code>"
          : "🔍 Please enter a movie name. Example: <code>/search Avengers</code>",
        { parse_mode: "HTML" }
      );
      return;
    }

    const movies = await getActiveMovies();
    const matches = searchMovies(movies, query);
    if (!matches.length) {
      await ctx.reply(
        user.lang === "bn"
          ? `😔 "<b>${escapeHtml(query)}</b>" নামে কোনো অ্যাক্টিভ মুভি পাওয়া যায়নি।`
          : `😔 No active movies matched "<b>${escapeHtml(query)}</b>".`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const kb = new InlineKeyboard();
    matches.slice(0, 8).forEach((m) => {
      const tag = m.isNowShowing ? "🟢" : "🗓️";
      kb.text(`${tag} ${getLocalizedText(m.title, user.lang)}`, `movie:${m.slug}`).row();
    });

    await ctx.reply(
      user.lang === "bn"
        ? `🔍 "<b>${escapeHtml(query)}</b>"-এর জন্য ${matches.length}টি মুভি পাওয়া গেছে:`
        : `🔍 Found ${matches.length} movie(s) for "<b>${escapeHtml(query)}</b>":`,
      { parse_mode: "HTML", reply_markup: kb }
    );
  };

  bot.command("search", async (ctx) => {
    await runSearch(ctx, ctx.match?.trim());
  });

  // Callback: Filter selection
  bot.callbackQuery(/^filter:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const listKey = ctx.match[1];
    const user = await storage.ensureUser(ctx.chat.id);
    const movies = await getFilteredMovies(listKey);
    await renderMovieCard(ctx, storage, {
      listKey,
      movies,
      index: 0,
      lang: user.lang,
    });
  });

  // Callback: Pagination
  bot.callbackQuery(/^page:([^:]+):(-?\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const listKey = ctx.match[1];
    const nextIndex = Number(ctx.match[2]);
    const user = await storage.ensureUser(ctx.chat.id);
    const movies = await getFilteredMovies(listKey);

    try {
      await ctx.deleteMessage();
    } catch {
      // Ignore if message is too old to delete
    }
    await renderMovieCard(ctx, storage, {
      listKey,
      movies,
      index: nextIndex,
      lang: user.lang,
    });
  });

  // Callback: Movie details
  bot.callbackQuery(/^movie:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const slug = ctx.match[1];
    const user = await storage.ensureUser(ctx.chat.id);

    const [detail, meta, hasAlert] = await Promise.all([
      getMovieDetail(slug).catch(() => null),
      getCatalogMeta(),
      storage.hasAlert(ctx.chat.id, slug),
    ]);

    if (!detail) {
      await ctx.reply(
        user.lang === "bn"
          ? "দুঃখিত, এই মুভির বিস্তারিত তথ্য এখন পাওয়া যাচ্ছে না।"
          : "Sorry, detailed info for this movie is currently unavailable."
      );
      return;
    }

    const text = formatMovieDetailCard(
      detail,
      meta,
      user.lang,
      config.publicBrandName
    );
    const trailerUrl = getTrailerUrl(detail);

    const kb = new InlineKeyboard();
    if (trailerUrl) {
      kb.url(user.lang === "bn" ? "▶️ ট্রেলার দেখুন" : "▶️ Watch Trailer", trailerUrl);
    }
    if (detail.isUpcoming) {
      kb.text(
        hasAlert
          ? user.lang === "bn"
            ? "🔕 অ্যালার্ট বাতিল করুন"
            : "🔕 Remove Alert"
          : user.lang === "bn"
            ? "🔔 টিকিট ছাড়লে জানাও"
            : "🔔 Notify When Live",
        `alert:${slug}`
      );
    }
    kb.row().url(
      user.lang === "bn"
        ? `🎟️ ${config.publicBrandName} ওয়েবসাইট`
        : `🎟️ Visit ${config.publicBrandName}`,
      config.publicSiteUrl
    );

    const image = detail.posterUrl || detail.backdropUrl || detail.bannerUrl;
    await sendPhotoOrText(ctx, image, text, kb);
  });

  // Callback: Toggle movie ticket alert
  bot.callbackQuery(/^alert:(.+)$/, async (ctx) => {
    const slug = ctx.match[1];
    const user = await storage.ensureUser(ctx.chat.id);
    const movies = await getActiveMovies().catch(() => []);
    const movie = movies.find((m) => m.slug === slug);
    const title = movie ? getLocalizedText(movie.title, user.lang) : slug;

    const enabled = await storage.toggleAlert(ctx.chat.id, slug, title);
    await ctx.answerCallbackQuery({
      text: enabled
        ? user.lang === "bn"
          ? `🔔 "${title}"-এর টিকিট অ্যালার্ট চালু হয়েছে!`
          : `🔔 Ticket alert enabled for "${title}"!`
        : user.lang === "bn"
          ? `🔕 "${title}"-এর অ্যালার্ট বাতিল করা হয়েছে।`
          : `🔕 Alert removed for "${title}".`,
      show_alert: true,
    });
  });

  // Callback: Remove alert from /myalerts
  bot.callbackQuery(/^unalert:(.+)$/, async (ctx) => {
    const slug = ctx.match[1];
    const user = await storage.ensureUser(ctx.chat.id);
    await storage.removeAlert(ctx.chat.id, slug);
    await ctx.answerCallbackQuery({
      text: user.lang === "bn" ? "অ্যালার্ট মুছে ফেলা হয়েছে।" : "Alert removed.",
    });
    try {
      await ctx.deleteMessage();
    } catch {
      // ignore
    }
    await handleMyAlerts(ctx);
  });

  // Callback: Toggle global new-movie alert
  bot.callbackQuery("toggle_global_new", async (ctx) => {
    const user = await storage.ensureUser(ctx.chat.id);
    const enabled = await storage.toggleNewMovieAlerts(ctx.chat.id);
    await ctx.answerCallbackQuery({
      text: enabled
        ? user.lang === "bn"
          ? "✅ নতুন মুভি যুক্ত হলে আপনাকে জানানো হবে!"
          : "✅ You will be alerted when new movies are added!"
        : user.lang === "bn"
          ? "🔕 নতুন মুভি অ্যালার্ট বন্ধ করা হয়েছে।"
          : "🔕 New movie alerts turned off.",
    });
    try {
      await ctx.deleteMessage();
    } catch {
      // ignore
    }
    await handleMyAlerts(ctx);
  });

  bot.callbackQuery("noop", async (ctx) => ctx.answerCallbackQuery());

  // Inline query search (@yourbot <query>)
  bot.on("inline_query", async (ctx) => {
    const q = ctx.inlineQuery.query.trim();
    const movies = await getActiveMovies().catch(() => []);
    const matched = q ? searchMovies(movies, q) : movies.slice(0, 10);
    const meta = await getCatalogMeta();

    const results = matched.slice(0, 10).map((m) => ({
      type: "article",
      id: m.slug,
      title: getLocalizedText(m.title, "en"),
      description: `${m.isNowShowing ? "Now Showing" : "Upcoming"} • ${m.localReleaseDate || ""}`,
      thumbnail_url: m.posterUrl || undefined,
      input_message_content: {
        message_text: formatMovieSummaryCard(
          m,
          meta,
          "bn",
          config.publicBrandName
        ),
        parse_mode: "HTML",
      },
      reply_markup: new InlineKeyboard().url(
        `🎟️ ${config.publicBrandName}`,
        config.publicSiteUrl
      ),
    }));

    await ctx.answerInlineQuery(results, { cache_time: 120 });
  });

  // Free-text message -> smart movie search
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text || text.startsWith("/")) return;
    await runSearch(ctx, text);
  });

  // Global error handler (never exposes internal API URLs)
  bot.catch((err) => {
    console.error("[bot] Unhandled error:", err?.error?.message || err.message);
  });

  return bot;
}
