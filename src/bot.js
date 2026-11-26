import { Bot, InlineKeyboard, Keyboard } from "grammy";
import {
  getActiveMovies,
  getAllBranchesShows,
  getBranchShows,
  getCatalogMeta,
  getMovieDetail,
  getVenues,
} from "./api.js";
import { config } from "./config.js";
import {
  escapeHtml,
  formatMovieDetailCard,
  formatMovieSummaryCard,
  formatSeatBadge,
  formatShowPriceRange,
  formatShowtimesByBranch,
  formatTime12h,
  getLocalizedText,
  getTrailerUrl,
  getVenueName,
  isShowSelling,
  searchMovies,
} from "./core.js";

// Short stable keys to stay well within Telegram's 64-byte callback_data limit
const movieKey = (movie) => String(movie?.id || movie?.slug || "").slice(0, 12);
const venueKey = (venue) => String(venue?.id || "").slice(-8);

async function resolveMovieByKey(key) {
  const movies = await getActiveMovies();
  return (
    movies.find(
      (m) =>
        m.id === key ||
        (m.id && m.id.startsWith(key)) ||
        m.slug === key
    ) || null
  );
}

async function resolveVenueByKey(key) {
  const venues = await getVenues();
  return (
    venues.find(
      (v) =>
        v.id === key ||
        (v.id && v.id.endsWith(key)) ||
        v.slug === key
    ) || null
  );
}

function buildMainReplyKeyboard(lang) {
  if (lang === "en") {
    return new Keyboard()
      .text("🎬 Now Showing")
      .text("🗓️ Upcoming")
      .row()
      .text("🏢 Branches & Shows")
      .text("🔔 My Alerts")
      .row()
      .text("🎭 Genres")
      .text("🌐 Languages")
      .text("🌐 বাংলা / EN")
      .resized();
  }
  return new Keyboard()
    .text("🎬 এখন চলছে")
    .text("🗓️ আসছে শীঘ্রই")
    .row()
    .text("🏢 ব্রাঞ্চ ও শোটাইম")
    .text("🔔 আমার অ্যালার্ট")
    .row()
    .text("🎭 জনরা")
    .text("🌐 ভাষা")
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
  const alert = await storage.getAlert(ctx.chat.id, movie.slug);
  const mKey = movieKey(movie);

  const caption =
    formatMovieSummaryCard(movie, meta, lang, config.publicBrandName) +
    `\n\n📄 ${safeIndex + 1} / ${movies.length}`;

  const kb = new InlineKeyboard();
  kb.text(lang === "bn" ? "📖 বিস্তারিত" : "📖 Details", `mv:${mKey}`);
  kb.text(lang === "bn" ? "🕒 শোটাইম ও সিট" : "🕒 Showtimes", `stm:${mKey}`);

  kb.row();
  kb.text(
    alert
      ? lang === "bn"
        ? "🔕 অ্যালার্ট চালু আছে"
        : "🔕 Alert Active"
      : lang === "bn"
        ? "🔔 টিকিট অ্যালার্ট"
        : "🔔 Ticket Alert",
    `am:${mKey}`
  );
  kb.url(
    lang === "bn" ? "🎟️ টিকিট কাটুন" : "🎟️ Book Tickets",
    config.publicSiteUrl
  );

  if (movies.length > 1) {
    kb.row()
      .text("⬅️", `page:${listKey}:${safeIndex - 1}`)
      .text(`${safeIndex + 1}/${movies.length}`, "noop")
      .text("➡️", `page:${listKey}:${safeIndex + 1}`);
  }

  await sendPhotoOrText(ctx, movie.posterUrl, caption, kb);
}

async function renderAlertSetupMenu(ctx, storage, movie, user) {
  const venues = await getVenues();
  const existing = await storage.getAlert(ctx.chat.id, movie.slug);
  const mKey = movieKey(movie);
  const title = escapeHtml(getLocalizedText(movie.title, user.lang));

  const kb = new InlineKeyboard();

  // Quick 1-tap: All Branches
  kb.text(
    user.lang === "bn"
      ? "🌍 সব ব্রাঞ্চ (টিকিট ছাড়লেই)"
      : "🌍 All Branches (First Drop)",
    `al:${mKey}:all:0`
  ).row();

  // Quick 1-tap: Continuous new showtimes mode (All Branches)
  kb.text(
    user.lang === "bn"
      ? "🔁 সব ব্রাঞ্চ (নতুন শো এলেও জানাও)"
      : "🔁 All Branches (Every New Show)",
    `al:${mKey}:all:1`
  ).row();

  // Quick 1-tap: User's Preferred Branch if set
  if (user.preferredVenueId) {
    const prefVenue = venues.find((v) => v.id === user.preferredVenueId);
    if (prefVenue) {
      const prefName = getVenueName(prefVenue, user.lang);
      kb.text(
        user.lang === "bn"
          ? `⭐ শুধু ${prefName}`
          : `⭐ Only ${prefName}`,
        `al:${mKey}:${venueKey(prefVenue)}:0`
      ).row();
    }
  }

  // Pick any specific branch from the 9 venues
  venues.forEach((v, idx) => {
    kb.text(`🏢 ${getVenueName(v, user.lang)}`, `al:${mKey}:${venueKey(v)}:0`);
    if (idx % 2 === 1) kb.row();
  });
  if (venues.length % 2 === 1) kb.row();

  if (existing) {
    kb.text(
      user.lang === "bn" ? "❌ বর্তমান অ্যালার্ট বাতিল করুন" : "❌ Remove Current Alert",
      `unalert:${mKey}`
    );
  }

  const currentStatus = existing
    ? user.lang === "bn"
      ? `\n\n✅ বর্তমান অ্যালার্ট: <b>${escapeHtml(existing.targetVenueName || "সব ব্রাঞ্চ")}</b>${existing.alertMode === "new_shows" ? " (প্রতিটি নতুন শো)" : ""}`
      : `\n\n✅ Active alert: <b>${escapeHtml(existing.targetVenueName || "All Branches")}</b>${existing.alertMode === "new_shows" ? " (Every new show)" : ""}`
    : "";

  const text =
    user.lang === "bn"
      ? `🔔 <b>টিকিট অ্যালার্ট সেট করুন</b>\n🎬 <b>${title}</b>\n\nকোন ব্রাঞ্চে টিকিট ছাড়লে অ্যালার্ট পেতে চান?${currentStatus}`
      : `🔔 <b>Set Ticket Alert</b>\n🎬 <b>${title}</b>\n\nWhich branch do you want to monitor?${currentStatus}`;

  await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
}

async function renderMovieShowtimes(ctx, storage, movie, venue, user) {
  const venues = await getVenues();
  const mKey = movieKey(movie);

  const parsed = await getBranchShows(venue.slug).catch(() => ({
    shows: [],
    halls: [],
  }));

  const hallsMap = new Map();
  if (Array.isArray(venue.halls)) {
    for (const h of venue.halls) if (h?.id) hallsMap.set(h.id, h);
  }
  for (const h of parsed.halls || []) {
    if (h?.id) hallsMap.set(h.id, h);
  }

  const movieShows = (parsed.shows || []).filter((s) => s.movieId === movie.id);
  const text = formatShowtimesByBranch(
    movie,
    venue,
    movieShows,
    hallsMap,
    user.lang,
    config.publicBrandName
  );

  const kb = new InlineKeyboard();
  kb.text(
    user.lang === "bn"
      ? `🔔 এই ব্রাঞ্চে অ্যালার্ট`
      : `🔔 Alert This Branch`,
    `al:${mKey}:${venueKey(venue)}:0`
  ).url(
    user.lang === "bn" ? "🎟️ টিকিট কাটুন" : "🎟️ Book Tickets",
    config.publicSiteUrl
  );

  // Switch to other branches
  const others = venues.filter((v) => v.id !== venue.id);
  if (others.length > 0) {
    kb.row();
    others.forEach((v, idx) => {
      kb.text(`🏢 ${getVenueName(v, user.lang)}`, `st:${mKey}:${venueKey(v)}`);
      if (idx % 2 === 1) kb.row();
    });
  }

  await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
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
    const prefNote = user.preferredVenueName
      ? lang === "bn"
        ? `\n⭐ আপনার পছন্দের ব্রাঞ্চ: <b>${escapeHtml(user.preferredVenueName)}</b>`
        : `\n⭐ Your preferred branch: <b>${escapeHtml(user.preferredVenueName)}</b>`
      : "";

    const text =
      lang === "bn"
        ? `👋 <b>${escapeHtml(config.publicBrandName)} বটে স্বাগতম!</b>\n\nএখান থেকে আপনি পাবেন:\n• 🎬 এখন চলছে ও আপকামিং মুভির তালিকা\n• 🏢 সব ব্রাঞ্চের লাইভ শোটাইম, খালি সিট ও টিকিটের দাম\n• 🔔 পছন্দের ব্রাঞ্চ টার্গেট করে ইনস্ট্যান্ট টিকিট অ্যালার্ট\n• 🎭 জনরা, ভাষা ফিল্টার ও দ্রুত সার্চ${prefNote}\n\nনিচের মেনু থেকে বাছুন বা যেকোনো মুভির নাম লিখুন!`
        : `👋 <b>Welcome to ${escapeHtml(config.publicBrandName)} Bot!</b>\n\nHere you can:\n• 🎬 Browse Now Showing & Upcoming movies\n• 🏢 Check live branch showtimes, seats & ticket prices\n• 🔔 Set branch-targeted instant ticket-drop alerts\n• 🎭 Filter by genre, language, or search by title${prefNote}\n\nPick an option below or type any movie name!`;

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
        ? `<b>📌 কমান্ড তালিকা</b>\n/nowshowing — এখন চলছে এমন মুভি\n/upcoming — আপকামিং মুভি ও টিকিট অ্যালার্ট\n/branches — ব্রাঞ্চ অনুযায়ী শোটাইম ও পছন্দের ব্রাঞ্চ সেট\n/genres — জনরা অনুযায়ী মুভি\n/languages — ভাষা অনুযায়ী মুভি\n/search &lt;নাম&gt; — মুভি খুঁজুন\n/myalerts — আপনার সেট করা অ্যালার্ট\n/lang — বাংলা / English পরিবর্তন\n\n🌐 ওয়েবসাইট: ${escapeHtml(config.publicSiteUrl)}`
        : `<b>📌 Commands</b>\n/nowshowing — Currently playing movies\n/upcoming — Upcoming movies & ticket alerts\n/branches — Live branch showtimes & preferred branch\n/genres — Browse by genre\n/languages — Browse by language\n/search &lt;name&gt; — Search movies\n/myalerts — Manage your active alerts\n/lang — Switch Bangla / English\n\n🌐 Website: ${escapeHtml(config.publicSiteUrl)}`;

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

  // /branches
  const handleBranches = async (ctx) => {
    const user = await storage.ensureUser(ctx.chat.id);
    const venues = await getVenues();
    if (!venues.length) {
      await ctx.reply(
        user.lang === "bn"
          ? "এই মুহূর্তে ব্রাঞ্চের তালিকা পাওয়া যাচ্ছে না।"
          : "Branches list is currently unavailable."
      );
      return;
    }

    const kb = new InlineKeyboard();
    venues.forEach((v, idx) => {
      const star = user.preferredVenueId === v.id ? "⭐ " : "🏢 ";
      kb.text(`${star}${getVenueName(v, user.lang)}`, `br:${venueKey(v)}`);
      if (idx % 2 === 1) kb.row();
    });

    const prefLine = user.preferredVenueName
      ? user.lang === "bn"
        ? `\n⭐ বর্তমান পছন্দের ব্রাঞ্চ: <b>${escapeHtml(user.preferredVenueName)}</b>`
        : `\n⭐ Current favorite branch: <b>${escapeHtml(user.preferredVenueName)}</b>`
      : "";

    await ctx.reply(
      user.lang === "bn"
        ? `🏢 <b>${escapeHtml(config.publicBrandName)} ব্রাঞ্চসমূহ (${venues.length}টি):</b>\nলাইভ শোটাইম, সিট ও দাম দেখতে যেকোনো ব্রাঞ্চ বেছে নিন:${prefLine}`
        : `🏢 <b>${escapeHtml(config.publicBrandName)} Branches (${venues.length}):</b>\nSelect a branch to see live showtimes, seats & prices:${prefLine}`,
      { parse_mode: "HTML", reply_markup: kb }
    );
  };
  bot.command("branches", handleBranches);
  bot.command("branch", handleBranches);
  bot.hears(["🏢 ব্রাঞ্চ ও শোটাইম", "🏢 Branches & Shows"], handleBranches);

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
      user.lang === "bn" ? "🎭 কোন জনরার মুভি দেখতে চান?" : "🎭 Choose a genre:",
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
      user.lang === "bn" ? "🌐 কোন ভাষার মুভি দেখতে চান?" : "🌐 Choose a language:",
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

    const lines = [];
    alerts.forEach((a) => {
      const label = a.movieTitle || a.slug;
      const scope = a.targetVenueName || (user.lang === "bn" ? "সব ব্রাঞ্চ" : "All Branches");
      const modeTag = a.alertMode === "new_shows" ? " 🔁" : "";
      lines.push(`• <b>${escapeHtml(label)}</b> — 🏢 ${escapeHtml(scope)}${modeTag}`);
      const mKey = (a.movieId || a.slug).slice(0, 12);
      kb.text(`📖 ${label.slice(0, 22)}`, `mv:${mKey}`)
        .text("❌", `unalert:${mKey}`)
        .row();
    });

    kb.text(
      user.notifyNewMovies
        ? user.lang === "bn"
          ? "🔔 নতুন মুভি অ্যালার্ট: চালু"
          : "🔔 New Movie Alerts: ON"
        : user.lang === "bn"
          ? "🔕 নতুন মুভি অ্যালার্ট: বন্ধ"
          : "🔕 New Movie Alerts: OFF",
      "toggle_global_new"
    );


    const text =
      alerts.length > 0
        ? user.lang === "bn"
          ? `🔔 <b>আপনার সেট করা টিকিট অ্যালার্ট (${alerts.length}টি):</b>\n\n${lines.join("\n")}\n\n⚡ টিকিট ছাড়ার সাথে সাথেই ব্রাঞ্চ, শোটাইম ও দামসহ অ্যালার্ট পাবেন।`
          : `🔔 <b>Your Active Ticket Alerts (${alerts.length}):</b>\n\n${lines.join("\n")}\n\n⚡ You'll receive instant showtime, seat & price alerts the moment tickets drop.`
        : user.lang === "bn"
          ? "🔔 আপনার কোনো মুভির টিকিট অ্যালার্ট সেট করা নেই।\n<b>🗓️ আসছে শীঘ্রই</b> বা <b>🎬 এখন চলছে</b> থেকে যেকোনো মুভিতে অ্যালার্ট চালু করুন।"
          : "🔔 You don't have any active ticket alerts yet.\nOpen <b>🗓️ Upcoming</b> or <b>🎬 Now Showing</b> to set branch alerts.";

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
      kb.text(`${tag} ${getLocalizedText(m.title, user.lang)}`, `mv:${movieKey(m)}`).row();
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

  // Callback: Browse a branch's live shows & set preferred branch
  bot.callbackQuery(/^br:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const vKey = ctx.match[1];
    const user = await storage.ensureUser(ctx.chat.id);
    const venue = await resolveVenueByKey(vKey);
    if (!venue) return;

    const [movies, parsed] = await Promise.all([
      getActiveMovies(),
      getBranchShows(venue.slug).catch(() => ({ shows: [], halls: [] })),
    ]);
    const moviesById = new Map(movies.map((m) => [m.id, m]));
    const venueName = getVenueName(venue, user.lang);
    const addr = getLocalizedText(venue.address, user.lang);

    const sellingShows = (parsed.shows || []).filter(isShowSelling);
    const groupedByMovie = new Map();
    for (const s of sellingShows) {
      if (!groupedByMovie.has(s.movieId)) groupedByMovie.set(s.movieId, []);
      groupedByMovie.get(s.movieId).push(s);
    }

    const lines = [`🏢 <b>${escapeHtml(venueName)}</b>`];
    if (addr) lines.push(`📍 <i>${escapeHtml(addr)}</i>`);
    lines.push("");

    const kb = new InlineKeyboard();
    const isFav = user.preferredVenueId === venue.id;
    kb.text(
      isFav
        ? user.lang === "bn"
          ? "⭐ পছন্দের ব্রাঞ্চ হিসেবে সেট আছে"
          : "⭐ Favorite Branch"
        : user.lang === "bn"
          ? "⭐ পছন্দের ব্রাঞ্চ সেট করুন"
          : "⭐ Set as Favorite Branch",
      `pb:${venueKey(venue)}`
    ).row();

    if (groupedByMovie.size === 0) {
      lines.push(
        user.lang === "bn"
          ? "😔 এই ব্রাঞ্চে এই মুহূর্তে কোনো সক্রিয় শোটাইম পাওয়া যায়নি।"
          : "😔 No live selling showtimes found at this branch right now."
      );
    } else {
      lines.push(
        user.lang === "bn"
          ? `🎬 <b>টিকিট চলছে (${groupedByMovie.size}টি মুভি):</b>`
          : `🎬 <b>Tickets Selling (${groupedByMovie.size} movies):</b>`
      );

      for (const [mId, mShows] of groupedByMovie.entries()) {
        const movie = moviesById.get(mId);
        const title = movie
          ? getLocalizedText(movie.title, user.lang)
          : "Movie";
        const sorted = [...mShows].sort((a, b) =>
          `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)
        );
        const first = sorted[0];
        const price = formatShowPriceRange(first);
        const seat = formatSeatBadge(first.availableSeats, first.totalSeats, user.lang);
        lines.push(
          `\n• <b>${escapeHtml(title)}</b> (${sorted.length} ${user.lang === "bn" ? "শো" : "shows"})\n  📅 ${escapeHtml(first.date)} 🕒 ${escapeHtml(formatTime12h(first.time))}${price ? ` • ${escapeHtml(price)}` : ""}${seat ? ` • ${seat}` : ""}`
        );
        if (movie) {
          kb.text(
            `🕒 ${title.slice(0, 26)}`,
            `st:${movieKey(movie)}:${venueKey(venue)}`
          ).row();
        }
      }
    }

    kb.url(
      user.lang === "bn" ? "🎟️ টিকিট কাটুন" : "🎟️ Book Tickets",
      config.publicSiteUrl
    );

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", reply_markup: kb });
  });

  // Callback: Set preferred branch
  bot.callbackQuery(/^pb:(.+)$/, async (ctx) => {
    const vKey = ctx.match[1];
    const user = await storage.ensureUser(ctx.chat.id);
    const venue = await resolveVenueByKey(vKey);
    if (!venue) return ctx.answerCallbackQuery();

    const name = getVenueName(venue, user.lang);
    await storage.setPreferredVenue(ctx.chat.id, venue.id, name);
    await ctx.answerCallbackQuery({
      text:
        user.lang === "bn"
          ? `⭐ "${name}" আপনার পছন্দের ব্রাঞ্চ হিসেবে সেট হয়েছে!`
          : `⭐ "${name}" saved as your favorite branch!`,
      show_alert: true,
    });
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
      // Ignore if message is too old
    }
    await renderMovieCard(ctx, storage, {
      listKey,
      movies,
      index: nextIndex,
      lang: user.lang,
    });
  });

  // Callback: Movie details (supports both new `mv:<id12>` and legacy `movie:<slug>`)
  bot.callbackQuery(/^(?:mv|movie):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const key = ctx.match[1];
    const user = await storage.ensureUser(ctx.chat.id);
    const matched = await resolveMovieByKey(key);
    const slug = matched?.slug || key;

    const [detail, meta, alert] = await Promise.all([
      getMovieDetail(slug).catch(() => matched),
      getCatalogMeta(),
      storage.getAlert(ctx.chat.id, slug),
    ]);

    if (!detail) {
      await ctx.reply(
        user.lang === "bn"
          ? "দুঃখিত, এই মুভির বিস্তারিত তথ্য এখন পাওয়া যাচ্ছে না।"
          : "Sorry, detailed info for this movie is currently unavailable."
      );
      return;
    }

    const mKey = movieKey(detail);
    const text = formatMovieDetailCard(
      detail,
      meta,
      user.lang,
      config.publicBrandName
    );
    const trailerUrl = getTrailerUrl(detail);

    const kb = new InlineKeyboard();
    kb.text(
      user.lang === "bn" ? "🕒 শোটাইম ও সিট" : "🕒 Showtimes & Seats",
      `stm:${mKey}`
    );
    kb.text(
      alert
        ? user.lang === "bn"
          ? "🔕 অ্যালার্ট এডিট/বাতিল"
          : "🔕 Edit/Remove Alert"
        : user.lang === "bn"
          ? "🔔 টিকিট অ্যালার্ট"
          : "🔔 Ticket Alert",
      `am:${mKey}`
    );

    kb.row();
    if (trailerUrl) {
      kb.url(user.lang === "bn" ? "▶️ ট্রেলার" : "▶️ Trailer", trailerUrl);
    }
    kb.url(
      user.lang === "bn" ? "🎟️ টিকিট কাটুন" : "🎟️ Book Tickets",
      config.publicSiteUrl
    );

    const image = detail.posterUrl || detail.backdropUrl || detail.bannerUrl;
    await sendPhotoOrText(ctx, image, text, kb);
  });

  // Callback: Movie showtimes menu (auto-opens favorite branch, or shows branch picker)
  bot.callbackQuery(/^stm:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const mKey = ctx.match[1];
    const user = await storage.ensureUser(ctx.chat.id);
    const movie = await resolveMovieByKey(mKey);
    if (!movie) return;

    const venues = await getVenues();
    if (!venues.length) {
      await ctx.reply(
        user.lang === "bn"
          ? "ব্রাঞ্চের তথ্য এখন পাওয়া যাচ্ছে না।"
          : "Branch info is currently unavailable."
      );
      return;
    }

    if (user.preferredVenueId) {
      const pref = venues.find((v) => v.id === user.preferredVenueId);
      if (pref) {
        await renderMovieShowtimes(ctx, storage, movie, pref, user);
        return;
      }
    }

    // Show branch picker + live availability hint across all branches
    const branchData = await getAllBranchesShows().catch(() => ({ shows: [] }));
    const sellingVenues = new Set(
      (branchData.shows || [])
        .filter((s) => s.movieId === movie.id && isShowSelling(s))
        .map((s) => s.venueId)
    );

    const kb = new InlineKeyboard();
    venues.forEach((v, idx) => {
      const dot = sellingVenues.has(v.id) ? "🟢 " : "🏢 ";
      kb.text(`${dot}${getVenueName(v, user.lang)}`, `st:${movieKey(movie)}:${venueKey(v)}`);
      if (idx % 2 === 1) kb.row();
    });

    const title = escapeHtml(getLocalizedText(movie.title, user.lang));
    const msg =
      user.lang === "bn"
        ? `🕒 <b>${title}</b> — কোন ব্রাঞ্চের শোটাইম দেখবেন?\n<i>(🟢 = টিকিট বিক্রি চলছে)</i>`
        : `🕒 <b>${title}</b> — Pick a branch for live showtimes:\n<i>(🟢 = Tickets selling now)</i>`;

    await ctx.reply(msg, { parse_mode: "HTML", reply_markup: kb });
  });

  // Callback: Showtimes for specific movie + branch
  bot.callbackQuery(/^st:([^:]+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, mKey, vKey] = ctx.match;
    const user = await storage.ensureUser(ctx.chat.id);
    const [movie, venue] = await Promise.all([
      resolveMovieByKey(mKey),
      resolveVenueByKey(vKey),
    ]);
    if (!movie || !venue) return;
    await renderMovieShowtimes(ctx, storage, movie, venue, user);
  });

  // Callback: Open alert setup menu (choose branch or all branches)
  bot.callbackQuery(/^am:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const mKey = ctx.match[1];
    const user = await storage.ensureUser(ctx.chat.id);
    const movie = await resolveMovieByKey(mKey);
    if (!movie) return;
    await renderAlertSetupMenu(ctx, storage, movie, user);
  });

  // Callback: Save branch-targeted alert `al:<movieKey>:<venueKey|all>:<0|1>`
  bot.callbackQuery(/^al:([^:]+):([^:]+):([01])$/, async (ctx) => {
    const [, mKey, vKey, modeFlag] = ctx.match;
    const user = await storage.ensureUser(ctx.chat.id);
    const movie = await resolveMovieByKey(mKey);
    if (!movie) return ctx.answerCallbackQuery();

    let targetVenueId = null;
    let targetVenueName = "";
    if (vKey !== "all") {
      const venue = await resolveVenueByKey(vKey);
      if (venue) {
        targetVenueId = venue.id;
        targetVenueName = getVenueName(venue, user.lang);
      }
    }

    const title = getLocalizedText(movie.title, user.lang);
    const alertMode = modeFlag === "1" ? "new_shows" : "ticket_drop";

    await storage.upsertAlert(ctx.chat.id, {
      slug: movie.slug,
      movieId: movie.id,
      movieTitle: title,
      targetVenueId,
      targetVenueName,
      alertMode,
    });

    const scopeLabel =
      targetVenueName || (user.lang === "bn" ? "সব ব্রাঞ্চ" : "All Branches");

    await ctx.answerCallbackQuery({
      text:
        user.lang === "bn"
          ? `🔔 "${title}" (${scopeLabel}) অ্যালার্ট সেট হয়েছে!`
          : `🔔 Alert set for "${title}" (${scopeLabel})!`,
      show_alert: true,
    });
  });

  // Callback: Remove alert
  bot.callbackQuery(/^unalert:(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    const user = await storage.ensureUser(ctx.chat.id);
    const matched = await resolveMovieByKey(key);
    const slug = matched?.slug || key;

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

  // Inline query search (@starcineplexbdbot <query>)
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

  bot.catch((err) => {
    console.error("[bot] Unhandled error:", err?.error?.message || err.message);
  });

  return bot;
}
