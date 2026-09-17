import { getOwner } from "./store";
import { telegramApi } from "./telegram";
import type { Env } from "./types";

interface AnnouncementInfo {
  url: string | null;
  title: string;
  date: string;
}

/**
 * Scrapes the site's announcements listing page for ALL cards on it (the page returns ~20
 * per load, no infinite scroll needed). The page is plain server-rendered HTML (verified -
 * no client-side JS rendering needed), so HTMLRewriter can extract it directly without a
 * full DOM/browser. Each selector's `element()` callback starts a new slot in its array and
 * `text()` appends into the current (last) slot - since HTMLRewriter fires these strictly in
 * document order, the three arrays end up aligned by card index.
 */
async function fetchAnnouncementCards(env: Env): Promise<AnnouncementInfo[]> {
  const res = await fetch(env.ANNOUNCEMENTS_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ZoomElonBot/1.0; +https://zoom-elon-bot.bek8896ok.workers.dev)",
    },
  });
  if (!res.ok) return [];

  const hrefs: (string | null)[] = [];
  const titles: string[] = [];
  const dates: string[] = [];

  const rewriter = new HTMLRewriter()
    .on("a.news-card-link", {
      element(el) {
        hrefs.push(el.getAttribute("href"));
      },
    })
    .on("h3.news-card-title", {
      element() {
        titles.push("");
      },
      text(t) {
        if (titles.length > 0) titles[titles.length - 1] += t.text;
      },
    })
    .on("span.news-card-date", {
      element() {
        dates.push("");
      },
      text(t) {
        if (dates.length > 0) dates[dates.length - 1] += t.text;
      },
    });

  // .transform() only wires up the handlers - reading the body is what actually drives
  // the stream through them. The rewritten output itself is discarded (side effects only).
  await rewriter.transform(res).text();

  const count = Math.min(hrefs.length, titles.length, dates.length);
  const cards: AnnouncementInfo[] = [];
  for (let i = 0; i < count; i++) {
    const href = hrefs[i];
    if (!href) continue;
    cards.push({
      url: new URL(href, env.ANNOUNCEMENTS_URL).toString(),
      title: titles[i].trim(),
      date: dates[i].trim(),
    });
  }
  return cards;
}

/**
 * Plain text of the announcement's own body (div.blog-content) - where the actual event
 * date/time lives. Fetching 20 cards' worth of detail pages back-to-back occasionally hits
 * a transient network hiccup, so this retries once before giving up - a caller seeing null
 * here must NOT treat it as "this announcement isn't about Zoom" (see pollForNewAnnouncements).
 */
async function fetchArticleBodyText(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ZoomElonBot/1.0; +https://zoom-elon-bot.bek8896ok.workers.dev)",
        },
      });
      if (res.ok) {
        let recording = false;
        let seen = 0;
        let text = "";

        const rewriter = new HTMLRewriter().on("div.blog-content", {
          element() {
            seen++;
            recording = seen === 1;
          },
          text(t) {
            if (recording) text += t.text;
            // Ko'p paragraf o'qishning hojati yo'q - sana odatda eng boshida keladi.
            if (recording && text.length > 1500) recording = false;
          },
        });

        await rewriter.transform(res).text();
        return text.trim() || null;
      }
    } catch (error) {
      console.error("fetchArticleBodyText failed", url, error);
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

interface EventDateInfo {
  isoDate: string; // YYYY-MM-DD, taqvim hisob-kitobi uchun (1 kun oldin eslatish)
  timeText: string; // odam o'qiydigan qism, masalan "soat 12:00"
}

/**
 * Meaning-based (not regex-pattern) extraction of the event's actual date/time from the
 * announcement's own body text - the listing page's "date" is just the publish date, not
 * when the defense/seminar happens. Qat'iy "YYYY-MM-DD | soat HH:MM" formatda so'raladi,
 * shunda isoDate ustida taqvim hisob-kitobi (ertaga - bugun) ishonchli ishlaydi. Same
 * reliable pattern as the other AI classifiers in this project (temperature 0, fails to
 * null on any error or format mismatch).
 */
async function extractEventDateInfo(env: Env, articleText: string): Promise<EventDateInfo | null> {
  try {
    const systemPrompt =
      "Quyidagi e'lon matnidan tadbir (himoya/seminar/konferensiya) o'tkaziladigan ANIQ sana va soatni toping. " +
      'Javobni FAQAT ushbu qat\'iy formatda yozing: YYYY-MM-DD | soat HH:MM (masalan: 2026-09-09 | soat ' +
      "12:00). Boshqa hech narsa, izoh yoki qo'shimcha so'z yozmang. Agar matnda aniq sana yoki soat " +
      "topilmasa, faqat bitta so'z bilan javob bering: NOANIQ.";

    const result = (await env.AI.run(env.WORKERS_AI_MODEL as Parameters<Ai["run"]>[0], {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: articleText },
      ],
      temperature: 0,
    } as never)) as { response?: string };

    const answer = (result?.response ?? "").trim();
    if (!answer || answer.toUpperCase().includes("NOANIQ")) return null;

    const match = answer.match(/(\d{4})-(\d{2})-(\d{2})\s*\|\s*(.+)/);
    if (!match) return null;

    const isoDate = `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(`${isoDate}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return null; // sun'iy/noto'g'ri sana chiqib ketmasin

    return { isoDate, timeText: match[4].trim() };
  } catch (error) {
    console.error("Event date extraction failed", error);
    return null;
  }
}

/** Toshkent vaqti (UTC+5, yozgi vaqtga o'tish yo'q) bo'yicha YYYY-MM-DD, offsetDays kun qo'shib/ayirib. */
function tashkentDateString(offsetDays: number): string {
  const ms = Date.now() + 5 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

interface PendingEvent {
  url: string;
  title: string;
  isoDate: string;
  timeText: string;
  reminded: boolean;
}

const SEEN_KEY = "announcements:seen_urls";
const SEEN_CAP = 200; // ro'yxat cheksiz o'smasligi uchun - eng eskilari chetlab tashlanadi
const PENDING_KEY = "announcements:pending";

async function getSeenUrls(env: Env): Promise<string[]> {
  const raw = await env.BOT_KV.get(SEEN_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

async function saveSeenUrls(env: Env, urls: string[]): Promise<void> {
  const capped = urls.length > SEEN_CAP ? urls.slice(urls.length - SEEN_CAP) : urls;
  await env.BOT_KV.put(SEEN_KEY, JSON.stringify(capped));
}

async function getPending(env: Env): Promise<PendingEvent[]> {
  const raw = await env.BOT_KV.get(PENDING_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PendingEvent[];
  } catch {
    return [];
  }
}

async function savePending(env: Env, list: PendingEvent[]): Promise<void> {
  await env.BOT_KV.put(PENDING_KEY, JSON.stringify(list));
}

/**
 * Saytdagi TO'LIQ ro'yxatni (bitta emas, barcha kartalarni) skanerlaydi va hali ko'rilmagan
 * har bir e'lonni tekshiradi - avvalgi versiya faqat ro'yxatning eng tepasidagi (eng yangi)
 * kartani kuzatgani uchun, o'rtada bir vaqtda bir nechta yangi e'lon chiqsa (yoki ro'yxat
 * o'rtasida allaqachon turgan, hali ko'rilmagan eski e'lonlar bo'lsa) ularni butunlay
 * o'tkazib yuborar edi. ZOOM haqida bo'lgan har bir yangi e'lon "kutilayotgan eslatmalar"
 * ro'yxatiga qo'shiladi.
 */
async function pollForNewAnnouncements(env: Env): Promise<void> {
  const cards = await fetchAnnouncementCards(env);
  if (cards.length === 0) return;

  const seen = await getSeenUrls(env);
  const seenSet = new Set(seen);

  // Ro'yxatda eng yangisi tepada turadi - eskisidan yangisiga qarab ishlov beramiz, shunda
  // bir nechta yangi e'lon bo'lsa xabarlar xronologik tartibda ketadi.
  const newCards = cards.filter((c): c is AnnouncementInfo & { url: string } => Boolean(c.url) && !seenSet.has(c.url as string)).reverse();
  if (newCards.length === 0) return;

  const pending = await getPending(env);
  const pendingUrls = new Set(pending.map((p) => p.url));
  const ownerId = await getOwner(env);
  const tg = telegramApi(env.TELEGRAM_BOT_TOKEN);

  for (const card of newCards) {
    if (pendingUrls.has(card.url)) {
      seen.push(card.url); // xavfsizlik uchun - ikki marta rejalashtirilmasin
      continue;
    }

    try {
      const articleText = await fetchArticleBodyText(card.url);
      if (!articleText) {
        // Maqola matnini o'qib bo'lmadi (vaqtinchalik tarmoq xatosi bo'lishi mumkin) -
        // "ko'rilgan" deb belgilamaymiz, keyingi soatlik tekshiruvda qayta urinib ko'radi.
        // Buni "ZOOM emas" deb xato xulosa chiqarib, butunlay yo'qotib qo'yish mumkin emas.
        continue;
      }

      seen.push(card.url); // endi maqola muvaffaqiyatli o'qildi - qayta ko'rib chiqilmaydi

      const mentionsZoom = /zoom/i.test(card.title) || /zoom/i.test(articleText);
      if (!mentionsZoom) continue; // faqat ZOOM orqali o'tkaziladigan e'lonlar kerak

      const eventInfo = await extractEventDateInfo(env, articleText);

      if (!eventInfo) {
        // Sana aniqlanmasa 1 kun oldin eslatib bo'lmaydi - imkoniyatni boy bermaslik uchun
        // shu holatda darhol xabar beramiz.
        await tg.sendMessage(
          ownerId,
          `📢 Yangi ZOOM e'lon (aniq sanasini avtomatik topib bo'lmadi):\n\n${card.title}\n📅 E'lon joylangan sana: ${card.date}\n🔗 ${card.url}`,
        );
        continue;
      }

      pending.push({ url: card.url, title: card.title, isoDate: eventInfo.isoDate, timeText: eventInfo.timeText, reminded: false });
      pendingUrls.add(card.url);
    } catch (error) {
      // Bitta kartadagi kutilmagan xato qolgan barcha kartalarni tekshirishni to'xtatib
      // qo'ymasin - shu kartani o'tkazib yuboramiz, "ko'rilgan" deb belgilamaymiz.
      console.error("Failed to process announcement card", card.url, error);
    }
  }

  await saveSeenUrls(env, seen);
  await savePending(env, pending);
}

/**
 * Kutilayotgan tadbirlarni ko'rib chiqadi - tadbir sanasi ertaga (yoki, agar e'lon o'sha
 * kuniyoq joylangan bo'lsa, bugun) bo'lsa Toshkent vaqti bo'yicha eslatma yuboradi.
 */
async function sendDueReminders(env: Env): Promise<void> {
  const pending = await getPending(env);
  if (pending.length === 0) return;

  const today = tashkentDateString(0);
  const tomorrow = tashkentDateString(1);

  const ownerId = await getOwner(env);
  const tg = telegramApi(env.TELEGRAM_BOT_TOKEN);

  let changed = false;
  const remaining: PendingEvent[] = [];

  for (const ev of pending) {
    // Tadbir sanasi allaqachon o'tib ketgan bo'lsa - ro'yxatdan olib tashlaymiz.
    if (ev.isoDate < today) {
      changed = true;
      continue;
    }

    // Odatda "ertaga" (1 kun oldin) eslatiladi; agar e'lon tadbir kuniyoq joylangan bo'lsa
    // (isoDate === today), keyingi tekshiruvda "ertaga" bosqichi o'tib ketmasligi uchun
    // shu kuniyoq darhol yuboriladi.
    if (!ev.reminded && ev.isoDate <= tomorrow) {
      const label = ev.isoDate === today ? "BUGUN" : "ertaga";
      // Faqat xabar HAQIQATAN yuborilgan bo'lsagina "reminded" deb belgilaymiz - aks holda
      // (masalan, egasi botni hali /start qilmagan bo'lsa) eslatma umuman yetib bormay,
      // lekin abadiy "yuborilgan" deb qayd etilib qolishi mumkin edi.
      const sent = await tg.sendMessage(
        ownerId,
        `⏰ Eslatma: ${label} (${ev.isoDate}) ${ev.timeText} ZOOM orqali bo'lib o'tadi:\n\n${ev.title}\n🔗 ${ev.url}`,
      );
      if (sent) {
        ev.reminded = true;
        changed = true;
      }
    }

    remaining.push(ev);
  }

  if (changed) await savePending(env, remaining);
}

/**
 * Runs on the Cron Trigger (har soatda). Ikki ish qiladi: (1) saytdagi TO'LIQ ro'yxatni
 * skanerlab, hali ko'rilmagan har bir ZOOM e'lonni "kutilayotgan eslatmalar" ro'yxatiga
 * qo'shadi, (2) shu ro'yxatdagi tadbirlardan qaysi biri ertaga (yoki bugun) bo'lib
 * o'tishini tekshirib, bir marta (reminded flag orqali) eslatma yuboradi.
 */
export async function checkAnnouncements(env: Env): Promise<void> {
  // Ikkalasi bir-biridan mustaqil ishlaydi - biri xato bersa ham ikkinchisi baribir
  // ishlashi kerak (masalan, saytga ulanib bo'lmasa ham, mavjud eslatmalar yuborilaversin).
  try {
    await pollForNewAnnouncements(env);
  } catch (error) {
    console.error("pollForNewAnnouncements failed", error);
  }
  try {
    await sendDueReminders(env);
  } catch (error) {
    console.error("sendDueReminders failed", error);
  }
}
