// inDiKo Kit: "Tablets" view. Talks to the MQTT broker straight from the browser
// (MQTT over WebSocket), so it needs no Python and no server of its own.
(function () {
  "use strict";
  const { $, h, fill, icon, toggle, hud, ago, lsGet, lsSet, mqttSettings } = Kit;
  const STORE = "fkkit.tablets";
  const STALE_MS = 3 * 60 * 1000;
  const MAX_JSON = 256 * 1024;
  const td = new TextDecoder();

  const cfg = Object.assign({ ws: "", batWarn: true, batTts: false }, lsGet(STORE) || {});
  const tablets = new Map(); // tid -> { online, state, retained, seen, page, pageAt, bat }
  let client = null;
  let key = "";
  let conn = { state: "closed", detail: "", since: 0 };
  let sheet = null; // { kind: "tablet", tid } | { kind: "settings" }

  // ---------------------------------------------------------------- connection
  function wsDefault(broker) {
    const b = (broker || "").trim().toLowerCase();
    if (!b) return "";
    if (b === "broker.emqx.io") return "wss://broker.emqx.io:8084/mqtt";
    if (b === "broker.hivemq.com") return "wss://broker.hivemq.com:8884/mqtt";
    if (b === "test.mosquitto.org") return "wss://test.mosquitto.org:8081";
    return `ws://${broker.trim()}:9001`;
  }
  function settings() {
    const m = mqttSettings();
    return Object.assign(m, { ws: (cfg.ws || "").trim() || wsDefault(m.broker) });
  }

  function connect() {
    const s = settings();
    const next = [s.ws, s.base, s.user, s.pass].join("\n");
    if (next === key && client) return;
    key = next;
    if (client) { client.end(); client = null; }
    tablets.clear();
    if (!s.ws || !s.base) { conn = { state: "closed", detail: "Kein Server", since: 0 }; scheduleRender(); return; }
    client = new MqttLite({ url: s.ws, username: s.user, password: s.pass, clientId: "indiko-kit-" + Math.random().toString(16).slice(2, 8) });
    client.on("state", (st, detail) => {
      conn = { state: st, detail, since: st === "online" ? Date.now() : conn.since };
      scheduleRender();
    });
    client.on("message", onMessage);
    client.subscribe([`${s.base}/+/availability`, `${s.base}/+/state`, `${s.base}/+/page`]);
    client.connect();
  }
  let reconnectTimer = null;
  Kit.onChange(() => { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 900); });

  function tablet(tid) {
    let t = tablets.get(tid);
    if (!t) { t = { online: null, state: null, retained: false, seen: 0, page: null, pageAt: 0, bat: null }; tablets.set(tid, t); }
    return t;
  }

  function onMessage(topic, payload, retained) {
    const base = settings().base + "/";
    if (!topic.startsWith(base)) return;
    const rest = topic.slice(base.length);
    const cut = rest.indexOf("/");
    if (cut <= 0) return;
    const tid = rest.slice(0, cut);
    const kind = rest.slice(cut + 1);
    if (kind !== "availability" && kind !== "state" && kind !== "page") return;
    if (payload.length > MAX_JSON) return;
    const text = td.decode(payload);
    const t = tablet(tid);
    if (kind === "availability") {
      t.online = text.trim() === "online";
    } else {
      let data = null;
      try { data = JSON.parse(text); } catch (e) { return; }
      if (!data || typeof data !== "object") return;
      if (kind === "state") {
        t.state = data;
        t.retained = retained;
        if (!retained) { t.seen = Date.now(); batteryCheck(tid, t); }
      } else {
        t.page = data;
        t.pageAt = retained ? (data.ts || 0) : Date.now();
      }
    }
    scheduleRender();
  }

  function send(tid, cmd, payload, quiet) {
    if (!client || client.state !== "online") { hud("Keine Verbindung", "bad"); return false; }
    client.publish(`${settings().base}/${tid}/set/${cmd}`, payload == null ? "" : String(payload));
    if (!quiet) hud("Gesendet");
    return true;
  }

  // ---------------------------------------------------------------- battery notices
  function batteryCheck(tid, t) {
    if (!cfg.batWarn || t.online === false) return;
    const b = (t.state && t.state.battery) || {};
    const lvl = Number(b.level);
    if (!Number.isFinite(lvl) || lvl < 0) return;
    if (b.charging || lvl > 25) { t.bat = null; return; }
    let text = null;
    if (lvl <= 10 && t.bat !== "crit") { t.bat = "crit"; text = `Akku fast leer, nur noch ${lvl} Prozent. Bitte jetzt aufladen.`; }
    else if (lvl <= 20 && !t.bat) { t.bat = "warn"; text = `Akku bei ${lvl} Prozent. Bitte bald aufladen.`; }
    if (!text) return;
    send(tid, "toast", "🔋 " + text, true);
    if (cfg.batTts) send(tid, "tts", text, true);
  }

  // ---------------------------------------------------------------- page probe
  // Runs inside AsTeRICS Grid on the tablet (via FreeKiosk "execute_js"). Reads what
  // the page knows (voices, user, open grid) and publishes it to {base}/{tid}/page
  // over its own short MQTT-over-WebSocket connection. Must stay self-contained.
  function pageProbe(CFG) {
    var te = new TextEncoder();
    function cat(parts) {
      var n = 0, p = 0, i;
      for (i = 0; i < parts.length; i++) n += parts[i].length;
      var out = new Uint8Array(n);
      for (i = 0; i < parts.length; i++) { out.set(parts[i], p); p += parts[i].length; }
      return out;
    }
    function mstr(s) { var b = te.encode(s), o = new Uint8Array(2 + b.length); o[0] = b.length >> 8; o[1] = b.length & 255; o.set(b, 2); return o; }
    function remLen(n) { var out = []; do { var d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0); return new Uint8Array(out); }
    function packet(type, body) { return cat([new Uint8Array([type]), remLen(body.length), body]); }
    function report(obj) {
      var ws;
      try { ws = new WebSocket(CFG.ws, ["mqtt"]); } catch (e) { return; }
      ws.binaryType = "arraybuffer";
      var sent = false;
      ws.onopen = function () {
        var flags = 0x02, payload = [mstr(CFG.cid)];
        if (CFG.user) { flags |= 0x80; payload.push(mstr(CFG.user)); }
        if (CFG.pass) { flags |= 0x40; payload.push(mstr(CFG.pass)); }
        ws.send(packet(0x10, cat([mstr("MQTT"), new Uint8Array([4, flags, 0, 30])].concat(payload))));
      };
      ws.onmessage = function (ev) {
        var b = new Uint8Array(ev.data);
        if (sent || b[0] !== 0x20) return;
        sent = true;
        if (b[3] !== 0) { ws.close(); return; }
        ws.send(packet(0x31, cat([mstr(CFG.topic), te.encode(JSON.stringify(obj))])));
        setTimeout(function () { try { ws.send(new Uint8Array([0xe0, 0])); ws.close(); } catch (e) {} }, 400);
      };
      ws.onerror = function () {};
      setTimeout(function () { try { ws.close(); } catch (e) {} }, 10000);
    }
    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function withVoices(cb) {
      var s = window.speechSynthesis;
      if (!s || !s.getVoices) { cb(null); return; }
      var v = s.getVoices();
      if (v && v.length) { cb(v); return; }
      var done = false;
      var finish = function () { if (!done) { done = true; cb(s.getVoices() || []); } };
      try { s.addEventListener("voiceschanged", finish); } catch (e) {}
      setTimeout(finish, 2000);
    }
    if (CFG.action === "open_grid" && CFG.arg) location.hash = "#grid/name/" + encodeURIComponent(CFG.arg);
    if (CFG.action === "home") location.hash = "#main";
    setTimeout(function () {
      withVoices(function (voices) {
        report({
          ts: Date.now(), hash: location.hash, host: location.host,
          user: lsGet("AUTOLOGIN_USER_KEY") || lsGet("LAST_ACTIVEUSER_KEY"),
          appVersion: lsGet("AG_CURRENT_VERSION_KEY"), title: document.title,
          speech: !!window.speechSynthesis, browserLang: navigator.language,
          voices: voices ? Array.prototype.map.call(voices, function (x) {
            return { name: x.name, lang: x.lang, local: !!x.localService, def: !!x["default"] };
          }) : null,
        });
      });
    }, CFG.action ? 1500 : 0);
  }

  function probe(tid, action, arg) {
    const s = settings();
    if (!/^wss:\/\//i.test(s.ws)) { hud("Braucht einen wss://-Server", "bad"); return; }
    const c = { ws: s.ws, topic: `${s.base}/${tid}/page`, user: s.user, pass: s.pass,
      cid: "page-" + Math.random().toString(16).slice(2, 10), action: action || "", arg: arg || "" };
    send(tid, "execute_js", `(${pageProbe.toString()})(${JSON.stringify(c)});true;`, true);
    hud(action ? "Gesendet" : "Frage ab …");
  }

  // ---------------------------------------------------------------- helpers
  const g = (o, path) => path.split(".").reduce((v, k) => (v == null ? undefined : v[k]), o);
  function statusOf(t) {
    if (t.online === false) return "off";
    if (t.online === true) {
      const last = t.seen || conn.since;
      return last && Date.now() - last > STALE_MS ? "stale" : "on";
    }
    return "unknown";
  }
  const STATUS = {
    on: ["ok", "Online"], stale: ["warn", "Keine Daten"], off: ["", "Offline"], unknown: ["", "Unbekannt"],
  };
  function battery(s) {
    const lvl = Number(g(s, "battery.level"));
    if (!Number.isFinite(lvl) || lvl < 0) return null;
    const chg = !!g(s, "battery.charging");
    const cls = chg ? "chg" : lvl <= 15 ? "low" : lvl <= 30 ? "mid" : "";
    const bar = h("span", { class: "batt-bar" }, h("i", { style: `width:calc(${Math.max(4, Math.min(100, lvl))}% - 3px)` }));
    return h("span", { class: "batt " + cls, title: chg ? "lädt" : "" }, bar, `${lvl} %${chg ? " ⚡" : ""}`);
  }
  function gridName(hash) {
    if (!hash) return "";
    if (hash === "#main" || hash === "#" || hash === "") return "Start";
    const m = hash.match(/^#grid\/(?:name\/)?(.+)$/);
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    return hash.replace(/^#/, "");
  }
  function voiceSummary(p) {
    if (!p) return "–";
    if (!p.speech) return "keine Sprachausgabe";
    const vs = p.voices || [];
    if (!vs.length) return "keine Stimmen";
    const langs = {};
    vs.forEach((v) => { const k = (v.lang || "?").split(/[-_]/)[0]; langs[k] = (langs[k] || 0) + 1; });
    return `${vs.length} · ` + Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} ${n}`).join(", ");
  }

  // ---------------------------------------------------------------- render list
  let raf = 0;
  function scheduleRender() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; render(); });
  }

  function connLine() {
    const s = settings();
    if (conn.state === "online") return [h("span", { class: "dot ok" }), " Verbunden · ", h("span", { class: "mono" }, s.base)];
    if (conn.state === "connecting") return [h("span", { class: "dot busy" }), " Verbinde …"];
    if (!s.ws || !s.base) return [h("span", { class: "dot" }), " Kein Server eingestellt"];
    return [h("span", { class: "dot bad" }), " Keine Verbindung" + (conn.detail ? " · " + conn.detail : "")];
  }

  function render() {
    fill($("t-sub"), ...connLine());
    const entries = [...tablets.entries()].filter(([, t]) => t.state || t.online !== null);
    entries.sort(([a, ta], [b, tb]) => {
      const rank = { stale: 0, on: 1, unknown: 2, off: 3 };
      const r = rank[statusOf(ta)] - rank[statusOf(tb)];
      return r || a.localeCompare(b, "de", { numeric: true });
    });

    const counts = { on: 0, off: 0, low: 0 };
    for (const [, t] of entries) {
      const st = statusOf(t);
      if (st === "on" || st === "stale") counts.on++; else if (st === "off") counts.off++;
      const lvl = Number(g(t.state, "battery.level"));
      if (st !== "off" && Number.isFinite(lvl) && lvl <= 20 && !g(t.state, "battery.charging")) counts.low++;
    }
    fill($("t-summary"),
      entries.length ? h("span", { class: "pill ok" }, h("span", { class: "dot ok" }), `${counts.on} online`) : null,
      counts.off ? h("span", { class: "pill" }, `${counts.off} offline`) : null,
      counts.low ? h("span", { class: "pill bad" }, `${counts.low} Akku niedrig`) : null
    );

    const box = $("t-cards");
    if (!entries.length) {
      box.style.display = "block";
      if (conn.state === "online") {
        fill(box, h("div", { class: "empty" }, icon("tablet"), h("h2", {}, "Noch keine Tablets"),
          h("p", {}, "Tablets mit demselben Kanal erscheinen hier.")));
      } else {
        fill(box, h("div", { class: "empty" }, icon("cloudOff"), h("h2", {}, conn.state === "connecting" ? "Verbinde …" : "Keine Verbindung"),
          h("p", {}, conn.detail || settings().ws || ""), h("button", { type: "button", class: "btn light", onclick: openSettings }, "Verbindung")));
      }
    } else {
      box.style.display = "";
      fill(box, ...entries.map(([tid, t]) => card(tid, t)));
    }
    if (sheet && sheet.kind === "tablet") updateTablet();
  }

  function card(tid, t) {
    const st = statusOf(t);
    const [dot, label] = STATUS[st];
    const s = t.state || {};
    const sig = Number(g(s, "wifi.signalLevel"));
    const bt = g(s, "bluetooth.bonded") || [];
    const btOn = bt.filter((d) => d.connected).length;
    return h("button", { type: "button", class: "tcard" + (st === "off" ? " off" : ""), onclick: () => openTablet(tid) },
      h("div", { class: "tcard-top" }, h("span", { class: "dot " + dot }), h("span", { class: "tcard-name" }, tid)),
      h("div", { class: "tcard-meta" },
        battery(s),
        Number.isFinite(sig) && g(s, "wifi.connected") !== false ? h("span", { title: g(s, "wifi.ssid") || "" }, icon("wifi"), `${sig} %`) : null,
        g(s, "screen.on") === false ? h("span", { title: "Bildschirm aus" }, icon("moon")) : null,
        btOn ? h("span", { title: "Bluetooth-Gerät verbunden" }, icon("bluetooth"), String(btOn)) : null
      ),
      h("div", { class: "tcard-meta" }, st === "on" && t.seen ? `${label} · ${ago(t.seen)}` : st === "stale" ? `${label} · ${ago(t.seen || conn.since)}` : label)
    );
  }

  // ---------------------------------------------------------------- sheet
  function openSheet(title) {
    $("sheet-title").textContent = title;
    $("sheet").classList.add("open");
    $("sheet").setAttribute("aria-hidden", "false");
    $("scrim").classList.add("open");
    $("sheet").scrollTop = 0;
  }
  function closeSheet() {
    sheet = null;
    $("sheet").classList.remove("open");
    $("sheet").setAttribute("aria-hidden", "true");
    $("scrim").classList.remove("open");
  }
  $("sheet-close").addEventListener("click", closeSheet);
  $("scrim").addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheet) closeSheet(); });

  const groupH = (text, extra) => h("div", { class: "group-h" }, h("span", {}, text), extra || null);
  const row = (...kids) => h("div", { class: "row" }, ...kids);
  const act = (ic, label, fn, cls) => h("button", { type: "button", class: "act" + (cls ? " " + cls : ""), onclick: fn }, icon(ic), label);

  function slider(ic, label, onSet) {
    const r = h("input", { type: "range", min: "0", max: "100", value: "50", "aria-label": label });
    const out = h("output", {}, "–");
    r.addEventListener("input", () => { out.textContent = r.value + " %"; r.dataset.busy = "1"; });
    r.addEventListener("change", () => { onSet(r.value); setTimeout(() => delete r.dataset.busy, 4000); });
    return { el: row(h("span", { title: label, style: "color:var(--muted);display:flex" }, icon(ic)), h("div", { class: "range" }, r, out)), r, out };
  }
  function textSend(placeholder, buttons) {
    const inp = h("input", { type: "text", placeholder, maxlength: "500", spellcheck: "false" });
    const run = (fn) => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } if (fn(v) !== false) inp.value = ""; };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") run(buttons[0][1]); });
    return row(h("div", { class: "inline" }, inp, ...buttons.map(([label, fn]) => h("button", { type: "button", class: "btn sm light", onclick: () => run(fn) }, label))));
  }

  let ui = null;
  function openTablet(tid) {
    sheet = { kind: "tablet", tid };
    const bright = slider("sun", "Helligkeit", (v) => send(tid, "brightness", v));
    const vol = slider("volume", "Lautstärke", (v) => send(tid, "volume", v));
    ui = {
      stats: h("div", { class: "stats" }), bright, vol,
      bt: h("div", {}), grid: h("div", { class: "group" }), info: h("div", { class: "group" }),
      raw: h("pre", { class: "raw" }),
    };
    openSheet(tid);
    fill($("sheet-body"),
      ui.stats,
      groupH("Steuern"),
      h("div", { class: "actions" },
        act("refresh", "Neu laden", () => send(tid, "reload")),
        act("eye", "Wecken", () => send(tid, "wake")),
        act("moon", "Bildschirm aus", () => send(tid, "screen", "OFF")),
        act("bell", "Piepen", () => send(tid, "audio_beep")),
        act("power", "Neustart", () => { if (confirm(`${tid} neu starten?`)) send(tid, "reboot"); }, "danger")),
      h("div", { class: "group", style: "margin-top:10px" }, bright.el, vol.el),
      groupH("Nachricht"),
      h("div", { class: "group" }, textSend("Text", [["Zeigen", (v) => send(tid, "toast", v)], ["Vorlesen", (v) => send(tid, "tts", v)]])),
      ui.bt,
      groupH("AsTeRICS Grid", h("button", { type: "button", class: "link", onclick: () => probe(tid) }, "Abfragen")),
      ui.grid,
      h("details", { class: "more" }, h("summary", {}, icon("chev"), "Details"), ui.info,
        h("div", { class: "group-h" }, "Rohdaten"), h("div", { class: "group" }, ui.raw))
    );
    updateTablet();
  }

  function updateTablet() {
    const tid = sheet.tid;
    const t = tablets.get(tid) || { state: null };
    const s = t.state || {};
    const st = statusOf(t);
    const [dot, label] = STATUS[st];
    fill($("sheet-sub"), h("span", { class: "dot " + dot }), t.seen ? `${label} · ${ago(t.seen)}` : label);

    const lvl = g(s, "battery.level");
    const sig = g(s, "wifi.signalLevel");
    fill(ui.stats,
      h("div", { class: "stat" }, h("small", {}, "Akku"), h("strong", {}, lvl != null ? `${lvl} %${g(s, "battery.charging") ? " ⚡" : ""}` : "–")),
      h("div", { class: "stat" }, h("small", {}, "WLAN"), h("strong", { title: g(s, "wifi.ssid") || "" }, sig != null ? `${sig} %` : "–")),
      h("div", { class: "stat" }, h("small", {}, "Bildschirm"), h("strong", {}, g(s, "screen.on") === true ? "an" : g(s, "screen.on") === false ? "aus" : "–"))
    );
    for (const [sl, path] of [[ui.bright, "screen.brightness"], [ui.vol, "audio.volume"]]) {
      const v = g(s, path);
      if (v != null && !sl.r.dataset.busy) { sl.r.value = String(v); sl.out.textContent = v + " %"; }
    }
    renderBluetooth(tid, s.bluetooth);
    renderGrid(tid, t);

    const info = [
      ["WLAN", g(s, "wifi.ssid")], ["IP", g(s, "device.ip") || g(s, "wifi.ipAddress")], ["FreeKiosk", g(s, "device.version")],
      ["Android", g(s, "device.androidVersion")], ["Modell", g(s, "device.model")],
      ["Geräteverwaltung", g(s, "device.isDeviceOwner") === true ? "ja" : g(s, "device.isDeviceOwner") === false ? "nein" : null],
      ["Kiosk", g(s, "device.kioskMode") === true ? "an" : g(s, "device.kioskMode") === false ? "aus" : null],
      ["Seite", g(s, "webview.currentUrl")],
    ];
    fill(ui.info, ...info.map(([k, v]) => row(h("span", { class: "lbl" }, k), h("span", { class: "val", style: "overflow-wrap:anywhere" }, v == null || v === "" ? "–" : String(v)))));
    ui.raw.textContent = JSON.stringify(s, null, 2);
  }

  function renderBluetooth(tid, bt) {
    const head = groupH("Bluetooth", bt && bt.scanning ? h("span", { class: "spin", title: "Suche läuft" }) : null);
    if (!bt) {
      fill(ui.bt, head, h("div", { class: "group" }, row(h("span", { class: "grow", style: "color:var(--muted)" }, "Braucht die neue FreeKiosk-Version"))));
      return;
    }
    const rows = [];
    const power = toggle("Bluetooth", "bluetooth", bt.enabled, (on) => send(tid, "bt_power", on ? "ON" : "OFF"), true);
    if (bt.enabled) {
      for (const d of bt.bonded || []) {
        rows.push(row(
          h("span", { class: "grow" }, d.name || d.address, " ", d.connected ? h("span", { class: "badge ok" }, "verbunden") : null),
          h("button", { type: "button", class: "btn sm ghost", onclick: () => { if (confirm(`${d.name || d.address} entfernen?`)) send(tid, "bt_unpair", d.address); } }, "Entfernen")));
      }
      const found = (bt.found || []).filter((d) => !d.bonded && !(bt.bonded || []).some((b) => b.address === d.address));
      found.sort((a, b) => (b.name ? 1 : 0) - (a.name ? 1 : 0) || (b.rssi || -999) - (a.rssi || -999));
      for (const d of found.slice(0, 15)) {
        const busy = bt.pairing === d.address;
        rows.push(row(
          h("span", { class: "grow", style: d.name ? "" : "color:var(--muted)" }, d.name || d.address),
          d.rssi > -200 ? h("span", { class: "badge" }, `${d.rssi} dBm`) : null,
          busy ? h("span", { class: "spin" }) : h("button", { type: "button", class: "btn sm ghost", onclick: () => send(tid, "bt_pair", d.address) }, "Koppeln")));
      }
      rows.push(row(bt.scanning
        ? h("button", { type: "button", class: "btn sm light", onclick: () => send(tid, "bt_scan_stop") }, "Suche stoppen")
        : h("button", { type: "button", class: "btn sm light", onclick: () => send(tid, "bt_scan", "20") }, icon("search"), "Geräte suchen")));
    }
    const foot = bt.lastError ? h("div", { class: "foot err" }, bt.lastError)
      : bt.pairing ? h("div", { class: "foot" }, "Am Tablet bestätigen, falls gefragt.") : null;
    fill(ui.bt, head, h("div", { class: "tgrid" }, power), rows.length ? h("div", { class: "group", style: "margin-top:10px" }, ...rows) : null, foot);
  }

  function renderGrid(tid, t) {
    const p = t.page;
    const inp = h("input", { type: "text", placeholder: "Grid-Name", spellcheck: "false" });
    const open = () => { const v = inp.value.trim(); if (v) probe(tid, "open_grid", v); };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
    const keep = ui.grid.querySelector("input");
    if (keep && document.activeElement === keep) return; // do not steal the field while typing
    fill(ui.grid,
      row(h("span", { class: "lbl" }, "Benutzer"), h("span", { class: "val" }, (p && p.user) || "–")),
      row(h("span", { class: "lbl" }, "Offen"), h("span", { class: "val" }, (p && gridName(p.hash)) || "–")),
      row(h("span", { class: "lbl" }, "Stimmen"), h("span", { class: "val" }, voiceSummary(p))),
      row(h("div", { class: "inline" }, inp,
        h("button", { type: "button", class: "btn sm light", onclick: open }, "Öffnen"),
        h("button", { type: "button", class: "icon-btn", title: "Startseite", "aria-label": "Startseite", onclick: () => probe(tid, "home") }, icon("home")),
        h("button", { type: "button", class: "icon-btn", title: "Teststimme", "aria-label": "Teststimme", onclick: () => send(tid, "tts", "Hallo, das ist ein Test.") }, icon("speak"))))
    );
  }

  // ---------------------------------------------------------------- settings sheet
  function mirror(id, srcId, type, placeholder) {
    const src = $(srcId);
    const el = h("input", { type, value: src.value, placeholder: placeholder || "", spellcheck: "false" });
    el.addEventListener("input", () => { src.value = el.value; src.dispatchEvent(new Event("input", { bubbles: true })); });
    return el;
  }
  function openSettings() {
    sheet = { kind: "settings" };
    openSheet("Verbindung");
    fill($("sheet-sub"), ...connLine());
    const ws = h("input", { type: "text", value: cfg.ws, placeholder: wsDefault($("mq-broker").value) || "wss://…", spellcheck: "false" });
    ws.addEventListener("input", () => { cfg.ws = ws.value.trim(); lsSet(STORE, cfg); clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 900); });
    const tile = (label, ic, prop) => toggle(label, ic, cfg[prop], (on) => { cfg[prop] = on; lsSet(STORE, cfg); });
    fill($("sheet-body"),
      groupH("Server"),
      h("div", { class: "group" },
        h("label", { class: "row" }, h("span", { class: "lbl" }, "MQTT-Server"), mirror("t-broker", "mq-broker", "text")),
        h("label", { class: "row" }, h("span", { class: "lbl" }, "WebSocket"), ws),
        h("label", { class: "row" }, h("span", { class: "lbl" }, "Kanal"), mirror("t-base", "mq-topic", "text")),
        h("label", { class: "row" }, h("span", { class: "lbl" }, "Benutzer"), mirror("t-user", "mq-user", "text", "optional")),
        h("label", { class: "row" }, h("span", { class: "lbl" }, "Passwort"), mirror("t-pass", "mq-pass", "password", "optional"))),
      h("div", { class: "foot" }, "Gilt auch für neue QR-Codes."),
      groupH("Akku"),
      h("div", { class: "tgrid" }, tile("Hinweis unter 20 %", "bell", "batWarn"), tile("Hinweis vorlesen", "speak", "batTts")),
      h("div", { class: "foot" }, "Nur solange diese Seite offen ist.")
    );
  }
  $("t-settings").addEventListener("click", openSettings);

  // ---------------------------------------------------------------- start
  setInterval(() => { if (Kit.view === "tablets" || sheet) scheduleRender(); }, 5000);
  Kit.onShow("tablets", scheduleRender);
  setTimeout(connect, 300);
  window.KitTablets = { tablets, settings, wsDefault, get conn() { return conn; } };
})();
