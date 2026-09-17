# Zoom E'lon Bot

Telegram bot: uzswlu.uz saytidagi e'lonlar ro'yxatini har soatda tekshirib, ZOOM orqali
o'tkaziladigan tadbirlar haqida tadbir sanasidan 1 kun oldin (yoki, agar imkoni bo'lmasa,
o'sha kuniyoq) eslatma yuboradi. Telegram Mini App orqali adminlarni boshqarish (qo'shish,
o'chirish, egalikni o'tkazish) imkoniyati bor.

Cloudflare Workers (bepul tarif, kartasiz) ustida ishlaydi - kod `worker/` papkasida.

## Sozlash

```
cd worker
npm install
npx wrangler kv namespace create <nom>   # KV yaratish, ID'sini wrangler.toml'ga yozish
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put ADMIN_IDS
npx wrangler secret put OWNER_ID
npx wrangler deploy
```

Webhook'ni Telegram'ga bir marta qo'lda ro'yxatdan o'tkazish kerak (`setWebhook` API chaqirig'i
orqali) - `telegram.ts` ichidagi `setWebhook` funksiyasi shu uchun.
