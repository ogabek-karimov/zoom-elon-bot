const API_BASE = "https://api.telegram.org/bot";

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  web_app?: { url: string };
  url?: string;
}

export interface InlineKeyboard {
  inline_keyboard: InlineKeyboardButton[][];
}

export function telegramApi(token: string) {
  const base = `${API_BASE}${token}`;

  return {
    // Returns whether the send actually succeeded - callers that must not mark something
    // as "done" (e.g. a one-time reminder) unless the message truly went out rely on this.
    async sendMessage(chatId: number, text: string, replyMarkup?: InlineKeyboard): Promise<boolean> {
      const res = await fetch(`${base}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup }),
      });
      if (!res.ok) {
        console.error("sendMessage failed", res.status, await res.text());
        return false;
      }
      return true;
    },

    async editMessageText(chatId: number, messageId: number, text: string, replyMarkup?: InlineKeyboard): Promise<void> {
      const res = await fetch(`${base}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, reply_markup: replyMarkup }),
      });
      if (!res.ok) {
        console.error("editMessageText failed", res.status, await res.text());
      }
    },

    async answerCallbackQuery(callbackQueryId: string, text?: string, showAlert = false): Promise<void> {
      await fetch(`${base}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: showAlert }),
      });
    },

    /**
     * Sets the persistent menu button (☰, next to the message box) for one specific chat.
     * Pass `{ type: "default" }` to remove a custom button (falls back to the bot's own
     * command list); pass a web_app button to open the Mini App from that chat only.
     */
    async setChatMenuButton(
      chatId: number,
      menuButton: { type: "default" } | { type: "web_app"; text: string; web_app: { url: string } },
    ): Promise<void> {
      const res = await fetch(`${base}/setChatMenuButton`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, menu_button: menuButton }),
      });
      if (!res.ok) {
        console.error("setChatMenuButton failed", res.status, await res.text());
      }
    },

    async setWebhook(url: string, secretToken: string): Promise<unknown> {
      const res = await fetch(`${base}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          secret_token: secretToken,
          allowed_updates: ["message", "callback_query"],
        }),
      });
      return res.json();
    },
  };
}
