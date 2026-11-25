import "dotenv/config";

const stripTrailingSlash = (url = "") => url.replace(/\/+$/, "");

export const config = {
  botToken: process.env.BOT_TOKEN || "",
  port: Number(process.env.PORT) || 3000,

  // Render automatically injects RENDER_EXTERNAL_URL on Web Services
  publicWebhookUrl: stripTrailingSlash(
    process.env.PUBLIC_WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || ""
  ),
  webhookSecret: process.env.WEBHOOK_SECRET || "cineplex-webhook-secret",
  cronSecret: process.env.CRON_SECRET || "cineplex-cron-secret",

  // Persistent Postgres URL (Neon / Supabase / Render Postgres). Falls back to JSON file if empty.
  databaseUrl: process.env.DATABASE_URL || "",
  localStorePath: process.env.LOCAL_STORE_PATH || "./data/store.json",

  // Public-facing brand & site shown to Telegram users
  publicBrandName: process.env.PUBLIC_BRAND_NAME || "STAR Cineplex",
  publicSiteUrl: stripTrailingSlash(
    process.env.PUBLIC_SITE_URL || "https://cineplexbd.com"
  ),

  // Internal upstream catalog API (kept hidden from end users)
  apiBaseUrl: stripTrailingSlash(
    process.env.API_BASE_URL || "https://api.kichole.com/catalog/api"
  ),
  orgId: process.env.ORG_ID || "0ab00001-0000-0000-0000-000000000001",

  // Optional in-process interval (minutes). Keep 0 on Render Free and use external cron-job.org.
  autoCheckIntervalMinutes: Number(process.env.AUTO_CHECK_INTERVAL_MINUTES) || 0,
};
