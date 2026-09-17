export interface Env {
  BOT_KV: KVNamespace;
  AI: Ai;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ADMIN_IDS: string;
  OWNER_ID: string;
  WORKERS_AI_MODEL: string;
  APP_BASE_URL: string;
  ANNOUNCEMENTS_URL: string;
}

// Minimal Telegram types - just the fields this bot actually reads.
export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  is_premium?: boolean;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}
