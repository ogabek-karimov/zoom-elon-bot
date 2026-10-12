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
    // Returns the sent message's id on success, null on failure - callers that must not mark
    // something as "done" (e.g. a one-time reminder) unless the message truly went out rely
    // on the null check; the id itself lets a later caller delete that exact message (e.g.
    // when the announcement it was about gets retracted - see pruneDeletedEvents).
    async sendMessage(chatId: number, text: string, replyMarkup?: InlineKeyboard): Promise<number | null> {
      const res = await fetch(`${base}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup }),
      });
      if (!res.ok) {
        console.error("sendMessage failed", res.status, await res.text());
        return null;
      }
      const data = (await res.json()) as { result?: { message_id?: number } };
      return data.result?.message_id ?? null;
    },

    /**
     * Returns whether the delete actually succeeded. Telegram only allows deleting a
     * message within 48h of sending it (see callers for the text-notice fallback when
     * that window has passed, or the chat/message is otherwise gone).
     */
    async deleteMessage(chatId: number, messageId: number): Promise<boolean> {
      const res = await fetch(`${base}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
      });
      if (!res.ok) {
        console.error("deleteMessage failed", res.status, await res.text());
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
