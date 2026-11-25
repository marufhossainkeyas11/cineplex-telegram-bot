# STAR Cineplex Telegram Bot (Render Free Tier Ready)

এই টেলিগ্রাম বটটি **Render Free Web Service**-এ ফ্রিতে হোস্ট করার জন্য তৈরি করা হয়েছে। ব্যাকএন্ড ডেটা সোর্স সম্পূর্ণ গোপন রেখে ইউজারদের কাছে শুধু **STAR Cineplex (`https://cineplexbd.com`)** ব্র্যান্ডিং ও বুকিং লিংক দেখায়।

## মূল ফিচারসমূহ
- **এখন চলছে ও আসছে শীঘ্রই**: পোস্টার, ফরম্যাট (`2D`/`3D`/`IMAX`), রানটাইম, সার্টিফিকেট, রিলিজ কাউন্টডাউন ও Pagination সহ ব্রাউজিং।
- **আপকামিং টিকিট অ্যালার্ট (`🔔`)**: ইউজার যেকোনো Upcoming মুভিতে ১ ক্লিকে অ্যালার্ট সেট করতে পারবে। মুভিটি `isNowShowing: true` হলেই অটো মেসেজ ও `cineplexbd.com` বুকিং বাটন পাঠাবে।
- **স্মার্ট আপডেট ও রিমাইন্ডার**: রিলিজ ডেট বদলে গেলে, নতুন ফরম্যাট যুক্ত হলে, রিলিজের ১ দিন আগে, অথবা ক্যাটালগে নতুন মুভি এলে (অপশনাল) অ্যালার্ট পাঠায়।
- **জনরা, ভাষা ও সার্চ**: ডাইনামিক জনরা/ভাষা ফিল্টার, নন-বাংলা/ইংরেজি মুভিতে অটো সাবটাইটেল নোট, বাংলা/ইংরেজি UI টগল (`/lang`), এবং সরাসরি টেক্সট বা ইনলাইন সার্চ (`@yourbot <movie>`)।

---

## Render Free Tier-এ ডিপ্লয় করার ধাপ (১০০% ফ্রি)

Render-এর ফ্রি ওয়েব সার্ভিস ১৫ মিনিট রিকোয়েস্ট না এলে স্লিপ করে এবং রিস্টার্টে লোকাল ডিস্ক রিসেট হয়। এই দুটি সমস্যা সমাধানে নিচের ৩টি সহজ ধাপ অনুসরণ করুন:

### ধাপ ১: ফ্রি PostgreSQL ডাটাবেস নিন (যাতে অ্যালার্ট ডিলিট না হয়)
1. [Neon.tech](https://neon.tech) বা [Supabase](https://supabase.com)-এ একটি ফ্রি প্রজেক্ট তৈরি করুন।
2. সেখান থেকে `DATABASE_URL` (PostgreSQL connection string) কপি করে রাখুন।
*(নোট: `DATABASE_URL` না দিলেও বটটি লোকাল `./data/store.json` দিয়ে চলবে, তবে Render Free রিস্টার্ট হলে অ্যালার্ট মুছে যাবে।)*

### ধাপ ২: Render-এ Web Service ডিপ্লয় করুন
1. এই ফোল্ডারের কোড আপনার GitHub রিপোজিটরিতে পুশ করুন।
2. [Render Dashboard](https://dashboard.render.com) → **New +** → **Web Service** সিলেক্ট করে GitHub রিপো কানেক্ট করুন (অথবা `render.yaml` Blueprint ব্যবহার করুন)।
3. **Environment Variables** সেট করুন:
   - `BOT_TOKEN`: `@BotFather` থেকে পাওয়া টোকেন
   - `DATABASE_URL`: ধাপ ১-এ পাওয়া Postgres URL
   - `WEBHOOK_SECRET`: যেকোনো র‍্যান্ডম স্ট্রিং (যেমন `my-super-secret-hook-99`)
   - `CRON_SECRET`: আরেকটি র‍্যান্ডম স্ট্রিং (যেমন `my-cron-pass-88`)
   - `PUBLIC_SITE_URL`: `https://cineplexbd.com`
   - `PUBLIC_BRAND_NAME`: `STAR Cineplex`
   - *(Render নিজেই `RENDER_EXTERNAL_URL` সেট করে দেয়, তাই `PUBLIC_WEBHOOK_URL` আলাদা করে না দিলেও অটো Webhook সেট হয়ে যাবে।)*
4. **Deploy** হলে `https://your-app.onrender.com/health` ভিজিট করে `{"status":"ok"}` নিশ্চিত করুন।

### ধাপ ৩: ফ্রি Cron সেট করুন (সার্ভার চালু রাখা + টিকিট চেক করা)
1. [cron-job.org](https://cron-job.org)-এ ফ্রি অ্যাকাউন্ট করে **Create Cronjob** ক্লিক করুন।
2. **URL** দিন:
   ```text
   https://your-app.onrender.com/cron/check?secret=YOUR_CRON_SECRET
   ```
3. **Execution Schedule**: প্রতি **১০ মিনিট** (বা ১৪ মিনিট) পরপর সেট করুন।

এই একটি পিং একই সাথে:
1. Render Free সার্ভিসকে স্লিপ হতে দেবে না (তাই ইউজার মেসেজ দিলে সাথে সাথে রিপ্লাই পাবে), এবং
2. প্রতি ১০ মিনিট পরপর নতুন টিকিট ছাড়ল কি না চেক করে সাবস্ক্রাইব করা ইউজারদের অ্যালার্ট পাঠাবে!

---

## লোকাল পিসিতে রান ও টেস্ট করা
```bash
cp .env.example .env
# .env ফাইলে BOT_TOKEN বসান (PUBLIC_WEBHOOK_URL ফাঁকা রাখলে Long Polling মোডে চলবে)
npm install
npm test
npm start
```
