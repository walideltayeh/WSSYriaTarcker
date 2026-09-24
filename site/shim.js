// Bridges the app to this site: window.claude.use("db"|"user"|"downloads") over /api/state and
// /api/write, the shared access-code gate, and the owner-password prompt for ledger writes.
(() => {
  const KEY = "wst_code";
  let code = ""; try { code = localStorage.getItem(KEY) || ""; } catch (e) {}
  const state = { docs: {} };
  const listeners = [];
  let gateOpen = false, ready = false;
  async function api(path, opts, extra) {
    const o = opts || {};
    const r = await fetch(path, Object.assign({}, o, { headers: Object.assign({ "content-type": "application/json", "x-ws-code": code }, extra || {}) }));
    if (r.status === 401) { openGate(); throw { code: "not_granted" }; }
    if (r.status === 403) throw { code: "forbidden" };
    if (!r.ok) throw { code: "unavailable", message: await r.text() };
    return r.json();
  }
  async function refresh() { const s = await api("/api/state"); state.docs = s.docs || {}; ready = true; for (const f of listeners.slice()) f(); }
  const snap = (p) => ({ id: p.split("/").pop(), exists: state.docs[p] != null, data: () => state.docs[p], metadata: { fromCache: false, hasPendingWrites: false } });
  const collSnap = (c) => { const n = c.split("/").length + 1; const docs = Object.keys(state.docs).filter((k) => k.startsWith(c + "/") && k.split("/").length === n).sort().map(snap); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [] }; };
  const sub = (fn) => { listeners.push(fn); if (ready) fn(); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; };
  let adminPw = "";
  const isLedger = (p) => p === "ledger" || p.indexOf("ledger/") === 0;
  const isMove = (p) => p.indexOf("moves/") === 0;
  async function writeDoc(p, payload, tries) {
    if (isMove(p)) return api("/api/write", { method: "POST", body: JSON.stringify(payload) }, { "x-ws-entry": window.__wsEntry || "" });
    if (!isLedger(p)) return api("/api/write", { method: "POST", body: JSON.stringify(payload) });
    if (!adminPw) { adminPw = await askPassword(); if (!adminPw) throw { code: "cancelled" }; }
    try {
      return await api("/api/write", { method: "POST", body: JSON.stringify(payload) }, { "x-ws-admin": adminPw });
    } catch (e) {
      if (e && e.code === "forbidden" && (tries || 0) < 2) { adminPw = ""; return writeDoc(p, payload, (tries || 0) + 1); }
      throw e;
    }
  }
  const docRef = (p) => ({
    id: p.split("/").pop(), path: p,
    get: async () => { await refresh(); return snap(p); },
    set: async (d) => { await writeDoc(p, { op: "set", path: p, data: d }); await refresh(); },
    update: async (d) => { await docRef(p).set(Object.assign({}, state.docs[p] || {}, d)); },
    delete: async () => { await writeDoc(p, { op: "delete", path: p }); await refresh(); },
    onSnapshot: (next) => sub(() => next(snap(p))),
    collection: (c) => collRef(p + "/" + c),
  });
  const collRef = (c) => ({ path: c, doc: (id) => docRef(c + "/" + (id || crypto.randomUUID())), get: async () => { await refresh(); return collSnap(c); }, onSnapshot: (next) => sub(() => next(collSnap(c))) });
  const db = { doc: docRef, collection: collRef };
  const user = { canEdit: async () => true, can: async () => true, isOwner: async () => true, id: async () => null, profiles: async () => ({}), me: async () => ({ id: null, name: "", avatarUrl: "", color: "#AB2328", email: null, isOwner: true, canEdit: true }) };
  const downloads = { save: async ({ filename, data }) => { const b = data instanceof Blob ? data : new Blob([data]); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000); return { status: "saved" }; } };
  window.claude = { use: async (n) => (n === "db" ? db : n === "user" ? user : n === "downloads" ? downloads : null) };
  function askPassword(wrong) {
    return new Promise((resolve) => {
      const w = document.createElement("div");
      w.dir = "ltr";
      w.style.cssText = "position:fixed;inset:0;z-index:1000;background:rgba(31,26,26,.55);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Jost,system-ui,sans-serif";
      w.innerHTML = '<form style="background:#fff;border-radius:4px;padding:26px;max-width:360px;width:100%;display:grid;gap:12px;text-align:center">'
        + '<div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#5E5454">Owner password</div>'
        + '<div style="font-size:14px;color:#5E5454">Replacing the ledger needs your password<br><span dir="rtl">تحديث الدفتر يحتاج كلمة مرور المالك</span></div>'
        + '<input name="p" type="password" autocomplete="current-password" style="border:1px solid #D8CFCC;border-radius:4px;padding:11px;font-size:16px;text-align:center" />'
        + '<div style="display:flex;gap:8px"><button type="button" data-cancel style="flex:1;background:#fff;border:1px solid #D8CFCC;border-radius:4px;padding:11px;font-size:12.5px;letter-spacing:.1em;text-transform:uppercase;cursor:pointer">Cancel</button>'
        + '<button style="flex:1;background:#AB2328;color:#fff;border:0;border-radius:4px;padding:11px;font-size:12.5px;letter-spacing:.1em;text-transform:uppercase;cursor:pointer">Confirm</button></div>'
        + (wrong ? '<div style="color:#AB2328;font-size:13px">Wrong password · كلمة مرور خاطئة</div>' : "") + "</form>";
      document.body.appendChild(w);
      const form = w.querySelector("form");
      form.querySelector("[data-cancel]").addEventListener("click", () => { w.remove(); resolve(""); });
      form.addEventListener("submit", (e) => { e.preventDefault(); const v = form.p.value; w.remove(); resolve(v); });
      setTimeout(() => form.p.focus(), 30);
    });
  }
  function openGate(msg) {
    if (gateOpen) return; gateOpen = true;
    const w = document.createElement("div");
    w.dir = "ltr";
    w.style.cssText = "position:fixed;inset:0;z-index:999;background:#FAF8F6;display:flex;align-items:center;justify-content:center;padding:24px;font-family:Jost,system-ui,sans-serif";
    w.innerHTML = '<form style="background:#fff;border:1px solid #ECE6E3;border-radius:4px;padding:28px;max-width:340px;width:100%;display:grid;gap:14px;text-align:center">'
      + '<div style="background:#AB2328;color:#fff;margin:-28px -28px 4px;padding:14px;font-size:12px;letter-spacing:.22em;text-transform:uppercase">WS Tracker</div>'
      + '<div style="font-size:14px;color:#5E5454">Enter the access code · أدخل رمز الدخول</div>'
      + '<input name="c" autocomplete="off" autocapitalize="off" style="border:1px solid #D8CFCC;border-radius:4px;padding:11px;font-size:16px;text-align:center" />'
      + '<button style="background:#AB2328;color:#fff;border:0;border-radius:4px;padding:12px;font-size:12.5px;letter-spacing:.1em;text-transform:uppercase;cursor:pointer">Open</button>'
      + '<div data-err style="color:#AB2328;font-size:13px;min-height:16px"></div></form>';
    document.body.appendChild(w);
    const form = w.querySelector("form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      code = form.c.value.trim();
      try {
        const r = await fetch("/api/state", { headers: { "x-ws-code": code } });
        if (!r.ok) throw new Error("bad");
        try { localStorage.setItem(KEY, code); } catch (err) {}
        location.reload();
      } catch (err) { w.querySelector("[data-err]").textContent = "Wrong code · رمز خاطئ"; }
    });
  }
  refresh().catch(() => {});
  setInterval(() => { if (!gateOpen) refresh().catch(() => {}); }, 20000);
})();
