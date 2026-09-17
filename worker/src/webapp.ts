export function renderAppHtml(): string {
  return `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Boshqaruv paneli</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--tg-theme-bg-color, #ffffff);
    color: var(--tg-theme-text-color, #111111);
  }
  h1 { font-size: 18px; margin: 4px 0 16px; }
  .card {
    background: var(--tg-theme-secondary-bg-color, #f2f2f2);
    border-radius: 12px;
    padding: 14px;
    margin-bottom: 14px;
  }
  .label { font-weight: 600; font-size: 15px; }
  .hint { color: var(--tg-theme-hint-color, #888888); font-size: 13px; margin-top: 4px; }
  button {
    border: none; border-radius: 8px; padding: 10px 14px;
    font-size: 14px; font-weight: 600; cursor: pointer;
    background: var(--tg-theme-button-color, #2481cc);
    color: var(--tg-theme-button-text-color, #ffffff);
  }
  button.danger { background: #e5484d; color: white; }
  .btn-row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .admin-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 0; border-bottom: 1px solid rgba(128,128,128,0.2);
    font-size: 14px;
  }
  .admin-item:last-child { border-bottom: none; }
  .event-item {
    padding: 8px 0; border-bottom: 1px solid rgba(128,128,128,0.2);
    font-size: 14px;
  }
  .event-item:last-child { border-bottom: none; }
  input[type="text"] {
    flex: 1; padding: 9px 10px; border-radius: 8px;
    border: 1px solid var(--tg-theme-hint-color, #cccccc);
    background: var(--tg-theme-bg-color, #ffffff); color: inherit; font-size: 14px;
  }
  #status { text-align: center; margin-top: 40px; color: var(--tg-theme-hint-color, #888); }
</style>
</head>
<body>
  <div id="status">Yuklanmoqda...</div>
  <div id="app" style="display:none">
    <h1>⚙️ Boshqaruv paneli</h1>

    <div class="card">
      <div class="label">Adminlar</div>
      <div class="hint">👑 - asosiy admin (egasi). Qolganlari - kichik adminlar.</div>
      <div id="adminList" style="margin-top:8px"></div>
      <div id="adminManageArea">
        <div class="btn-row">
          <input type="text" id="newAdminId" placeholder="Telegram ID" inputmode="numeric" />
          <button id="addAdminBtn">Qo'shish</button>
        </div>
        <div class="hint" style="margin-top:10px">Asosiy adminlik huquqini o'tkazish (avval yuqoridagi ID admin bo'lishi kerak):</div>
        <div class="btn-row">
          <input type="text" id="transferOwnerId" placeholder="Telegram ID" inputmode="numeric" />
          <button class="danger" id="transferOwnerBtn">O'tkazish</button>
        </div>
      </div>
      <div id="adminManageHint" class="hint" hidden>Adminlarni boshqarish va egalikni o'tkazish faqat asosiy admin uchun.</div>
    </div>

    <div class="card">
      <div class="label">📢 Kuzatilayotgan ZOOM tadbirlar</div>
      <div class="hint">uzswlu.uz saytida har soatda tekshiriladi - tadbirdan 1 kun oldin shu ro'yxatdagilar haqida eslatma keladi.</div>
      <div id="eventList" style="margin-top:8px"></div>
    </div>
  </div>

<script>
  const tg = window.Telegram.WebApp;
  tg.ready();
  tg.expand();

  const statusEl = document.getElementById("status");
  const appEl = document.getElementById("app");
  const adminListEl = document.getElementById("adminList");

  async function api(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: tg.initData, ...body }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || ("HTTP " + res.status));
    }
    return res.json();
  }

  function renderAdmins(admins, ownerId, isOwnerMe) {
    adminListEl.innerHTML = "";
    if (admins.length === 0) {
      adminListEl.innerHTML = '<div class="hint">Adminlar yo\\'q</div>';
      return;
    }
    for (const id of admins) {
      const row = document.createElement("div");
      row.className = "admin-item";
      const span = document.createElement("span");
      span.textContent = (id === ownerId ? "👑 " : "") + id + (id === ownerId ? " (asosiy admin)" : "");
      row.appendChild(span);
      if (isOwnerMe && id !== ownerId) {
        const btn = document.createElement("button");
        btn.className = "danger";
        btn.textContent = "O'chirish";
        btn.style.padding = "6px 10px";
        btn.style.fontSize = "12px";
        btn.onclick = () => removeAdmin(id);
        row.appendChild(btn);
      }
      adminListEl.appendChild(row);
    }
  }

  function renderEvents(events) {
    const eventListEl = document.getElementById("eventList");
    eventListEl.innerHTML = "";
    if (events.length === 0) {
      eventListEl.innerHTML = '<div class="hint" style="padding:6px 0">Hozircha kuzatilayotgan tadbir yo\\'q</div>';
      return;
    }
    const sorted = [...events].sort((a, b) => a.isoDate.localeCompare(b.isoDate));
    for (const ev of sorted) {
      const row = document.createElement("div");
      row.className = "event-item";
      row.innerHTML =
        '<div style="font-weight:600">' + escapeHtml(ev.title) + '</div>' +
        '<div class="hint">' + escapeHtml(ev.isoDate) + ' - ' + escapeHtml(ev.timeText) +
        (ev.reminded ? ' - eslatma yuborilgan' : ' - eslatma hali yuborilmagan') + '</div>';
      eventListEl.appendChild(row);
    }
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function render(state) {
    const myId = tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user.id : null;
    const isOwnerMe = myId === state.ownerId;
    renderAdmins(state.admins, state.ownerId, isOwnerMe);
    document.getElementById("adminManageArea").hidden = !isOwnerMe;
    document.getElementById("adminManageHint").hidden = isOwnerMe;
    renderEvents(state.pending);
  }

  async function load() {
    try {
      const state = await api("/api/state", {});
      render(state);
      statusEl.style.display = "none";
      appEl.style.display = "block";
    } catch (e) {
      statusEl.textContent = "Xatolik: " + e.message;
    }
  }

  document.getElementById("addAdminBtn").addEventListener("click", async () => {
    const input = document.getElementById("newAdminId");
    const id = input.value.trim();
    if (!id) return;
    try {
      const state = await api("/api/action", { action: "add_admin", value: id });
      render(state);
      input.value = "";
    } catch (e) {
      tg.showAlert("Xatolik: " + e.message);
    }
  });

  document.getElementById("transferOwnerBtn").addEventListener("click", async () => {
    const input = document.getElementById("transferOwnerId");
    const id = input.value.trim();
    if (!id) return;
    tg.showConfirm(
      "Asosiy adminlik huquqini " + id + "ga o'tkazmoqchimisiz? Siz kichik adminga aylanasiz.",
      async (ok) => {
        if (!ok) return;
        try {
          const state = await api("/api/action", { action: "transfer_ownership", value: id });
          render(state);
          input.value = "";
        } catch (e) {
          tg.showAlert("Xatolik: " + e.message);
        }
      },
    );
  });

  async function removeAdmin(id) {
    try {
      const state = await api("/api/action", { action: "remove_admin", value: String(id) });
      render(state);
    } catch (e) {
      tg.showAlert("Xatolik: " + e.message);
    }
  }

  load();
</script>
</body>
</html>`;
}
