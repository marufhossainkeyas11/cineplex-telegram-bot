import express from "express";
import { webhookCallback } from "grammy";
import { createBot } from "./bot.js";
import { config } from "./config.js";
import { runCatalogCheck } from "./monitor.js";
import { createStorage } from "./storage.js";

async function main() {
  const storage = await createStorage();
  const bot = createBot(storage);

  // Set Telegram command menu
  await bot.api
    .setMyCommands([
      { command: "start", description: "বট শুরু করুন / Start" },
      { command: "nowshowing", description: "এখন চলছে / Now Showing" },
      { command: "upcoming", description: "আসছে শীঘ্রই / Upcoming" },
      { command: "branches", description: "ব্রাঞ্চ ও শোটাইম / Branches" },
      { command: "genres", description: "জনরা অনুযায়ী / Genres" },
      { command: "languages", description: "ভাষা অনুযায়ী / Languages" },
      { command: "search", description: "মুভি খুঁজুন / Search" },
      { command: "myalerts", description: "আমার অ্যালার্ট / My Alerts" },
      { command: "lang", description: "বাংলা / English" },
      { command: "help", description: "সাহায্য / Help" },
    ])
    .catch((err) => console.warn("[boot] Could not set commands:", err.message));

  const app = express();
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({
      service: `${config.publicBrandName} Telegram Bot`,
      website: config.publicSiteUrl,
      status: "ok",
    });
  });

  app.get("/health", async (_req, res) => {
    const stats = await storage.getStats().catch(() => ({}));
    res.json({ status: "ok", ...stats });
  });

  // Protected cron endpoint: ping every 5-10 min from cron-job.org
  const handleCronCheck = async (req, res) => {
    const provided = req.query.secret || req.headers["x-cron-secret"] || "";
    if (!config.cronSecret || provided !== config.cronSecret) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const result = await runCatalogCheck(bot, storage);
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[cron] Catalog check failed:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Catalog check failed" });
    }
  };
  app.get("/cron/check", handleCronCheck);
  app.post("/cron/check", handleCronCheck);

  if (config.publicWebhookUrl) {
    const webhookPath = `/webhook/${config.webhookSecret}`;
    app.use(webhookPath, webhookCallback(bot, "express"));

    app.listen(config.port, async () => {
      console.log(`[server] Listening on port ${config.port} (Webhook mode)`);
      const fullWebhookUrl = `${config.publicWebhookUrl}${webhookPath}`;
      try {
        await bot.api.setWebhook(fullWebhookUrl, {
          drop_pending_updates: false,
        });
        console.log("[bot] Webhook registered successfully.");
      } catch (err) {
        console.error("[bot] Failed to register webhook:", err.message);
      }

      runCatalogCheck(bot, storage)
        .then((r) => console.log("[boot] Initial sync:", r))
        .catch((err) => console.warn("[boot] Initial sync failed:", err.message));
    });
  } else {
    app.listen(config.port, () => {
      console.log(`[server] Health/cron server on port ${config.port} (Polling mode)`);
    });

    await bot.api.deleteWebhook({ drop_pending_updates: false }).catch(() => {});
    bot.start({
      onStart: () => console.log("[bot] Running in Long Polling mode."),
    });

    runCatalogCheck(bot, storage)
      .then((r) => console.log("[boot] Initial sync:", r))
      .catch((err) => console.warn("[boot] Initial sync failed:", err.message));
  }

  if (config.autoCheckIntervalMinutes > 0) {
    const ms = config.autoCheckIntervalMinutes * 60 * 1000;
    setInterval(() => {
      runCatalogCheck(bot, storage).catch((err) =>
        console.error("[interval] Check failed:", err.message)
      );
    }, ms);
  }
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
