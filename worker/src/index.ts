import { checkAnnouncements, formatEventLine, getPending, getStartCatchUp } from "./announcements";
import { validateInitData } from "./auth";
import { telegramApi, type InlineKeyboard } from "./telegram";
import {
  addAdmin,
  addSubscriber,
  getAdmins,
  getOwner,
  getSubscribers,
  isAdmin,
  isBroadcastEnabled,
  isOwner,
  removeAdmin,
  setBroadcastEnabled,
  transferOwnership,
} from "./store";
import type { Env, TelegramCallbackQuery, TelegramUpdate, TelegramUser } from "./types";
import { renderAppHtml } from "./webapp";

/**
 * Keeps the persistent Menu (☰) button in sync with admin status: only admins get the
 * button that opens the Mini App - everyone else falls back to the plain command list.
 * Assumes chat_id == user_id, true for the private 1:1 chats this bot is used in.
 */
async function syncAdminMenuButton(
  tg: ReturnType<typeof telegramApi>,
  env: Env,
  targetChatId: number,
  isNowAdmin: boolean,
): Promise<void> {
  if (isNowAdmin) {
    await tg.setChatMenuButton(targetChatId, {
      type: "web_app",
      text: "Menu",
      web_app: { url: `${env.APP_BASE_URL}/app` },
    });
  } else {
    await tg.setChatMenuButton(targetChatId, { type: "default" });
  }
}

function panelKeyboard(appUrl: string): InlineKeyboard {
  return { inline_keyboard: [[{ text: "🖥 Boshqaruv panelini ochish", web_app: { url: appUrl } }]] };
}

/** Har kimga (admin bo'lishi shart emas) /start bosganda ko'rsatiladigan tanishtiruv matni. */
const WELCOME_TEXT =
  "Ushbu bot O'zbekiston davlat jahon tillari universitetida bo'lib o'tadigan Kengaytirilgan " +
  "kafedra ilmiy muhokamasi, ilmiy seminar muhokamasi, Yetakchi tashkilot dissertatsiya ishi " +
  "muhokamasi, (PhD yoki DSc) dissertatsiyasi himoyasi Ilmiy kengash majlislari zoom online " +
  "platforma orqali bo'lib o'tishi haqida xabardor qilib turadi.";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("OK", { status: 200 });
    }

    if (request.method === "GET" && url.pathname === "/app") {
      return new Response(renderAppHtml(), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (request.method === "POST" && url.pathname === "/api/state") {
      return handleApiState(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/action") {
      return handleApiAction(request, env);
    }

    if (request.method === "POST" && url.pathname === "/telegram-webhook") {
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }

      const update = await request.json<TelegramUpdate>();
      // Answer Telegram immediately (it retries on timeout/5xx); do the real work
      // in the background so the webhook response isn't held up.
      ctx.waitUntil(handleUpdate(update, env));
      return new Response("OK", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(checkAnnouncements(env));
  },
};

/** Authenticates a Mini App request; returns the admin's user id, or the response to send back. */
async function authenticateApp(
  request: Request,
  env: Env,
): Promise<{ userId: number; body: Record<string, unknown> } | Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const initData = typeof body.initData === "string" ? body.initData : "";
  const user = await validateInitData(initData, env.TELEGRAM_BOT_TOKEN);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!(await isAdmin(env, user.id))) {
    return new Response("Siz admin emassiz.", { status: 403 });
  }
  return { userId: user.id, body };
}

async function buildAppState(env: Env) {
  const [admins, ownerId, pending, broadcastEnabled, subscribers] = await Promise.all([
    getAdmins(env),
    getOwner(env),
    getPending(env),
    isBroadcastEnabled(env),
    getSubscribers(env),
  ]);
  return { admins, ownerId, pending, broadcastEnabled, subscriberCount: subscribers.length };
}

async function handleApiState(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateApp(request, env);
  if (auth instanceof Response) return auth;
  const state = await buildAppState(env);
  return new Response(JSON.stringify(state), { headers: { "Content-Type": "application/json" } });
}

async function handleApiAction(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateApp(request, env);
  if (auth instanceof Response) return auth;
  const { userId, body } = auth;
  const action = typeof body.action === "string" ? body.action : "";
  const value = typeof body.value === "string" ? body.value : "";

  switch (action) {
    case "add_admin": {
      if (!(await isOwner(env, userId))) return new Response("Bu amal faqat asosiy admin uchun.", { status: 403 });
      const targetId = parseInt(value, 10);
      if (Number.isNaN(targetId)) return new Response("Noto'g'ri ID.", { status: 400 });
      const added = await addAdmin(env, targetId);
      if (added) await syncAdminMenuButton(telegramApi(env.TELEGRAM_BOT_TOKEN), env, targetId, true);
      break;
    }
    case "remove_admin": {
      if (!(await isOwner(env, userId))) return new Response("Bu amal faqat asosiy admin uchun.", { status: 403 });
      const targetId = parseInt(value, 10);
      if (Number.isNaN(targetId)) return new Response("Noto'g'ri ID.", { status: 400 });
      const removed = await removeAdmin(env, targetId);
      if (removed) await syncAdminMenuButton(telegramApi(env.TELEGRAM_BOT_TOKEN), env, targetId, false);
      break;
    }
    case "transfer_ownership": {
      if (!(await isOwner(env, userId))) return new Response("Bu amal faqat asosiy admin uchun.", { status: 403 });
      const targetId = parseInt(value, 10);
      if (Number.isNaN(targetId)) return new Response("Noto'g'ri ID.", { status: 400 });
      const transferred = await transferOwnership(env, targetId);
      if (!transferred) {
        return new Response("Bu ID hali admin emas - avval uni admin qiling.", { status: 400 });
      }
      break;
    }
    case "broadcast_on":
      await setBroadcastEnabled(env, true);
      break;
    case "broadcast_off":
      await setBroadcastEnabled(env, false);
      break;
    default:
      return new Response("Noma'lum amal.", { status: 400 });
  }

  const state = await buildAppState(env);
  return new Response(JSON.stringify(state), { headers: { "Content-Type": "application/json" } });
}

async function handleUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, env);
    return;
  }

  const message = update.message;
  if (!message || !message.text || !message.from) return;

  const tg = telegramApi(env.TELEGRAM_BOT_TOKEN);
  const chatId = message.chat.id;
  const text = message.text.trim();

  if (text.startsWith("/")) {
    await handleCommand(tg, env, chatId, message.from, text);
  }
  // Oddiy (buyruq bo'lmagan) xabarlarga bu bot javob bermaydi - u faqat admin panel
  // va ZOOM e'lon eslatmalari uchun mo'ljallangan, AI avtomatik javob funksiyasi yo'q.
}

async function handleCommand(
  tg: ReturnType<typeof telegramApi>,
  env: Env,
  chatId: number,
  from: TelegramUser,
  text: string,
): Promise<void> {
  const [command, ...args] = text.split(/\s+/);
  const userId = from.id;

  async function requireAdmin(): Promise<boolean> {
    if (await isAdmin(env, userId)) return true;
    await tg.sendMessage(chatId, "Bu buyruq faqat adminlar uchun.");
    return false;
  }

  async function requireOwner(): Promise<boolean> {
    if (await isOwner(env, userId)) return true;
    await tg.sendMessage(chatId, "Bu buyruq faqat asosiy admin uchun.");
    return false;
  }

  switch (command) {
    case "/start": {
      const admins = await getAdmins(env);
      if (admins.length === 0) {
        // Birinchi marta ishga tushganda - buyruq yozgan birinchi odam avtomatik egasi bo'ladi.
        await addAdmin(env, userId);
      }

      // Kimligidan qat'iy nazar (admin bo'lishi shart emas) - /start bosgan har bir odam
      // obunachi deb qayd etiladi. Ular ZOOM eslatmalarini olishi-olmasligi admin panelda
      // yoqilgan/o'chirilgan "hammaga yuborish" tugmasiga bog'liq.
      await addSubscriber(env, userId);

      if (await isAdmin(env, userId)) {
        await syncAdminMenuButton(tg, env, userId, true);
        await tg.sendMessage(
          chatId,
          `${WELCOME_TEXT}\n\nBoshqaruv panelini ochish uchun ☰ Menu tugmasini yoki /panel buyrug'ini bosing.`,
          panelKeyboard(`${env.APP_BASE_URL}/app`),
        );

        // Admin (yangi tayinlangan bo'lsa ham) xabarsiz qolmasin - ertaga bo'ladigan tadbir
        // (bo'lsa) va bugun bo'ladigan, lekin vaqti hali o'tmagan tadbir (bo'lsa) darhol
        // yuboriladi. Bu odatdagi 17:00dagi eslatmani ALMASHTIRMAYDI - shunchaki hozir
        // ko'rib qo'yishi uchun qo'shimcha, tezkor xabar.
        const catchUp = await getStartCatchUp(env);
        if (catchUp.length > 0) {
          const lines = catchUp.map(formatEventLine).join("\n\n");
          await tg.sendMessage(chatId, `📋 Yaqin orada bo'lib o'tadigan ZOOM tadbirlar:\n\n${lines}`);
        }
      } else {
        await tg.sendMessage(chatId, WELCOME_TEXT);
      }
      return;
    }

    case "/panel": {
      if (!(await requireAdmin())) return;
      await tg.sendMessage(chatId, "Boshqaruv paneli:", panelKeyboard(`${env.APP_BASE_URL}/app`));
      return;
    }

    case "/listadmins": {
      if (!(await requireAdmin())) return;
      const admins = await getAdmins(env);
      const ownerId = await getOwner(env);
      const lines = admins.map((id) => (id === ownerId ? `👑 ${id} (asosiy admin)` : `${id}`));
      await tg.sendMessage(chatId, lines.join("\n") || "Adminlar yo'q.");
      return;
    }

    case "/addadmin": {
      if (!(await requireOwner())) return;
      const targetId = parseInt(args[0], 10);
      if (args.length !== 1 || Number.isNaN(targetId)) {
        await tg.sendMessage(chatId, "Foydalanish: /addadmin <Telegram ID>");
        return;
      }
      const added = await addAdmin(env, targetId);
      if (added) await syncAdminMenuButton(tg, env, targetId, true);
      await tg.sendMessage(chatId, added ? `${targetId} endi admin.` : `${targetId} allaqachon admin edi.`);
      return;
    }

    case "/removeadmin": {
      if (!(await requireOwner())) return;
      const targetId = parseInt(args[0], 10);
      if (args.length !== 1 || Number.isNaN(targetId)) {
        await tg.sendMessage(chatId, "Foydalanish: /removeadmin <Telegram ID>");
        return;
      }
      const removed = await removeAdmin(env, targetId);
      if (removed) await syncAdminMenuButton(tg, env, targetId, false);
      await tg.sendMessage(
        chatId,
        removed
          ? `${targetId} adminlikdan olib tashlandi.`
          : "Bajarilmadi: bu ID admin emas, asosiy admin (egasi)ni to'g'ridan-to'g'ri o'chirib bo'lmaydi, yoki oxirgi (yagona) adminni olib tashlab bo'lmaydi.",
      );
      return;
    }

    default:
      await tg.sendMessage(chatId, "Noma'lum buyruq. /panel - boshqaruv panelini ochish.");
  }
}

async function handleCallbackQuery(cq: TelegramCallbackQuery, env: Env): Promise<void> {
  const tg = telegramApi(env.TELEGRAM_BOT_TOKEN);
  await tg.answerCallbackQuery(cq.id);
}
