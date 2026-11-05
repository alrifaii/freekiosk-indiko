// inDiKo Kit: "Tablets" view. Talks to the MQTT broker straight from the browser
// (MQTT over WebSocket), so it needs no Python and no server of its own.
// AsTeRICS Grid on the tablets is driven through FreeKiosk's "execute_js": a small
// agent runs inside the Grid page, does one thing (switch user, set the voice, load a
// template ...) and reports the page's state back over its own MQTT connection.
(function () {
  "use strict";
  const { $, h, fill, icon, toggle, hud, ago, lsGet, lsSet, mqttSettings } = Kit;
  const STORE = "fkkit.tablets";
  const URLS_STORE = "fkkit.urls";
  const STALE_MS = 3 * 60 * 1000;
  const MAX_JSON = 256 * 1024;
  const GRID_URL = "https://grid.asterics.eu/";
  const LIB_BASE = "https://asterics.github.io/Asterics-AAC-Data/";
  const PUBLIC_BROKERS = ["broker.emqx.io", "broker.hivemq.com", "test.mosquitto.org"];
  const td = new TextDecoder();

  const cfg = Object.assign({ ws: "", batWarn: true, batTts: false }, lsGet(STORE) || {});
  const tablets = new Map(); // tid -> { online, state, retained, seen, page, pageAt, bat, asked }
  let client = null;
  let key = "";
  let conn = { state: "closed", detail: "", since: 0 };
  let selecting = false;
  const selected = new Set();

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
  const publicBroker = () => PUBLIC_BROKERS.includes(settings().broker.toLowerCase());

  function connect() {
    const s = settings();
    const next = [s.ws, s.base, s.user, s.pass].join("\n");
    if (next === key && client) return;
    key = next;
    if (client) { client.end(); client = null; }
    tablets.clear();
    selected.clear();
    if (!s.ws || !s.base) { conn = { state: "closed", detail: "Kein Server", since: 0 }; scheduleRender(); return; }
    client = new MqttLite({ url: s.ws, username: s.user, password: s.pass, clientId: "indiko-kit-" + Math.random().toString(16).slice(2, 8) });
    client.on("state", (st, detail) => {
      conn = { state: st, detail, since: st === "online" ? Date.now() : conn.since };
      scheduleRender();
    });
    client.on("message", onMessage);
    client.subscribe([`${s.base}/+/availability`, `${s.base}/+/state`, `${s.base}/+/page`, `${s.base}/+/image/screenshot`, ...listeners.keys()]);
    client.connect();
  }
  let reconnectTimer = null;
  Kit.onChange(() => { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 900); });

  // Screenshots: FreeKiosk publishes them retained. The kit shows a fresh one and then
  // clears it from the server, so no picture of the screen stays there.
  function onScreenshot(tid, topic, payload, retained) {
    if (!payload.length) return;
    if (client) client.publish(topic, new Uint8Array(0), { retain: true });
    if (retained) return;
    const t = tablet(tid);
    if (t.shot) URL.revokeObjectURL(t.shot.url);
    t.shot = { url: URL.createObjectURL(new Blob([payload], { type: "image/jpeg" })), at: Date.now(), kb: Math.round(payload.length / 1024) };
    t.shotWait = 0;
    scheduleRender();
  }
  // The screen next to the sheet: opens with "Bildschirmfoto", follows every command
  // sent to that tablet and refreshes itself while open.
  const shotView = { tid: null, timer: 0, every: 0 };
  function showShot(tid) {
    if (window.innerWidth < 900) { push(screenshotPage(tid)); return; }
    shotView.tid = tid;
    $("shotpanel").hidden = false;
    clearInterval(shotView.every);
    shotView.every = setInterval(() => { if (shotView.tid && !document.hidden) requestShot(shotView.tid); }, 30000);
    requestShot(tid);
  }
  function hideShot() {
    shotView.tid = null;
    clearTimeout(shotView.timer);
    clearInterval(shotView.every);
    $("shotpanel").hidden = true;
  }
  function afterAction(tid, delay) {
    if (shotView.tid !== tid) return;
    clearTimeout(shotView.timer);
    shotView.timer = setTimeout(() => { if (shotView.tid === tid) requestShot(tid); }, delay);
  }
  function renderShot() {
    const tid = shotView.tid;
    if (!tid) return;
    const panel = $("shotpanel");
    const t = tablets.get(tid) || {};
    const enabled = g(t, "state.images.screenshotEnabled");
    const waiting = t.shotWait && Date.now() - t.shotWait < 15000;
    const late = t.shotWait && !waiting;
    const key = JSON.stringify([tid, t.shot && t.shot.at, !!waiting, !!late, enabled, Math.floor(Date.now() / 10000)]);
    if (same(panel, key)) return;
    const note = enabled !== true && (late || !t.shot) ? "Bildschirmfotos sind auf diesem Tablet aus. Mit einem neuen QR-Code einrichten oder in FreeKiosk unter MQTT einschalten."
      : late && !t.shot ? "Kein Bild gekommen. Ist der Bildschirm aus? Erst wecken." : "";
    fill(panel,
      h("div", { class: "shotpanel-head" }, avatarEl(tid, "sm"),
        h("span", { class: "grow" }, h("b", {}, displayName(tid)),
          h("small", {}, waiting ? "Bild wird geholt …" : t.shot ? `Bildschirm · ${ago(t.shot.at)}` : "Bildschirm")),
        h("button", { type: "button", class: "icon-btn", title: "Neu aufnehmen", "aria-label": "Neu aufnehmen", onclick: () => requestShot(tid) }, icon("refresh")),
        h("button", { type: "button", class: "icon-btn", title: "Schließen", "aria-label": "Schließen", onclick: hideShot }, icon("x"))),
      h("div", { class: "shotpanel-body" },
        t.shot ? h("img", { src: t.shot.url, alt: "Bildschirm von " + displayName(tid) }) : null,
        note ? h("p", {}, note) : null,
        waiting ? h("span", { class: "spin" }) : null));
  }

  function requestShot(tid) {
    const t = tablet(tid);
    if (send(tid, "screenshot_capture", "", true)) t.shotWait = Date.now();
    scheduleRender();
  }

  function tablet(tid) {
    let t = tablets.get(tid);
    if (!t) { t = { online: null, state: null, retained: false, seen: 0, page: null, pageAt: 0, bat: null, asked: false }; tablets.set(tid, t); }
    return t;
  }

  // Other parts of the kit (Grid erstellen) listen on topics of their own
  const listeners = new Map();
  function listen(topic, fn) {
    listeners.set(topic, fn);
    if (client) client.subscribe([topic]);
    return () => listeners.delete(topic);
  }

  function onMessage(topic, payload, retained) {
    const own = listeners.get(topic);
    if (own) return own(topic, payload, retained);
    const base = settings().base + "/";
    if (!topic.startsWith(base)) return;
    const rest = topic.slice(base.length);
    const cut = rest.indexOf("/");
    if (cut <= 0) return;
    const tid = rest.slice(0, cut);
    const kind = rest.slice(cut + 1);
    if (kind === "image/screenshot") return onScreenshot(tid, topic, payload, retained);
    if (kind !== "availability" && kind !== "state" && kind !== "page") return;
    if (payload.length > MAX_JSON) return;
    const text = td.decode(payload);
    const t = tablet(tid);
    if (kind === "availability") {
      t.online = text.trim() === "online";
      if (t.online) autoProbe(tid);
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
        if (!retained && data.result) reportResult(tid, data.result);
      }
    }
    scheduleRender();
  }

  function send(tid, cmd, payload, quiet) {
    if (!client || client.state !== "online") { hud("Keine Verbindung", "bad"); return false; }
    client.publish(`${settings().base}/${tid}/set/${cmd}`, payload == null ? "" : String(payload));
    if (!quiet) hud("Gesendet");
    if (cmd !== "screenshot_capture") afterAction(tid, cmd === "execute_js" ? 4000 : 2500);
    return true;
  }
  function sendAll(tids, cmd, payload, label) {
    if (!client || client.state !== "online") { hud("Keine Verbindung", "bad"); return false; }
    tids.forEach((tid) => send(tid, cmd, payload, true));
    hud(label || (tids.length > 1 ? `An ${tids.length} Tablets gesendet` : "Gesendet"));
    return true;
  }

  // The network name. Older FreeKiosk versions send "WiFi (no permission)" when Android
  // hides it; that is no name.
  function ssidOf(s) {
    const n = String(g(s || {}, "wifi.ssid") || "").trim();
    return !n || /^WiFi( \(.*\))?$/.test(n) || n === "<unknown ssid>" ? "" : n;
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

  // ---------------------------------------------------------------- Grid agent
  // Runs inside AsTeRICS Grid on the tablet. Must stay self-contained (it is sent as
  // source text). Uses Grid's own settings interface (window.service, the app's
  // localStorageService) and its routes; no private data leaves the tablet except
  // user names, voice list and settings flags.
  function gridAgent(CFG) {
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
      // CONNACK may arrive split over several frames (it does with some brokers)
      var buf = [];
      ws.onmessage = function (ev) {
        if (sent) return;
        var b = new Uint8Array(ev.data);
        for (var i = 0; i < b.length; i++) buf.push(b[i]);
        if (buf.length < 4) return;
        sent = true;
        if (buf[0] !== 0x20 || buf[3] !== 0) { ws.close(); return; }
        ws.send(packet(0x31, cat([mstr(CFG.topic), te.encode(JSON.stringify(obj))])));
        setTimeout(function () { try { ws.send(new Uint8Array([0xe0, 0])); ws.close(); } catch (e) {} }, 400);
      };
      ws.onerror = function () {};
      setTimeout(function () { try { ws.close(); } catch (e) {} }, 10000);
    }
    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function tryf(f, d) { try { var v = f(); return v === undefined || v === null ? d : v; } catch (e) { return d; } }
    var S = window.service && window.service.getUserSettings ? window.service : null;
    function withVoices(cb) {
      var s = window.speechSynthesis;
      if (!s || !s.getVoices) { cb(null); return; }
      var v = s.getVoices();
      if (v && v.length) { cb(v); return; }
      var done = false;
      var fin = function () { if (!done) { done = true; cb(s.getVoices() || []); } };
      try { s.addEventListener("voiceschanged", fin); } catch (e) {}
      setTimeout(fin, 2000);
    }
    function snapshot(result, voices) {
      var us = S ? tryf(function () { return S.getUserSettings(); }, null) : null;
      var app = S ? tryf(function () { return S.getAppSettings(); }, null) : null;
      var vc = (us && us.voiceConfig) || {};
      var online = S ? tryf(function () { return S.getSavedOnlineUsers(); }, []) : [];
      var local = S ? tryf(function () { return S.getSavedLocalUsers(); }, []) : [];
      return {
        ts: Date.now(), hash: location.hash, host: location.host, path: location.pathname, title: document.title, href: location.href,
        api: !!S,
        user: (S && tryf(function () { return S.getAutologinUser() || S.getLastActiveUser(); }, "")) || lsGet("AUTOLOGIN_USER_KEY") || lsGet("LAST_ACTIVEUSER_KEY") || "",
        users: online.map(function (u) { return { name: u, online: true }; }).concat(local.map(function (u) { return { name: u, online: false }; })),
        appVersion: lsGet("AG_CURRENT_VERSION_KEY"),
        voice: { uri: vc.preferredVoice || "", rate: vc.voiceRate || 1, pitch: vc.voicePitch || 1 },
        locked: us && us.metadata && "locked" in us.metadata ? !!us.metadata.locked : null,
        template: (us && us.originGridsetFilename) || "",
        input: inputSnap(),
        contentLang: (us && us.contentLang) || "",
        app: app ? { lang: app.appLang || "", sync: !!app.syncNavigation, passcode: !!app.unlockPasscode, speechUrl: app.externalSpeechServiceUrl || "" } : null,
        speech: !!window.speechSynthesis, browserLang: navigator.language,
        voices: voices ? Array.prototype.map.call(voices, function (x) {
          return { uri: x.voiceURI || x.name, name: x.name, lang: x.lang, local: !!x.localService, def: !!x["default"] };
        }) : null,
        result: result || null
      };
    }
    function finish(result, delay) {
      setTimeout(function () { withVoices(function (v) { report(snapshot(result, v)); }); }, delay || 0);
    }
    function reloadTo(url) { setTimeout(function () { if (url) location.href = url; else location.reload(); }, 900); }
    function setInput(el, value) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    function waitFor(test, ms, cb) {
      var t0 = Date.now();
      (function poll() {
        var r = tryf(test, null);
        if (r) return cb(r);
        if (Date.now() - t0 > ms) return cb(null);
        setTimeout(poll, 250);
      })();
    }
    // AsTeRICS Grid is a Vue 2 app: every component's root element carries its
    // instance. Settings that only live in Grid's encrypted database (scanning,
    // importing grids) are changed through Grid's own dialogs, like a person would.
    function rootVm() {
      var all = document.querySelectorAll("body *");
      for (var i = 0; i < all.length && i < 5000; i++) if (all[i].__vue__) return all[i].__vue__.$root;
      return null;
    }
    function findVm(test) {
      var r = rootVm();
      if (!r) return null;
      var queue = [r];
      while (queue.length) {
        var v = queue.shift();
        if (tryf(function () { return test(v); }, false)) return v;
        var kids = v.$children || [];
        for (var k = 0; k < kids.length; k++) queue.push(kids[k]);
      }
      return null;
    }
    function gridViewVm() { return findVm(function (v) { return typeof v.openModal === "function" && v.metadata && v.metadata.inputConfig; }); }
    function inputSnap() {
      var gv = tryf(gridViewVm, null);
      var ic = gv && gv.metadata && gv.metadata.inputConfig;
      if (!ic) return null;
      return { scan: !!ic.scanEnabled, scanAuto: !!ic.scanAuto, scanTimeoutMs: ic.scanTimeoutMs || 1000,
        dir: !!ic.dirEnabled, huff: !!ic.huffEnabled, seq: !!ic.seqEnabled, mouse: ic.mouseclickEnabled !== false };
    }
    // Receive a file from the kit over a short MQTT connection of its own: subscribe,
    // say "ready", collect the pieces. Nothing is kept on the server (no retained
    // message), and small pieces pass every broker's size limit.
    function receiveFile(topic, n, cb) {
      var ws, done = false, buf = new Uint8Array(0), parts = [], got = 0, timer = null;
      var end = function (data, why) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { ws.send(new Uint8Array([0xe0, 0])); ws.close(); } catch (e) {}
        cb(data, why);
      };
      var wait = function (ms, why) { clearTimeout(timer); timer = setTimeout(function () { end(null, why()); }, ms); };
      try { ws = new WebSocket(CFG.ws, ["mqtt"]); } catch (e) { return cb(null, "Tablet erreicht den MQTT-Server nicht"); }
      ws.binaryType = "arraybuffer";
      wait(15000, function () { return "Tablet erreicht den MQTT-Server nicht"; });
      ws.onopen = function () {
        var flags = 0x02, payload = [mstr(CFG.cid + "f")];
        if (CFG.user) { flags |= 0x80; payload.push(mstr(CFG.user)); }
        if (CFG.pass) { flags |= 0x40; payload.push(mstr(CFG.pass)); }
        ws.send(packet(0x10, cat([mstr("MQTT"), new Uint8Array([4, flags, 0, 60])].concat(payload))));
      };
      ws.onclose = function () { end(null, got ? "Verbindung brach ab (" + got + " von " + n + " Teilen)" : "Verbindung zum MQTT-Server brach ab"); };
      ws.onmessage = function (ev) {
        buf = cat([buf, new Uint8Array(ev.data)]);
        for (;;) {
          if (buf.length < 2) return;
          var len = 0, mul = 1, i = 1, ok = false;
          for (; i < Math.min(buf.length, 5); i++) { len += (buf[i] & 127) * mul; mul *= 128; if (!(buf[i] & 128)) { ok = true; i++; break; } }
          if (!ok || buf.length < i + len) return;
          var hdr = buf[0], type = hdr >> 4, body = buf.slice(i, i + len);
          buf = buf.slice(i + len);
          if (type === 2) {
            if (body[1] !== 0) return end(null, "MQTT-Server lehnt die Anmeldung ab (Code " + body[1] + ")");
            ws.send(packet(0x82, cat([new Uint8Array([0, 1]), mstr(topic + "/c/+"), new Uint8Array([0])])));
          } else if (type === 9) {
            // Subscribed: now the kit may send
            ws.send(packet(0x30, cat([mstr(topic + "/ready"), te.encode(CFG.cid)])));
            wait(60000, function () { return got ? "Datei kam nicht ganz an (" + got + " von " + n + " Teilen)" : "Keine Antwort vom Kit (Kit-Fenster offen?)"; });
          } else if (type === 3) {
            var tl = (body[0] << 8) | body[1];
            var t = new TextDecoder().decode(body.subarray(2, 2 + tl));
            var p = 2 + tl + (((hdr >> 1) & 3) ? 2 : 0);
            var k = t.indexOf(topic + "/c/") === 0 ? parseInt(t.slice(topic.length + 3), 10) : -1;
            if (k >= 0 && k < n && !parts[k]) {
              parts[k] = body.slice(p);
              got++;
              wait(30000, function () { return "Datei kam nicht ganz an (" + got + " von " + n + " Teilen)"; });
              if (got === n) return end(cat(parts));
            }
          }
        }
      };
    }
    function gunzip(bytes, cb) {
      if (!window.DecompressionStream) return cb(null, "Browser am Tablet zu alt zum Entpacken");
      new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
        .then(function (b) { cb(new Uint8Array(b)); }, function () { cb(null, "Datei beschädigt angekommen"); });
    }

    var a = CFG.action, x = CFG.args || {};
    var base = S ? location.origin + location.pathname : (CFG.gridUrl || "https://grid.asterics.eu/");
    var res = function (ok, msg) { return { action: a, id: CFG.id, ok: ok, msg: msg || "" }; };
    var savedUsers = S ? tryf(function () { return S.getSavedUsers(); }, []) : [];

    if (!a) return finish(null);
    if (a === "open_grid" || a === "home") {
      var target = a === "home" ? "#main" : "#grid/name/" + encodeURIComponent(x.name || "");
      if (!S) { finish(res(true)); return reloadTo(base + target); }
      location.hash = target;
      return finish(res(true), 1500);
    }
    if (a === "gridset") { finish(res(true)); return reloadTo(base + "?gridset_filename=" + encodeURIComponent(x.file) + "#main"); }
    if (a === "flags") {
      var q = [];
      if (x.locked) q.push("locked=true");
      if (x.scanning) q.push("scanning=true");
      finish(res(true));
      return reloadTo(base + (q.length ? "?" + q.join("&") : "") + "#main");
    }
    if (!S) return finish(res(false, "Diese Seite ist kein AsTeRICS Grid"));
    if (a === "switch_user") {
      if (savedUsers.indexOf(x.user) < 0) return finish(res(false, "Benutzer fehlt auf diesem Tablet"));
      S.setAutologinUser(x.user);
      S.setLastActiveUser(x.user);
      finish(res(true));
      return setTimeout(function () { location.hash = "#main"; location.reload(); }, 900);
    }
    if (a === "input") {
      // Scanning and the other input methods: open Grid's scanning dialog, set, save.
      if (!/^#(main|grid\/)/.test(location.hash) || /^#grid\/edit/.test(location.hash)) location.hash = "#main";
      return waitFor(gridViewVm, 12000, function (gv) {
        if (!gv) return finish(res(false, "Grid-Ansicht nicht gefunden"));
        gv.openModal("MODAL_SCANNING");
        waitFor(function () {
          return findVm(function (v) { return typeof v.validateInputs === "function" && v.inputConfig && v.inputConfig.scanInputs && v.metadata; });
        }, 10000, function (m) {
          if (!m) return finish(res(false, "Scanning-Dialog nicht gefunden"));
          if ("scan" in x) m.inputConfig.scanEnabled = !!x.scan;
          if ("scanAuto" in x) m.inputConfig.scanAuto = !!x.scanAuto;
          if (x.scanTimeoutMs) m.inputConfig.scanTimeoutMs = Math.max(200, Math.min(10000, Number(x.scanTimeoutMs)));
          if (x.resetKeys && typeof m.resetInput === "function") m.resetInput();
          if (!m.validateInputs()) { var err = m.error || "Tasten fehlen"; m.cancel(); return finish(res(false, err)); }
          m.save();
          waitFor(function () { return !findVm(function (v) { return v === m; }) ? "closed" : null; }, 8000, function () {
            finish(res(true), 800);
          });
        });
      });
    }
    if (a === "import") {
      // A grid file (.grd, .obf, .obz) from the kit, in pieces and maybe gzipped; import it
      // like "Import custom data from file": keeps existing grids and the user's settings.
      return receiveFile(x.topic, x.n || 1, function (packed, why) {
        if (!packed) return finish(res(false, why || "Datei nicht angekommen"));
        if (x.gz) return gunzip(packed, function (b, why2) { if (!b) return finish(res(false, why2)); importBytes(b); });
        importBytes(packed);
      });
      function importBytes(bytes) {
        location.hash = "#grids";
        waitFor(function () { return findVm(function (v) { return v.importModal && typeof v.reload === "function"; }); }, 12000, function (mg) {
          if (!mg) return finish(res(false, "Grid-Verwaltung nicht gefunden"));
          mg.importModal.show = true;
          waitFor(function () { return findVm(function (v) { return typeof v.fileChanged === "function" && v.options && "resetBeforeImport" in v.options; }); }, 8000, function (im) {
            if (!im) return finish(res(false, "Import-Dialog nicht gefunden"));
            im.options.importDictionaries = true;
            im.options.importUserSettings = false;
            im.options.generateGlobalGrid = false;
            im.options.resetBeforeImport = false;
            var file = new File([bytes], x.name || "grids.grd", { type: "application/octet-stream" });
            Promise.resolve(im.fileChanged({ target: { files: [file] } })).then(function () {
              var data = im.importData;
              var n = data && data.grids ? data.grids.length : 0;
              if (!n) { im.$emit("close"); return finish(res(false, "Keine Grids in der Datei")); }
              var root = rootVm();
              im.save();
              // Grid shows "Import successful" when done; close it like the OK button.
              waitFor(function () {
                var box = root && root.$refs && root.$refs.messageBox;
                return box && box.resolve ? box : null;
              }, 120000, function (box) {
                if (box) tryf(function () { box.handleClose(); return 1; }, 0);
                // ids are regenerated on import; importData holds the new ones
                var first = data.grids[0] && data.grids[0].id;
                location.hash = x.open && first ? "#grid/" + first : "#main";
                finish(res(!!box, box ? n + (n === 1 ? " Grid" : " Grids") + " importiert" : "Import dauert zu lange"), 1500);
              });
            });
          });
        });
      }
    }
    if (a === "unlock") {
      var app0 = tryf(function () { return S.getAppSettings(); }, {});
      if (app0.syncNavigation) return finish(res(false, "Navigation wird geteilt: am Tablet oder im Online-Konto entsperren"));
      var us0 = tryf(function () { return S.getUserSettings(); }, {});
      var meta = {};
      for (var mk in (us0.metadata || {})) meta[mk] = us0.metadata[mk];
      meta.locked = false;
      S.saveUserSettings({ metadata: meta });
      finish(res(true));
      return reloadTo(base + "#main");
    }
    if (a === "voice") {
      var cur = tryf(function () { return S.getUserSettings().voiceConfig; }, {});
      var next = {};
      for (var k in cur) next[k] = cur[k];
      if ("uri" in x) next.preferredVoice = x.uri || null;
      if (x.rate) next.voiceRate = Number(x.rate);
      if (x.pitch) next.voicePitch = Number(x.pitch);
      S.saveUserSettings({ voiceConfig: next });
      return finish(res(true));
    }
    if (a === "speak") {
      // Speaks like AsTeRICS does (its chosen voice) or, with plain, with the default
      // voice of the browser, and says whether it really spoke and with which voice.
      var synth = window.speechSynthesis;
      if (!synth) return finish(res(false, "Keine Sprachausgabe im Browser"));
      return withVoices(function (all) {
        all = all || [];
        var vc = x.plain ? {} : (tryf(function () { return S.getUserSettings().voiceConfig; }, {}) || {});
        var u = new SpeechSynthesisUtterance(x.text || "Hallo");
        var match = all.filter(function (v) { return (v.voiceURI || v.name) === vc.preferredVoice; })[0];
        if (match) { u.lang = match.lang; try { u.voice = match; } catch (e) {} }
        else if (x.lang) u.lang = x.lang;
        u.rate = vc.voiceRate || 1;
        u.pitch = vc.voicePitch || 1;
        var who = match ? (match.name || match.voiceURI) : "Standard-Stimme";
        var told = false, started = false;
        var tell = function (ok, msg) { if (told) return; told = true; finish(res(ok, msg)); };
        u.onstart = function () { started = true; };
        u.onend = function () { tell(true, "Gesprochen mit " + who + " · " + all.length + " Stimmen sichtbar"); };
        u.onerror = function (e) { tell(false, "Sprechen fehlgeschlagen (" + (e && e.error || "Fehler") + ")"); };
        setTimeout(function () { tell(started, started ? "Spricht noch mit " + who : "Keine Ausgabe nach 12 s: Stimme lädt noch oder Tablet neu starten"); }, 12000);
        synth.cancel();
        synth.speak(u);
      });
    }
    if (a === "app") {
      var patch = {};
      if ("lang" in x) patch.appLang = x.lang || "";
      if ("sync" in x) patch.syncNavigation = !!x.sync;
      if ("passcode" in x) patch.unlockPasscode = x.passcode || null;
      S.saveAppSettings(patch);
      // The grid's own language (labels, voice) is a user setting of its own; one
      // choice in the kit sets both
      if ("lang" in x) tryf(function () {
        var prev = (S.getUserSettings() || {}).contentLang;
        S.saveUserSettings({ contentLang: x.lang || undefined, lastContentLang: prev });
        return 1;
      }, 0);
      finish(res(true));
      if ("lang" in x) reloadTo(null);
      return;
    }
    if (a === "login") {
      if (savedUsers.indexOf(x.user) >= 0) {
        S.setAutologinUser(x.user);
        S.setLastActiveUser(x.user);
        finish(res(true, "Schon auf dem Tablet, gewechselt"));
        return setTimeout(function () { location.hash = "#main"; location.reload(); }, 900);
      }
      location.hash = "#login";
      var visible = function (id) { var el = document.getElementById(id); return el && el.offsetParent !== null ? el : null; };
      return waitFor(function () { return visible("inputUser") || visible("inputUser2"); }, 10000, function (userEl) {
        if (!userEl) return finish(res(false, "Anmeldeseite nicht gefunden"));
        // The view is a Vue 2 component; its root element carries the instance.
        var vm = null;
        for (var n = userEl; n && !vm; n = n.parentElement) if (n.__vue__ && typeof n.__vue__.loginPlain === "function") vm = n.__vue__;
        var outcome = function (r, msg) {
          finish(res(r === "ok", r === "ok" ? "" : msg || (r === "bad" ? "Benutzer oder Passwort falsch" : "Keine Antwort, Internet am Tablet?")), 600);
        };
        if (vm) {
          vm.remember = true;
          vm.user = x.user || "";
          vm.password = x.pass || "";
          vm.loginPlain(x.user || "", x.pass || "");
          return waitFor(function () {
            if (vm.loginSuccess === true || !/^#login/.test(location.hash)) return "ok";
            return vm.loginSuccess === false ? "bad" : null;
          }, 30000, function (r) { outcome(r, r === "bad" && vm.loginErrorCode ? String(vm.loginErrorCode) : ""); });
        }
        var view = userEl.closest("form") ? userEl.closest("form").parentElement : document;
        var pwEl = visible("inputPassword") || visible("inputPassword2");
        setInput(userEl, x.user || "");
        setTimeout(function () {
          if (!pwEl) return finish(res(false, "Passwortfeld nicht gefunden"));
          setInput(pwEl, x.pass || "");
          setTimeout(function () {
            var btn = null, all = (view.parentElement || document).querySelectorAll("button.offset-by-one");
            for (var i = 0; i < all.length && !btn; i++) if (all[i].offsetParent !== null) btn = all[i];
            if (!btn) return finish(res(false, "Anmeldeknopf nicht gefunden"));
            btn.click();
            waitFor(function () {
              if (!/^#login/.test(location.hash)) return "ok";
              var bad = document.querySelectorAll(".fa-times");
              for (var j = 0; j < bad.length; j++) if (bad[j].offsetParent !== null) return "bad";
              return null;
            }, 30000, function (r) { outcome(r); });
          }, 400);
        }, 400);
      });
    }
    return finish(res(false, "Unbekannte Aktion"));
  }

  let agentSeq = 0;
  const pending = new Map(); // id -> { tids, label }
  // The agent runs inside an https page, which may only open wss:// connections
  // (plain ws:// is fine for a server on the same machine, used for testing).
  const agentReachable = () => /^wss:\/\//i.test(settings().ws) || /^ws:\/\/(localhost|127\.0\.0\.1)[:/]/i.test(settings().ws);
  function agent(tids, action, args, opts) {
    const s = settings();
    if (!client || client.state !== "online") { hud("Keine Verbindung", "bad"); return; }
    if (!agentReachable()) { hud("Braucht einen wss://-Server", "bad"); return; }
    const id = ++agentSeq;
    if (action) pending.set(id, { label: (opts && opts.label) || "", left: tids.length });
    for (const tid of tids) {
      const c = { ws: s.ws, topic: `${s.base}/${tid}/page`, user: s.user, pass: s.pass,
        cid: "page-" + Math.random().toString(16).slice(2, 10), action: action || "", args: args || {}, id, gridUrl: GRID_URL };
      send(tid, "execute_js", `(${gridAgent.toString()})(${JSON.stringify(c)});true;`, true);
      tablet(tid).asked = true;
    }
    // Actions that reload the page cannot report the result themselves: ask again later,
    // twice, because a reload over a slow connection can take a while.
    if (opts && opts.reprobe) [opts.reprobe, opts.reprobe * 2 + 4000].forEach((ms) => setTimeout(() => agent(tids, "", null, { quiet: true }), ms));
    if (!(opts && opts.quiet)) hud(action ? (opts && opts.sending) || "Gesendet" : "Frage ab …");
  }
  function autoProbe(tid) {
    const t = tablet(tid);
    if (t.asked || !client || client.state !== "online" || !agentReachable()) return;
    t.asked = true;
    setTimeout(() => agent([tid], "", null, { quiet: true }), 1200);
  }
  function reportResult(tid, r) {
    afterAction(tid, 1500);
    const p = pending.get(r.id);
    if (r.ok) {
      if (!p || !p.shown) hud(r.msg || (p && p.label) || "Erledigt");
      if (p) { p.shown = true; p.left--; if (p.left <= 0) pending.delete(r.id); }
    } else {
      hud(`${tid}: ${r.msg || "Fehler"}`, "bad");
    }
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
  const STATUS = { on: ["ok", "Online"], stale: ["warn", "Keine Daten"], off: ["", "Offline"], unknown: ["", "Unbekannt"] };
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
    if (/^#main\b/.test(hash) || hash === "#") return "Haupt-Grid";
    if (/^#login/.test(hash)) return "Anmeldung";
    if (/^#grids/.test(hash)) return "Grid-Verwaltung";
    if (/^#grid\/edit/.test(hash)) return "Bearbeitung";
    const m = hash.match(/^#grid\/name\/(.+)$/);
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    if (/^#grid\//.test(hash)) return "Grid";
    return hash.replace(/^#/, "");
  }
  let langNames = null;
  try { langNames = new Intl.DisplayNames(["de"], { type: "language" }); } catch (e) { langNames = null; }
  function langLabel(code) {
    if (!code) return "";
    try { return (langNames && langNames.of(code.replace("_", "-"))) || code; } catch (e) { return code; }
  }
  function voiceLabel(v) {
    if (!v) return "Standard";
    const n = v.name || v.uri;
    return /^[a-z]{2,3}[-_][a-z]{2}/i.test(n) ? `${langLabel(v.lang)} · ${n.replace(/^[a-z]{2,3}[-_][a-z]{2}[-_]?(x[-_])?/i, "").replace(/[-_]local$/i, "") || "Stimme"}` : n;
  }
  function pageOf(tid) { const t = tablets.get(tid); return t && t.page; }
  function hostOf(url) { const m = (url || "").match(/^https?:\/\/([^/?#]+)(\/[^?#]*)?/i); return m ? m[1] + (m[2] && m[2] !== "/" ? m[2].replace(/\/$/, "") : "") : url || ""; }

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
  function visibleEntries() {
    const entries = [...tablets.entries()].filter(([, t]) => t.state || t.online !== null);
    const rank = { stale: 0, on: 1, unknown: 2, off: 3 };
    entries.sort(([a, ta], [b, tb]) => (rank[statusOf(ta)] - rank[statusOf(tb)]) || a.localeCompare(b, "de", { numeric: true }));
    return entries;
  }

  // ---------------------------------------------------------------- photo and name
  // A picture of the person who uses the tablet, or a colour with initials, and a
  // name. Both stay in this browser only (never on the MQTT server): personal data.
  const AVATAR_STORE = "fkkit.avatars";
  const AVATAR_COLORS = ["#00659c", "#8cb110", "#4e93bd", "#d9822b", "#c0507a", "#7b5ea7", "#2e9c8f", "#757b80"];
  let avatars = lsGet(AVATAR_STORE) || {};
  const prof = (tid) => avatars[tid] || {};
  function saveProf(tid, patch) {
    const next = Object.assign({}, prof(tid), patch);
    for (const k of Object.keys(next)) if (next[k] == null || next[k] === "") delete next[k];
    const all = Object.assign({}, avatars);
    if (Object.keys(next).length) all[tid] = next; else delete all[tid];
    try { localStorage.setItem(AVATAR_STORE, JSON.stringify(all)); avatars = all; }
    catch (e) { hud("Kein Platz mehr für Fotos", "bad"); return false; }
    scheduleRender();
    return true;
  }
  const displayName = (tid) => prof(tid).name || tid;
  function colorOf(tid) {
    const p = prof(tid);
    if (p.color) return p.color;
    let n = 0;
    for (const ch of tid) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
    return AVATAR_COLORS[n % AVATAR_COLORS.length];
  }
  function initials(text) {
    const w = String(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (!w.length) return "?";
    if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
    return (w[0][0] + (/^\d+$/.test(w[1]) ? w[1].slice(-2) : w[1][0])).toUpperCase();
  }
  function avatarEl(tid, size) {
    const p = prof(tid);
    return h("span", { class: "avatar" + (size ? " " + size : ""), style: p.img ? "background:var(--fill2)" : `background:${colorOf(tid)}`, "aria-hidden": "true" },
      p.img ? h("img", { src: p.img, alt: "" }) : initials(displayName(tid)));
  }
  // Square crop, small JPEG: a few KB per tablet in the browser's storage.
  async function squareJpeg(file, size) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      if (!side) throw new Error("leer");
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      return c.toDataURL("image/jpeg", 0.82);
    } finally { URL.revokeObjectURL(url); }
  }

  // ---------------------------------------------------------------- signed commands
  // Installing or removing apps and switching the speech engine need the kit's admin
  // key, which reached the tablet in the QR code. The tablet checks an HMAC-SHA256
  // over "command|package|url|time" and accepts each command once, for 15 minutes.
  function sha256(bytes) {
    const K = [], H = [];
    for (let n = 2, i = 0; i < 64; n++) {
      let prime = true;
      for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
      if (!prime) continue;
      if (i < 8) H.push((Math.pow(n, 1 / 2) * 4294967296) | 0);
      K.push((Math.pow(n, 1 / 3) * 4294967296) | 0);
      i++;
    }
    const len = bytes.length, total = ((len + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(total);
    m.set(bytes);
    m[len] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(total - 4, (len * 8) >>> 0);
    dv.setUint32(total - 8, Math.floor(len / 536870912));
    const w = new Int32Array(64);
    const rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getInt32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        w[i] = (w[i - 16] + (rot(a, 7) ^ rot(a, 18) ^ (a >>> 3)) + w[i - 7] + (rot(b, 17) ^ rot(b, 19) ^ (b >>> 10))) | 0;
      }
      let [a, b, c, d, e, f, g2, hh] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (hh + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g2)) + K[i] + w[i]) | 0;
        const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        hh = g2; g2 = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g2) | 0; H[7] = (H[7] + hh) | 0;
    }
    const out = new Uint8Array(32), ov = new DataView(out.buffer);
    H.forEach((v, i) => ov.setInt32(i * 4, v));
    return out;
  }
  function hmacSha256(key, msg) {
    if (key.length > 64) key = sha256(key);
    const k = new Uint8Array(64);
    k.set(key);
    const inner = new Uint8Array(64 + msg.length), outer = new Uint8Array(96);
    for (let i = 0; i < 64; i++) { inner[i] = k[i] ^ 0x36; outer[i] = k[i] ^ 0x5c; }
    inner.set(msg, 64);
    outer.set(sha256(inner), 64);
    return sha256(outer);
  }
  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  async function hmacHex(key, msg) {
    const te = new TextEncoder();
    // crypto.subtle exists only on https:// and localhost; elsewhere the plain version
    if (window.crypto && crypto.subtle) {
      try {
        const k = await crypto.subtle.importKey("raw", te.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        return hex(new Uint8Array(await crypto.subtle.sign("HMAC", k, te.encode(msg))));
      } catch (e) { /* fall through */ }
    }
    return hex(hmacSha256(te.encode(key), te.encode(msg)));
  }
  // Signed over "cmd|a|b|ts"; what a and b are depends on the command (see AdminSignature.kt).
  async function sendSigned(tids, cmd, a, b, fields, label) {
    const ts = Date.now();
    const sig = await hmacHex(Kit.adminKey(), [cmd, a, b, ts].join("|"));
    return sendAll(tids, cmd, JSON.stringify(Object.assign({}, fields, { ts, sig })), label);
  }
  // A secret inside a command (Wi-Fi password): AES-256-GCM under SHA-256("purpose|key").
  async function encryptFor(purpose, text) {
    if (!(window.crypto && crypto.subtle)) throw new Error("Geht nur, wenn das Kit über Start.bat (localhost) läuft");
    const te = new TextEncoder();
    const raw = await crypto.subtle.digest("SHA-256", te.encode(purpose + "|" + Kit.adminKey()));
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(text)));
    const all = new Uint8Array(iv.length + ct.length);
    all.set(iv);
    all.set(ct, iv.length);
    let bin = "";
    all.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  function render() {
    renderShot();
    fill($("t-sub"), ...connLine());
    const entries = visibleEntries();
    for (const tid of [...selected]) if (!tablets.has(tid)) selected.delete(tid);

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
      counts.low ? h("span", { class: "pill bad" }, `${counts.low} Akku niedrig`) : null);
    $("t-select").hidden = !entries.length;
    $("t-select").textContent = selecting ? "Fertig" : "Auswählen";

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
    renderSelbar();
    if (stack.length) refreshSheet();
  }

  function card(tid, t) {
    const st = statusOf(t);
    const [dot, label] = STATUS[st];
    const s = t.state || {};
    const p = t.page;
    const sig = Number(g(s, "wifi.signalLevel"));
    const bt = g(s, "bluetooth.bonded") || [];
    const btOn = bt.filter((d) => d.connected).length;
    const isSel = selected.has(tid);
    const onclick = () => {
      if (selecting) { if (isSel) selected.delete(tid); else selected.add(tid); scheduleRender(); }
      else openTablet(tid);
    };
    return h("button", { type: "button", class: "tcard" + (st === "off" ? " off" : "") + (selecting ? " selecting" : "") + (isSel ? " sel" : ""), onclick, "aria-pressed": selecting ? String(isSel) : null },
      selecting ? h("span", { class: "selmark" }, isSel ? icon("check") : null) : null,
      h("div", { class: "tcard-top" }, avatarEl(tid),
        h("div", { class: "tcard-name-wrap" }, h("span", { class: "tcard-name" }, displayName(tid)),
          h("span", { class: "tcard-sub" }, h("span", { class: "dot " + dot }), prof(tid).name ? tid : st === "on" && t.seen ? `${label} · ${ago(t.seen)}` : label))),
      h("div", { class: "tcard-meta" },
        battery(s),
        Number.isFinite(sig) && g(s, "wifi.connected") !== false ? h("span", { class: "ssid", title: `Empfang ${sig} %` }, icon("wifi"), h("span", { class: "t" }, ssidOf(s) || `${sig} %`)) : null,
        g(s, "screen.on") === false ? h("span", { title: "Bildschirm aus" }, icon("moon")) : null,
        btOn ? h("span", { title: "Bluetooth-Gerät verbunden" }, icon("bluetooth"), String(btOn)) : null),
      p && p.user ? h("div", { class: "tcard-meta" }, h("span", { title: "AsTeRICS-Benutzer" }, icon("ag:users"), p.user), p.hash ? h("span", {}, icon("ag:th-large"), gridName(p.hash)) : null) : null,
      prof(tid).name || st === "stale" ? h("div", { class: "tcard-meta" }, st === "on" && t.seen ? `${label} · ${ago(t.seen)}` : st === "stale" ? `${label} · ${ago(t.seen || conn.since)}` : label) : null);
  }

  function renderSelbar() {
    const bar = $("t-selbar");
    if (!selecting || Kit.view !== "tablets") { bar.hidden = true; return; }
    bar.hidden = false;
    const all = visibleEntries().map(([tid]) => tid);
    const n = selected.size;
    fill(bar,
      h("span", { class: "selcount" }, n ? `${n} ausgewählt` : "Tablets antippen"),
      h("button", { type: "button", class: "btn ghost sm", onclick: () => { if (n === all.length) selected.clear(); else all.forEach((t) => selected.add(t)); scheduleRender(); } }, n === all.length && n ? "Keine" : "Alle"),
      h("button", { type: "button", class: "btn sm", disabled: !n, onclick: () => openBulk([...selected]) }, "Steuern"));
  }
  $("t-select").addEventListener("click", () => { selecting = !selecting; if (!selecting) selected.clear(); scheduleRender(); });

  // ---------------------------------------------------------------- sheet with pages
  // A small navigation stack, like iOS settings: the root page of a tablet (or of a
  // selection) and pages pushed from it. Each page renders once and refreshes the
  // parts that change when new state arrives.
  let stack = [];
  function openSheet(page) {
    hideShot();
    stack = [page];
    $("sheet").classList.add("open");
    $("sheet").setAttribute("aria-hidden", "false");
    $("scrim").classList.add("open");
    showPage();
  }
  function push(page) { stack.push(page); showPage(); }
  function pop() { if (stack.length > 1) { stack.pop(); showPage(); } }
  function closeSheet() {
    hideShot();
    stack = [];
    $("sheet").classList.remove("open");
    $("sheet").setAttribute("aria-hidden", "true");
    $("scrim").classList.remove("open");
  }
  function showPage() {
    const p = stack[stack.length - 1];
    const prev = stack[stack.length - 2];
    $("sheet-title").textContent = p.title;
    $("sheet-back").hidden = !prev;
    $("sheet-back-label").textContent = prev ? prev.title : "";
    fill($("sheet-sub"));
    const body = $("sheet-body");
    body.replaceChildren();
    p.build(body);
    $("sheet").scrollTop = 0;
    refreshSheet();
  }
  function refreshSheet() {
    const p = stack[stack.length - 1];
    if (p && p.refresh) p.refresh();
  }
  $("sheet-close").addEventListener("click", closeSheet);
  $("sheet-back").addEventListener("click", pop);
  $("scrim").addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && stack.length) { if (stack.length > 1) pop(); else closeSheet(); } });

  const groupH = (text, extra) => h("div", { class: "group-h" }, h("span", {}, text), extra || null);
  const row = (...kids) => h("div", { class: "row" }, ...kids);
  const act = (ic, label, fn, cls) => h("button", { type: "button", class: "act" + (cls ? " " + cls : ""), onclick: fn }, icon(ic), label);
  const navRow = (label, value, fn, ic) => h("button", { type: "button", class: "row nav", onclick: fn },
    ic ? h("span", { class: "nav-ic" }, icon(ic)) : null, h("span", { class: "grow" }, label), h("span", { class: "val" }, value || ""), icon("chev", "chev"));
  // Only typing blocks a refresh; a focused button must not.
  const isFocused = (el) => {
    const a = document.activeElement;
    return !!(el && a && el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== "range" && a.type !== "checkbox");
  };
  const add = (el, ...kids) => el.append(...kids.flat().filter((k) => k != null && k !== false));
  // Redraw a block only when what it shows changed: state arrives every few seconds,
  // and a row replaced between press and release swallows the click.
  const same = (el, key) => { if (el._key === key) return true; el._key = key; return false; };

  function slider(ic, label, onSet, opts) {
    const o = Object.assign({ min: 0, max: 100, step: 1, unit: " %", fmt: (v) => v }, opts || {});
    const r = h("input", { type: "range", min: String(o.min), max: String(o.max), step: String(o.step), value: String(o.min), "aria-label": label });
    const out = h("output", {}, "–");
    r.addEventListener("input", () => { out.textContent = o.fmt(r.value) + o.unit; r.dataset.busy = "1"; });
    r.addEventListener("change", () => { onSet(r.value); setTimeout(() => delete r.dataset.busy, 4000); });
    const set = (v) => { if (v != null && !r.dataset.busy) { r.value = String(v); out.textContent = o.fmt(r.value) + o.unit; } };
    return { el: row(h("span", { title: label, class: "row-ic" }, icon(ic)), h("div", { class: "range" }, r, out)), r, out, set };
  }
  function textSend(placeholder, buttons, type) {
    const inp = h("input", { type: type || "text", placeholder, maxlength: "500", spellcheck: "false" });
    const run = (fn) => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } if (fn(v) !== false) inp.value = ""; };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") run(buttons[0][1]); });
    return row(h("div", { class: "inline" }, inp, ...buttons.map(([label, fn, cls]) => h("button", { type: "button", class: "btn sm " + (cls || "light"), onclick: () => run(fn) }, label))));
  }
  const probeLink = (tids) => h("button", { type: "button", class: "link", onclick: () => agent(tids, "") }, "Abfragen");

  // ---------------------------------------------------------------- tablet page
  function openTablet(tid) { openSheet(tabletPage(tid)); }

  function tabletPage(tid) {
    const ui = {};
    const targets = [tid];
    return {
      get title() { return displayName(tid); },
      build(body) {
        ui.stats = h("div", { class: "stats" });
        ui.tts = h("div", {});
        ui.net = h("div", {});
        ui.doze = h("div", {});
        ui.bright = slider("sun", "Helligkeit", (v) => send(tid, "brightness", v));
        ui.vol = slider("volume", "Lautstärke", (v) => send(tid, "volume", v));
        ui.page = h("div", { class: "group" });
        ui.ag = h("div", {});
        ui.bt = h("div", {});
        ui.info = h("div", { class: "group" });
        ui.raw = h("pre", { class: "raw" });
        add(body,
          h("div", { class: "avatar-pick" },
            h("button", { type: "button", class: "avatar-btn", title: "Foto und Name", "aria-label": "Foto und Name", onclick: () => push(profilePage(tid)) },
              avatarEl(tid, "lg"), icon("camera", "cam"))),
          ui.stats,
          ui.doze,
          groupH("Steuern"),
          h("div", { class: "actions" },
            act("refresh", "Neu laden", () => send(tid, "reload")),
            act("eye", "Wecken", () => { if (send(tid, "screen", "ON", true)) { send(tid, "wake", "", true); hud("Wird geweckt"); } }),
            act("moon", "Bildschirm aus", () => send(tid, "screen", "OFF")),
            act("bell", "Piepen", () => send(tid, "audio_beep")),
            act("screen", "Bildschirm­foto", () => (shotView.tid === tid ? requestShot(tid) : showShot(tid))),
            act("power", "Neustart", () => { if (confirm(`${tid} neu starten?`)) send(tid, "reboot"); }, "danger")),
          h("div", { class: "group", style: "margin-top:10px" }, ui.bright.el, ui.vol.el),
          groupH("Nachricht"),
          h("div", { class: "group" }, textSend("Text", [["Zeigen", (v) => send(tid, "toast", v)], ["Vorlesen", (v) => send(tid, "tts", v)]])),
          groupH("Seite"), ui.page,
          ui.ag,
          ui.tts,
          ui.net,
          ui.bt,
          h("details", { class: "more" }, h("summary", {}, icon("chev"), "Details"), ui.info,
            h("div", { class: "group-h" }, "Rohdaten"), h("div", { class: "group" }, ui.raw)));
      },
      refresh() {
        const t = tablets.get(tid) || { state: null };
        const s = t.state || {};
        const st = statusOf(t);
        const [dot, label] = STATUS[st];
        fill($("sheet-sub"), h("span", { class: "dot " + dot }), t.seen ? `${label} · ${ago(t.seen)}` : label);
        const lvl = g(s, "battery.level");
        const sig = g(s, "wifi.signalLevel");
        fill(ui.stats,
          h("div", { class: "stat" }, h("small", {}, "Akku"), h("strong", {}, lvl != null ? `${lvl} %${g(s, "battery.charging") ? " ⚡" : ""}` : "–")),
          h("div", { class: "stat" }, h("small", {}, sig != null ? `WLAN · ${sig} %` : "WLAN"), h("strong", { class: "ssid", title: ssidOf(s) || "" }, ssidOf(s) || (sig != null ? "Name unbekannt" : "–"))),
          h("div", { class: "stat" }, h("small", {}, "Bildschirm"), h("strong", {}, g(s, "screen.on") === true ? "an" : g(s, "screen.on") === false ? "aus" : "–")));
        const dozing = g(s, "device.batteryExempt") === false;
        if (!same(ui.doze, String(dozing))) fill(ui.doze, dozing ? h("div", { class: "notice" },
          icon("moon"),
          h("span", { class: "grow" }, h("b", {}, "Akku-Optimierung ist an"), h("small", {}, "Android kann FreeKiosk schlafen legen, dann kommen Befehle nicht an. Einmal am Tablet „Zulassen“ tippen.")),
          h("button", { type: "button", class: "btn sm", onclick: () => send(tid, "battery_exempt", "", false) }, "Am Tablet fragen")) : null);
        ui.bright.set(g(s, "screen.brightness"));
        ui.vol.set(g(s, "audio.volume"));
        const open = openUrlOf(t);
        if (!same(ui.page, open)) fill(ui.page, navRow("Offene Seite", siteLabel(open), () => push(urlPage(targets)), "globe"));
        renderAsterics(ui.ag, targets);
        renderSpeech(ui.tts, targets);
        renderNetwork(ui.net, targets);
        renderBluetooth(ui.bt, tid, s.bluetooth);
        const info = [
          ["WLAN", g(s, "wifi.ssid")], ["IP", g(s, "device.ip") || g(s, "wifi.ipAddress")], ["FreeKiosk", g(s, "device.version")],
          ["Android", g(s, "device.androidVersion")], ["Modell", g(s, "device.model")],
          ["Geräteverwaltung", g(s, "device.isDeviceOwner") === true ? "ja" : g(s, "device.isDeviceOwner") === false ? "nein" : null],
          ["Kiosk", g(s, "device.kioskMode") === true ? "an" : g(s, "device.kioskMode") === false ? "aus" : null],
          ["Systemrecht", g(s, "tts.secureSettings") === true ? "ja (über WLAN-Debugging)" : g(s, "tts.secureSettings") === false ? "nein" : null],
          ["Offene Seite", openUrlOf(t)], ["Start-Seite", g(s, "webview.startUrl")], ["AsTeRICS", t.page && t.page.appVersion]];
        fill(ui.info, ...info.map(([k, v]) => row(h("span", { class: "lbl" }, k), h("span", { class: "val", style: "overflow-wrap:anywhere" }, v == null || v === "" ? "–" : String(v)))));
        ui.raw.textContent = JSON.stringify({ state: s, page: t.page }, null, 2);
      },
    };
  }

  // AsTeRICS section, shared by the tablet page and the selection page
  function renderAsterics(box, targets) {
    const single = targets.length === 1 ? pageOf(targets[0]) : null;
    const t = targets.length === 1 ? tablets.get(targets[0]) : null;
    if (same(box, JSON.stringify([targets, single, t && Math.round((Date.now() - t.pageAt) / 60000)]))) return;
    const when = single ? h("span", { class: "muted-s" }, ago(t.pageAt)) : null;
    const head = groupH("AsTeRICS Grid", h("span", { class: "head-r" }, when, probeLink(targets)));
    if (targets.length === 1 && single && !single.api) {
      fill(box, head, h("div", { class: "group" }, row(h("span", { class: "grow muted" }, "Auf dem Tablet ist gerade kein AsTeRICS Grid offen."))));
      return;
    }
    const v = single && single.voice && single.voice.uri ? (single.voices || []).find((x) => x.uri === single.voice.uri) || { name: single.voice.uri } : null;
    fill(box, head, h("div", { class: "group" },
      navRow("Benutzer", single ? single.user || "–" : "", () => push(usersPage(targets)), "ag:users"),
      navRow("Grid", single ? gridName(single.hash) : "", () => push(gridPage(targets)), "ag:th-large"),
      navRow("Stimme", single ? (single.voice ? voiceLabel(v) : "–") : "", () => push(voicePage(targets)), "ag:volume-up"),
      navRow("Bedienung", single && single.input ? (single.input.scan ? "Scanning an" : "Scanning aus") : "", () => push(inputPage(targets)), "ag:sort-amount-down"),
      navRow("Vorlage laden", "", () => push(libraryPage(targets)), "ag:download"),
      navRow("Einstellungen", "", () => push(gridSettingsPage(targets)), "ag:cog")),
      !single && targets.length === 1 ? h("div", { class: "foot" }, "Noch nicht abgefragt.") : null);
  }

  // Speech output of Android (FreeKiosk), shared by the tablet and the selection page
  function renderSpeech(box, targets) {
    const one = targets.length === 1 ? speechOf(targets[0]) : null;
    const emb = one && one.embedded;
    const value = !one ? "" : emb && emb.installing ? "lädt …" : `Standard: ${engineLabel(one, one.preferred || "embedded")}`;
    if (same(box, JSON.stringify([targets, value]))) return;
    fill(box, groupH("Sprachausgabe"), h("div", { class: "group" },
      navRow("Stimmen", value, () => push(voicesPage(targets)), "speak")));
  }

  // Wi-Fi networks saved on the tablet, shared by the tablet and the selection page
  function renderNetwork(box, targets) {
    const one = targets.length === 1 ? tablets.get(targets[0]) : null;
    const w = one ? g(one, "state.wifiNetworks") : null;
    const cur = one ? g(one, "state.wifi.ssid") || (w && w.current) : null;
    const n = w && w.saved ? w.saved.length : 0;
    if (same(box, JSON.stringify([targets, cur, n]))) return;
    fill(box, groupH("Netzwerk"), h("div", { class: "group" },
      navRow("WLANs", one ? [cur, n > 1 ? `+${n - 1}` : ""].filter(Boolean).join(" ") || "–" : "", () => push(wifiPage(targets)), "wifi")));
  }

  function renderBluetooth(box, tid, bt) {
    if (same(box, JSON.stringify(bt || null))) return;
    const head = groupH("Bluetooth", bt && bt.scanning ? h("span", { class: "spin", title: "Suche läuft" }) : null);
    if (!bt) {
      fill(box, head, h("div", { class: "group" }, row(h("span", { class: "grow muted" }, "Braucht die neue FreeKiosk-Version"))));
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
    fill(box, head, h("div", { class: "tgrid" }, power), rows.length ? h("div", { class: "group", style: "margin-top:10px" }, ...rows) : null, foot);
  }

  // ---------------------------------------------------------------- selection page
  function openBulk(tids) {
    const ui = {};
    openSheet({
      title: `${tids.length} Tablets`,
      build(body) {
        ui.ag = h("div", {});
        ui.tts = h("div", {});
        ui.net = h("div", {});
        add(body,
          h("div", { class: "chips" }, ...tids.map((t) => h("span", { class: "chip" }, avatarEl(t, "sm"), displayName(t)))),
          groupH("Steuern"),
          h("div", { class: "actions" },
            act("refresh", "Neu laden", () => sendAll(tids, "reload")),
            act("eye", "Wecken", () => { if (sendAll(tids, "screen", "ON", "Werden geweckt")) tids.forEach((x) => send(x, "wake", "", true)); }),
            act("moon", "Bildschirm aus", () => sendAll(tids, "screen", "OFF")),
            act("bell", "Piepen", () => sendAll(tids, "audio_beep")),
            act("bluetooth", "Bluetooth aus", () => sendAll(tids, "bt_power", "OFF"))),
          groupH("Nachricht"),
          h("div", { class: "group" }, textSend("Text", [["Zeigen", (v) => sendAll(tids, "toast", v)], ["Vorlesen", (v) => sendAll(tids, "tts", v)]])),
          groupH("Seite"),
          h("div", { class: "group" }, navRow("Seite öffnen", "", () => push(urlPage(tids)), "globe")),
          ui.ag, ui.tts, ui.net);
      },
      refresh() { renderAsterics(ui.ag, tids); renderSpeech(ui.tts, tids); renderNetwork(ui.net, tids); },
    });
  }

  // ---------------------------------------------------------------- page: start page
  // Quick picks in the kit's own look: own projects filled, other sites soft, generic
  // symbols instead of foreign logos.
  const SITES = [
    { label: "AsTeRICS Grid", url: GRID_URL, ic: "ag:th-large", own: true },
    { label: "inDiKo", url: "https://www.technikum-wien.at/forschungsprojekte/indiko/", ic: "school", own: true },
    { label: "YouTube", url: "https://www.youtube.com/", ic: "play" },
    { label: "Google Classroom", url: "https://classroom.google.com/", ic: "board" },
    { label: "ANTON", url: "https://anton.app/de/", ic: "star" },
    { label: "Klexikon", url: "https://klexikon.zum.de/", ic: "book" },
    { label: "ARASAAC", url: "https://arasaac.org/", ic: "image" },
    { label: "Scratch", url: "https://scratch.mit.edu/", ic: "code" },
  ];
  // The page really on screen. A FreeKiosk that reports its start page separately
  // (startUrl) reports the open page in currentUrl; an older one only knows its start
  // page, so the Grid agent's last look at the page counts more there.
  function openUrlOf(t) {
    const w = g(t || {}, "state.webview") || {};
    if (w.startUrl !== undefined) return w.currentUrl || w.startUrl || "";
    return (t && t.page && t.page.href) || w.currentUrl || "";
  }
  function siteLabel(url) {
    if (!url) return "–";
    const x = SITES.find((site) => hostOf(site.url) === hostOf(url) && (site.label !== "inDiKo" || /indiko/i.test(url)));
    return x ? x.label : hostOf(url);
  }
  function urlPage(tids) {
    const t0 = tids.length === 1 ? tablets.get(tids[0]) : null;
    const s0 = t0 ? openUrlOf(t0) : "";
    const start0 = t0 ? g(t0, "state.webview.startUrl") || "" : "";
    const presets = [{ label: "AsTeRICS Grid Beta", url: GRID_URL + "latest/" }];
    const known = (u) => SITES.concat(presets).some((p) => p.url.replace(/\/$/, "") === u.replace(/\/$/, ""));
    const fromSetup = ($("fk-url").value || "").trim();
    if (fromSetup && !known(fromSetup)) presets.push({ label: "Aus Einrichten", url: fromSetup });
    for (const u of lsGet(URLS_STORE) || []) if (!known(u)) presets.push({ label: hostOf(u), url: u });
    const choose = (url) => {
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;
      const recent = [url, ...(lsGet(URLS_STORE) || []).filter((u) => u !== url)].slice(0, 5);
      if (!SITES.some((x) => x.url === url) && !/^https:\/\/grid\.asterics\.eu\/(latest\/)?$/.test(url)) lsSet(URLS_STORE, recent);
      if (sendAll(tids, "url", url, tids.length > 1 ? `${tids.length} Tablets öffnen ${hostOf(url)}` : `Öffne ${hostOf(url)}`)) pop();
    };
    const same = (a, b) => a.replace(/[?#].*$/, "").replace(/\/$/, "") === b.replace(/[?#].*$/, "").replace(/\/$/, "");
    return {
      title: "Seite öffnen",
      build(body) {
        add(body,
          s0 ? h("div", { class: "group", style: "margin-bottom:14px" },
            row(h("span", { class: "nav-ic" }, icon("eye")), h("span", { class: "grow" }, h("span", { class: "row-title" }, "Gerade offen"),
              h("small", { class: "row-sub", style: "overflow-wrap:anywhere" }, s0)), h("span", { class: "muted" }, siteLabel(s0))),
            start0 && !same(start0, s0) ? row(h("span", { class: "nav-ic" }, icon("home")), h("span", { class: "grow" }, h("span", { class: "row-title" }, "Start-Seite"),
              h("small", { class: "row-sub", style: "overflow-wrap:anywhere" }, start0)), h("span", { class: "muted" }, siteLabel(start0))) : null) : null,
          h("div", { class: "sites" }, ...SITES.map((x) =>
            h("button", { type: "button", class: "site", title: hostOf(x.url), onclick: () => choose(x.url) },
              h("span", { class: "site-ic" + (x.own ? " own" : "") }, icon(x.ic)), x.label,
              s0 && same(s0, x.url) ? icon("check", "chk") : null))),
          groupH("Weitere"),
          h("div", { class: "group" }, ...presets.map((p) =>
            h("button", { type: "button", class: "row nav", onclick: () => choose(p.url) },
              h("span", { class: "grow" }, h("span", { class: "row-title" }, p.label), h("small", { class: "row-sub" }, hostOf(p.url))),
              s0 && same(s0, p.url) ? icon("check", "chk") : null))),
          groupH("Andere Adresse"),
          h("div", { class: "group" }, textSend("https://…", [["Öffnen", (v) => choose(v), "primary"]], "url")),
          h("div", { class: "foot" }, "Öffnet die Seite sofort und macht sie zur Start-Seite. Ist die Seiten-Sperre an, wird sie freigegeben. Seiten mit Konto (YouTube, Classroom) einmal am Tablet anmelden."));
      },
    };
  }

  // ---------------------------------------------------------------- page: users
  function usersPage(tids) {
    const ui = {};
    const login = () => {
      const user = ui.user.value.trim(), pass = ui.pass.value;
      if (!user || !pass) { (user ? ui.pass : ui.user).focus(); return; }
      agent(tids, "login", { user, pass }, { sending: "Melde an …", label: `${user} angemeldet` });
      ui.pass.value = "";
    };
    return {
      title: "Benutzer",
      build(body) {
        ui.list = h("div", {});
        ui.user = h("input", { type: "text", placeholder: "Benutzername", spellcheck: "false", autocomplete: "off" });
        ui.pass = h("input", { type: "password", placeholder: "Passwort", autocomplete: "new-password" });
        ui.pass.addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
        add(body, ui.list,
          groupH("Online-Konto anmelden"),
          h("div", { class: "group" },
            h("label", { class: "row" }, h("span", { class: "lbl" }, "Benutzer"), ui.user),
            h("label", { class: "row" }, h("span", { class: "lbl" }, "Passwort"), ui.pass),
            row(h("button", { type: "button", class: "btn sm", onclick: login }, "Anmelden"))),
          publicBroker() ? h("div", { class: "foot warn-t" }, "Das Passwort geht über den öffentlichen MQTT-Server. Für echte Konten einen eigenen Server verwenden.") : null,
          h("div", { class: "foot" }, "Grids dieses Kontos am Laptop bearbeiten: ",
            h("a", { href: GRID_URL, target: "_blank", rel: "noopener" }, "grid.asterics.eu"), ". Änderungen kommen von selbst auf die Tablets."));
      },
      refresh() {
        if (isFocused(ui.list)) return;
        const pages = tids.map(pageOf);
        const known = pages.filter(Boolean);
        const users = new Map();
        known.forEach((p) => (p.users || []).forEach((u) => {
          const e = users.get(u.name) || { name: u.name, online: u.online, count: 0, current: 0 };
          e.count++;
          if (p.user === u.name) e.current++;
          users.set(u.name, e);
        }));
        const list = [...users.values()].sort((a, b) => a.name.localeCompare(b.name, "de", { numeric: true }));
        if (same(ui.list, JSON.stringify([list, known.length]))) return;
        const rows = list.map((u) => h("button", { type: "button", class: "row nav", onclick: () => {
          const where = tids.filter((tid) => ((pageOf(tid) || {}).users || []).some((x) => x.name === u.name));
          agent(where, "switch_user", { user: u.name }, { sending: "Wechsle …", label: `${u.name} aktiv`, reprobe: 7000 });
        } },
          h("span", { class: "nav-ic" }, icon("ag:users")),
          h("span", { class: "grow" }, h("span", { class: "row-title" }, u.name),
            h("small", { class: "row-sub" }, (u.online ? "Online-Konto" : "Nur auf dem Tablet") + (tids.length > 1 ? ` · auf ${u.count} von ${tids.length}` : ""))),
          u.current && (tids.length === 1 || u.current === tids.length) ? icon("check", "chk") : null));
        fill(ui.list,
          groupH("Auf dem Tablet", probeLink(tids)),
          h("div", { class: "group" }, ...(rows.length ? rows : [row(h("span", { class: "grow muted" }, known.length ? "Noch keine Benutzer" : "Noch nicht abgefragt"))])));
      },
    };
  }

  // ---------------------------------------------------------------- page: grid
  function gridPage(tids) {
    return {
      title: "Grid",
      build(body) {
        add(body,
          h("div", { class: "group" },
            h("button", { type: "button", class: "row nav", onclick: () => agent(tids, "home", null, { label: "Haupt-Grid offen" }) },
              h("span", { class: "nav-ic" }, icon("ag:home")), h("span", { class: "grow" }, "Haupt-Grid öffnen"))),
          groupH("Grid nach Name öffnen"),
          h("div", { class: "group" }, textSend("z. B. Essen", [["Öffnen", (v) => agent(tids, "open_grid", { name: v }, { label: `${v} offen` }), "primary"]])),
          h("div", { class: "foot" }, "Der Name, wie er in AsTeRICS Grid über dem Grid steht."));
      },
    };
  }

  // ---------------------------------------------------------------- page: voice
  function voicePage(tids) {
    const ui = {};
    return {
      title: "Stimme",
      build(body) {
        ui.list = h("div", {});
        ui.rate = slider("speak", "Tempo", (v) => agent(tids, "voice", { rate: v }, { label: "Tempo gesetzt" }), { min: 0.5, max: 2, step: 0.1, unit: "×", fmt: (v) => Number(v).toFixed(1) });
        ui.pitch = slider("sliders", "Tonhöhe", (v) => agent(tids, "voice", { pitch: v }, { label: "Tonhöhe gesetzt" }), { min: 0.5, max: 2, step: 0.1, unit: "", fmt: (v) => Number(v).toFixed(1) });
        add(body,
          h("div", { class: "group" }, ui.rate.el, ui.pitch.el,
            row(h("button", { type: "button", class: "btn sm light", onclick: () => agent(tids, "speak", { text: "Hallo, so klinge ich." }, { label: "Spricht" }) }, icon("volume"), "Probe hören"))),
          ui.list,
          groupH("Mehr Stimmen"),
          h("div", { class: "group" }, navRow("Stimmen am Tablet", "eingebaut, Samsung, Google", () => push(voicesPage(tids)), "speak")),
          h("div", { class: "foot" }, "AsTeRICS zeigt die Stimmen von FreeKiosk: eingebaute und die von Samsung und Google. Neue Stimme laden, dann hier auswählen."));
      },
      refresh() {
        const pages = tids.map(pageOf).filter(Boolean);
        const first = pages[0];
        if (first && first.voice) { ui.rate.set(first.voice.rate); ui.pitch.set(first.voice.pitch); }
        if (isFocused(ui.list)) return;
        const voices = new Map();
        pages.forEach((p) => (p.voices || []).forEach((v) => {
          const e = voices.get(v.uri) || Object.assign({ count: 0, current: 0 }, v);
          e.count++;
          if (p.voice && p.voice.uri === v.uri) e.current++;
          voices.set(v.uri, e);
        }));
        // Sort by the tablet's language, not the laptop's
        const pref = ((first && ((first.app && first.app.lang) || first.browserLang)) || navigator.language || "de").slice(0, 2);
        const list = [...voices.values()].sort((a, b) =>
          ((b.lang || "").startsWith(pref) - (a.lang || "").startsWith(pref)) || (b.local - a.local) || (a.lang || "").localeCompare(b.lang || "") || a.name.localeCompare(b.name));
        const noneSet = pages.length && pages.every((p) => !p.voice || !p.voice.uri);
        if (same(ui.list, JSON.stringify([list, noneSet, pages.length]))) return;
        const vrow = (v) => h("button", { type: "button", class: "row nav", onclick: () => agent(tids, "voice", { uri: v.uri }, { label: "Stimme gesetzt" }) },
          h("span", { class: "grow" }, h("span", { class: "row-title" }, voiceLabel(v)),
            h("small", { class: "row-sub" }, [v.lang, tids.length > 1 ? `auf ${v.count} von ${tids.length}` : ""].filter(Boolean).join(" · "))),
          h("span", { class: "badge" + (v.local ? " ok" : "") }, v.local ? "offline" : "online"),
          v.current && (tids.length === 1 || v.current === tids.length) ? icon("check", "chk") : null);
        const standard = h("button", { type: "button", class: "row nav", onclick: () => agent(tids, "voice", { uri: "" }, { label: "Standard-Stimme" }) },
          h("span", { class: "grow" }, h("span", { class: "row-title" }, "Standard"), h("small", { class: "row-sub" }, "passt sich der Sprache des Grids an")),
          noneSet ? icon("check", "chk") : null);
        const shown = list.filter((v) => (v.lang || "").startsWith(pref) || v.current);
        const rest = list.filter((v) => !shown.includes(v));
        fill(ui.list,
          groupH("Stimmen", probeLink(tids)),
          pages.length ? h("div", { class: "group" }, standard, ...shown.map(vrow)) : h("div", { class: "group" }, row(h("span", { class: "grow muted" }, "Noch nicht abgefragt"))),
          rest.length ? h("details", { class: "more" }, h("summary", {}, icon("chev"), `Andere Sprachen (${rest.length})`), h("div", { class: "group" }, ...rest.map(vrow))) : null);
      },
    };
  }

  // ---------------------------------------------------------------- page: template library
  let library = null;
  async function loadLibrary() {
    if (library) return library;
    const r = await fetch(LIB_BASE + "live_metadata.json", { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    library = await r.json();
    return library;
  }
  const tr = (v) => (v && typeof v === "object" ? v.de || v.en || Object.values(v)[0] : v) || "";
  function libraryPage(tids) {
    const ui = { lang: "de" };
    const draw = () => {
      if (!library) return;
      const items = library.filter((x) => x.selfContained !== false && (ui.lang === "all" || (x.languages || []).includes(ui.lang)));
      items.sort((a, b) => (b.priority || 0) - (a.priority || 0) || tr(a.name).localeCompare(tr(b.name), "de"));
      fill(ui.grid, ...items.map((x) => {
        const file = x.url.substring(x.url.lastIndexOf("/") + 1);
        const name = tr(x.name);
        return h("button", { type: "button", class: "lib", onclick: () => {
          const where = tids.length > 1 ? `${tids.length} Tablets` : tids[0];
          if (!confirm(`„${name}“ auf ${where} laden?\nEs entsteht ein neuer Benutzer, vorhandene Grids bleiben.`)) return;
          agent(tids, "gridset", { file }, { sending: "Lädt Vorlage …", label: `${name} wird geladen`, reprobe: 20000 });
        } },
          x.thumbnail ? h("img", { src: LIB_BASE + x.thumbnail, alt: "", loading: "lazy" }) : h("span", { class: "lib-ph" }, icon("grid")),
          h("b", {}, name), h("small", {}, [x.author, (x.languages || []).join(", ")].filter(Boolean).join(" · ")));
      }));
      if (!items.length) fill(ui.grid, h("p", { class: "muted" }, "Keine Vorlagen in dieser Sprache."));
    };
    return {
      title: "Vorlage laden",
      build(body) {
        ui.grid = h("div", { class: "libgrid" }, h("div", { class: "empty", style: "padding:30px 0" }, h("span", { class: "spin", style: "display:inline-block" })));
        const seg = h("div", { class: "seg small" },
          h("button", { type: "button", "aria-selected": "true", onclick: (e) => { ui.lang = "de"; seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b === e.currentTarget))); draw(); } }, "Deutsch"),
          h("button", { type: "button", "aria-selected": "false", onclick: (e) => { ui.lang = "all"; seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b === e.currentTarget))); draw(); } }, "Alle"));
        add(body, h("div", { class: "lib-head" }, seg), ui.grid,
          h("div", { class: "foot" }, "Aus der Bibliothek von AsTeRICS. Eigene Grids kommen über ein Online-Konto (Benutzer)."));
        loadLibrary().then(draw).catch((e) => fill(ui.grid, h("div", { class: "empty", style: "padding:30px 0" }, icon("cloudOff"), h("p", {}, "Bibliothek nicht erreichbar"),
          h("button", { type: "button", class: "btn light sm", onclick: () => { pop(); push(libraryPage(tids)); } }, "Nochmal"))));
      },
    };
  }

  // ---------------------------------------------------------------- page: Grid settings
  const APP_LANGS = [["", "Automatisch"], ["de", "Deutsch"], ["en", "English"], ["ar", "العربية"], ["tr", "Türkçe"], ["uk", "Українська"], ["fr", "Français"], ["it", "Italiano"], ["es", "Español"]];
  function gridSettingsPage(tids) {
    const ui = {};
    return {
      title: "Einstellungen",
      build(body) {
        ui.tiles = h("div", { class: "tgrid" });
        ui.lang = h("select", { "aria-label": "Sprache von AsTeRICS und vom Grid" }, ...APP_LANGS.map(([v, l]) => h("option", { value: v }, l)));
        ui.lang.addEventListener("change", () => agent(tids, "app", { lang: ui.lang.value }, { label: "Sprache von App und Grid gesetzt", reprobe: 6000 }));
        ui.code = h("input", { type: "text", inputmode: "numeric", placeholder: "leer = kein Code", spellcheck: "false" });
        add(body,
          ui.tiles,
          h("div", { class: "group", style: "margin-top:10px" },
            h("label", { class: "row" }, h("span", { class: "lbl" }, "Sprache"), h("span", { class: "grow muted" }, "App und Grid"), ui.lang),
            row(h("span", { class: "lbl" }, "Entsperr-Code"), h("div", { class: "inline" }, ui.code,
              h("button", { type: "button", class: "btn sm light", onclick: () => agent(tids, "app", { passcode: ui.code.value.trim() }, { label: ui.code.value.trim() ? "Code gesetzt" : "Code entfernt" }) }, "Setzen")))),
          h("div", { class: "group", style: "margin-top:10px" }, navRow("Bedienung mit Taster", "", () => push(inputPage(tids)), "ag:sort-amount-down")));
      },
      refresh() {
        const first = tids.map(pageOf).find((p) => p && p.app);
        const app = first ? first.app : null;
        const sync = !!(app && app.sync);
        const pages = tids.map(pageOf).filter(Boolean);
        const locked = pages.length && pages.every((p) => p.locked === true);
        const key = `${sync}|${locked}`;
        if (ui.key !== key && !isFocused(ui.tiles)) {
          ui.key = key;
          fill(ui.tiles,
            toggle("Gesperrt", "ag:lock", locked, (on) => {
              if (on) {
                if (confirm("Grid sperren? Bearbeiten geht dann erst nach dem Entsperren.")) agent(tids, "flags", { locked: true }, { label: "Gesperrt", reprobe: 6000 });
                else ui.key = "";
              } else agent(tids, "unlock", null, { label: "Entsperrt", reprobe: 6000 });
              scheduleRender();
            }),
            toggle("Navigation mitschauen", "eye", sync, (on) => agent(tids, "app", { sync: on }, { label: on ? "Navigation wird geteilt" : "Navigation nicht geteilt" })));
        }
        if (app && document.activeElement !== ui.lang) ui.lang.value = APP_LANGS.some(([v]) => v === app.lang) ? app.lang : "";
        if (app && document.activeElement !== ui.code) ui.code.placeholder = app.passcode ? "Code ist gesetzt" : "leer = kein Code";
      },
    };
  }

  // ---------------------------------------------------------------- page: screenshot
  function screenshotPage(tid) {
    const ui = {};
    return {
      title: "Bildschirmfoto",
      build(body) {
        ui.box = h("div", {});
        ui.foot = h("div", { class: "foot" });
        add(body, ui.box,
          h("div", { class: "row", style: "background:none;padding:14px 0 0" },
            h("button", { type: "button", class: "btn", onclick: () => requestShot(tid) }, icon("camera"), "Neu aufnehmen")),
          ui.foot,
          h("div", { class: "foot" }, "Zeigt, was FreeKiosk gerade anzeigt. Das Bild wird danach vom MQTT-Server gelöscht."));
        const t = tablets.get(tid);
        if (!t || !t.shot || Date.now() - t.shot.at > 5000) requestShot(tid);
      },
      refresh() {
        const t = tablets.get(tid) || {};
        const enabled = g(t, "state.images.screenshotEnabled");
        const waiting = t.shotWait && Date.now() - t.shotWait < 15000;
        const late = t.shotWait && !waiting;
        const key = JSON.stringify([t.shot && t.shot.at, !!waiting, !!late, enabled]);
        if (same(ui.box, key)) return;
        fill(ui.box,
          t.shot ? h("img", { src: t.shot.url, alt: "Bildschirm von " + displayName(tid), class: "shot" }) : null,
          waiting ? h("div", { class: "empty", style: "padding:20px 0" }, h("span", { class: "spin", style: "display:inline-block" })) : null);
        ui.foot.className = "foot" + (late || enabled === false ? " warn-t" : "");
        ui.foot.textContent = enabled !== true && (late || !t.shot)
          ? "Bildschirmfotos sind auf diesem Tablet aus. Mit einem neuen QR-Code einrichten oder in FreeKiosk unter MQTT einschalten."
          : late ? "Kein Bild gekommen. Ist der Bildschirm aus? Erst wecken."
          : t.shot ? `Aufgenommen ${ago(t.shot.at)} · ${t.shot.kb} KB` : "";
      },
    };
  }

  // ---------------------------------------------------------------- page: photo and name
  function profilePage(tid) {
    const ui = {};
    return {
      title: "Foto und Name",
      build(body) {
        const draw = () => {
          const p = prof(tid);
          fill(ui.preview, avatarEl(tid, "lg"));
          fill(ui.buttons,
            h("button", { type: "button", class: "btn sm", onclick: () => ui.file.click() }, icon("camera"), p.img ? "Anderes Foto" : "Foto wählen"),
            p.img ? h("button", { type: "button", class: "btn sm ghost", onclick: () => { saveProf(tid, { img: null }); draw(); } }, "Foto entfernen") : null);
          fill(ui.colors, ...AVATAR_COLORS.map((c) => h("button", { type: "button", style: `background:${c}`, "aria-label": "Farbe " + c,
            "aria-pressed": String(!p.img && colorOf(tid) === c), onclick: () => { saveProf(tid, { color: c, img: null }); draw(); } })));
        };
        ui.preview = h("div", {});
        ui.buttons = h("div", { class: "inline", style: "justify-content:center;flex:none" });
        ui.colors = h("div", { class: "colors" });
        ui.file = h("input", { type: "file", accept: "image/*", hidden: true });
        ui.file.addEventListener("change", async () => {
          const f = ui.file.files[0];
          ui.file.value = "";
          if (!f) return;
          try { if (saveProf(tid, { img: await squareJpeg(f, 160) })) draw(); }
          catch (e) { hud("Bild lässt sich nicht öffnen", "bad"); }
        });
        const name = h("input", { type: "text", value: prof(tid).name || "", placeholder: tid, maxlength: "40", spellcheck: "false", autocomplete: "off" });
        name.addEventListener("input", () => { saveProf(tid, { name: name.value.trim() }); fill(ui.preview, avatarEl(tid, "lg")); });
        add(body,
          h("div", { class: "avatar-pick" }, ui.preview, ui.buttons, ui.file),
          h("div", { class: "group" }, h("label", { class: "row" }, h("span", { class: "lbl" }, "Name"), name)),
          groupH("Oder eine Farbe"),
          h("div", { class: "group", style: "padding:14px" }, ui.colors),
          h("div", { class: "foot" }, "Bleibt nur in diesem Browser. Fotos gehen nicht an die Tablets und nicht an den MQTT-Server."));
        draw();
      },
    };
  }

  // ---------------------------------------------------------------- page: input (scanning)
  function inputPage(tids) {
    const ui = {};
    const set = (args, label) => agent(tids, "input", args, { sending: "Stellt ein …", label });
    return {
      title: "Bedienung",
      build(body) {
        ui.tiles = h("div", { class: "tgrid" });
        ui.state = h("div", {});
        add(body,
          ui.state,
          ui.tiles,
          h("div", { class: "group", style: "margin-top:10px" },
            row(h("span", { class: "grow" }, h("span", { class: "row-title" }, "Tasten zurücksetzen"), h("small", { class: "row-sub" }, "Leertaste: kurz = weiter, lang = auswählen")),
              h("button", { type: "button", class: "btn sm light", onclick: () => set({ resetKeys: true }, "Tasten zurückgesetzt") }, "Zurücksetzen"))),
          h("div", { class: "foot" }, "Stellt AsTeRICS Grid so ein wie unter Einstellungen › Eingabe › Scanning. Weiter geht es immer mit dem Taster. Der inDiKo-Taster sendet die Leertaste."));
      },
      refresh() {
        const pages = tids.map(pageOf).filter(Boolean);
        const inputs = pages.map((p) => p.input).filter(Boolean);
        const scan = inputs.length > 0 && inputs.every((i) => i.scan);
        const key = JSON.stringify([scan, inputs.length, pages.length]);
        if (isFocused(ui.tiles) || same(ui.tiles, key)) return;
        fill(ui.state, !pages.length || inputs.length ? null
          : h("div", { class: "group", style: "margin-bottom:10px" }, row(h("span", { class: "grow muted" }, "Gerade ist kein Grid offen. Beim Umstellen wird das Haupt-Grid geöffnet."))));
        fill(ui.tiles,
          toggle("Scanning", "ag:sort-amount-down", scan, (on) => set(on ? { scan: true, scanAuto: false } : { scan: false }, on ? "Scanning an" : "Scanning aus")));
      },
    };
  }

  // ---------------------------------------------------------------- page: voices
  // FreeKiosk speaks itself: built-in offline voices (sherpa-onnx models it downloads and
  // unpacks) and every Android engine (Samsung, Google) by name, all side by side. AsTeRICS
  // sees them in FreeKiosk's browser. Nothing to switch in Android, no restart.
  const SHERPA_PKG = "com.k2fsa.sherpa.onnx.tts.engine";
  const OLD_TTS_APPS = [SHERPA_PKG, "com.CodeBySonu.VoxSherpa"];
  const MODELS_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/";
  const MODELS_API = "https://api.github.com/repos/k2-fsa/sherpa-onnx/releases";
  // Known models, used when the list cannot be loaded (sizes come with the live list)
  const MODELS_FALLBACK = [
    "vits-piper-de_DE-thorsten-medium", "vits-piper-de_DE-thorsten-high", "vits-piper-de_DE-thorsten_emotional-medium",
    "vits-piper-de_DE-kerstin-low", "vits-piper-de_DE-ramona-low", "vits-piper-de_DE-eva_k-x_low", "vits-piper-de_DE-karlsson-low",
    "vits-piper-de_DE-pavoque-low", "vits-piper-de_DE-dii-high", "vits-piper-de_DE-miro-high", "vits-coqui-de-css10",
    "vits-piper-en_US-amy-medium", "vits-piper-en_US-lessac-medium", "vits-piper-en_GB-alba-medium", "vits-piper-en_US-ryan-medium",
    "vits-piper-ar_JO-kareem-medium", "vits-piper-ar_JO-kareem-low", "vits-piper-ar_JO-SA_dii-high"];
  const ISO3 = { deu: "de", eng: "en", ara: "ar", tur: "tr", ukr: "uk", fas: "fa", rus: "ru", pol: "pl", bos: "bs", hrv: "hr", srp: "sr",
    fra: "fr", ita: "it", spa: "es", por: "pt", nld: "nl", ces: "cs", slk: "sk", hun: "hu", ron: "ro", ell: "el", bul: "bg", slv: "sl", kmr: "ku" };
  const QUALITY = { x_low: "einfach", low: "einfach", medium: "gut", high: "sehr gut" };
  const SAMPLES = { de: "Hallo, so klinge ich.", en: "Hello, this is how I sound.", ar: "مرحبا، هكذا يبدو صوتي.", tr: "Merhaba, sesim böyle.",
    uk: "Привіт, так звучить мій голос.", ru: "Привет, так звучит мой голос.", fa: "سلام، صدای من این‌طور است.", pl: "Cześć, tak brzmi mój głos.",
    fr: "Bonjour, voici ma voix.", es: "Hola, así suena mi voz.", it: "Ciao, questa è la mia voce.", bs: "Zdravo, ovako zvučim.", hr: "Bok, ovako zvučim.", sr: "Zdravo, ovako zvučim." };
  const LANG_FIRST = ["de", "en", "ar", "tr", "uk", "fa", "ru", "pl", "bs", "hr", "sr"];
  const baseLang = (l) => { const b = String(l || "").toLowerCase().replace("_", "-").split("-")[0]; return ISO3[b] || b; };
  const words = (s) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const mb = (n) => (n ? Math.round(n / 1048576) + " MB" : "");
  function modelInfo(id, size, url) {
    const u = url || MODELS_URL + id + ".tar.bz2";
    let m = id.match(/^vits-(?:piper|mimic3)-([a-z]{2,3})_([A-Z]{2})-(.+?)(?:-(x_low|low|medium|high))?(?:-(int8|fp16))?$/);
    if (m) return { id, size, url: u, lang: `${m[1]}-${m[2]}`, base: baseLang(m[1]), name: words(m[3]), quality: QUALITY[m[4]] || "", kind: `${m[1]}-${m[2]}`, small: !!m[5] };
    m = id.match(/^vits-coqui-([a-z]{2})-(.+)$/);
    if (m) return { id, size, url: u, lang: m[1], base: m[1], name: "Coqui " + m[2].toUpperCase(), quality: "", kind: "" };
    m = id.match(/^vits-mms-([a-z]{3})$/);
    if (m) return { id, size, url: u, lang: ISO3[m[1]] || m[1], base: baseLang(m[1]), name: "MMS", quality: "einfach", kind: "" };
    return null;
  }
  let models = null;
  async function loadModels() {
    if (models) return models;
    try {
      const c = JSON.parse(localStorage.getItem("fkkit.models") || "null");
      if (c && Date.now() - c.at < 86400000 && c.list && c.list.length) return (models = { list: c.list, live: true });
    } catch (e) { /* no cache */ }
    try {
      const r = await fetch(MODELS_API + "/tags/tts-models", { headers: { Accept: "application/vnd.github+json" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const rel = await r.json();
      const assets = new Map();
      (rel.assets || []).forEach((a) => assets.set(a.name, a));
      // Long releases come page by page
      for (let page = 1; rel.id && page <= 20; page++) {
        const r2 = await fetch(`${MODELS_API}/${rel.id}/assets?per_page=100&page=${page}`, { headers: { Accept: "application/vnd.github+json" } });
        if (!r2.ok) break;
        const more = await r2.json();
        more.forEach((a) => assets.set(a.name, a));
        if (more.length < 100) break;
      }
      const list = [...assets.values()].filter((a) => /\.tar\.bz2$/.test(a.name))
        .map((a) => modelInfo(a.name.replace(/\.tar\.bz2$/, ""), a.size, a.browser_download_url)).filter(Boolean);
      if (!list.length) throw new Error("leer");
      models = { list, live: true };
      try { localStorage.setItem("fkkit.models", JSON.stringify({ at: Date.now(), list })); } catch (e) { /* full */ }
    } catch (e) {
      models = { list: MODELS_FALLBACK.map((id) => modelInfo(id, 0)).filter(Boolean), live: false, error: e.message };
    }
    return models;
  }
  const speechOf = (tid) => g(tablets.get(tid) || {}, "state.speech");
  function engineLabel(sp, engine) {
    if (engine === "embedded") return "Eingebaut";
    const e = ((sp && sp.engines) || []).find((x) => x.package === engine);
    return (e && e.label) || ({ "com.samsung.SMT": "Samsung", "com.google.android.tts": "Google" })[engine] || engine;
  }
  // The language the grid speaks, else the tablet's
  function gridLang(tid) {
    const p = pageOf(tid) || {};
    return baseLang(p.contentLang || (p.app && p.app.lang) || p.browserLang || "de") || "de";
  }

  function voicesPage(tids) {
    const ui = { lang: tids.length ? gridLang(tids[0]) : "de" };
    const where = () => (tids.length > 1 ? `${tids.length} Tablets` : displayName(tids[0]));
    const ready = () => tids.filter((tid) => speechOf(tid));
    const needNew = () => { hud("Braucht die neue FreeKiosk-Version (qr9)", "bad"); return false; };
    const install = (m) => {
      const r = ready();
      if (!r.length) return needNew();
      if (!confirm(`„${m.name}“ (${langLabel(m.base)}${m.size ? ", " + mb(m.size) : ""}) auf ${where()} laden?\nDas Tablet lädt die Stimme selbst und entpackt sie, am besten im WLAN. Danach geht sie ohne Internet.`)) return false;
      return sendSigned(r, "voice_install", m.id, m.url, { id: m.id, url: m.url, name: m.name, lang: m.lang }, "Lädt Stimme …");
    };
    const removeVoice = (id, name) => { if (confirm(`„${name}“ von ${where()} entfernen?`)) sendSigned(ready(), "voice_remove", id, "", { id }, "Wird entfernt …"); };
    const prefer = (value, label) => (ready().length ? sendAll(ready(), "voice_prefer", value, `Standard: ${label}`) : needNew());
    const probe = (uri, lang, label) => (ready().length
      ? sendAll(ready(), "tts", JSON.stringify({ text: SAMPLES[baseLang(lang)] || SAMPLES.de, voice: uri, lang }), label ? `Probe: ${label}` : "Spricht")
      : needNew());
    const drawCatalog = () => {
      if (!models) return;
      const list = models.list.filter((m) => m.base === ui.lang);
      // "gut" (Piper medium) first: on a tablet it answers faster than "sehr gut" and sounds nearly the same
      const rankQ = { gut: 0, "sehr gut": 1, einfach: 2, "": 3 };
      list.sort((a, b) => (/glados|turret/i.test(a.id) - /glados|turret/i.test(b.id)) || (a.small - b.small) || (rankQ[a.quality] - rankQ[b.quality]) || a.name.localeCompare(b.name, "de"));
      const installed = new Map();
      tids.forEach((tid) => ((g(speechOf(tid) || {}, "embedded.voices")) || []).forEach((v) => installed.set(v.id, (installed.get(v.id) || 0) + 1)));
      const key = JSON.stringify([ui.lang, list.length, [...installed]]);
      if (same(ui.cat, key)) return;
      const regions = new Set(list.map((m) => m.kind).filter(Boolean)).size > 1; // en-US and en-GB side by side
      fill(ui.cat, list.length ? h("div", { class: "group" }, ...list.map((m) => {
        const here = installed.get(m.id) || 0;
        return row(
          h("span", { class: "grow" }, h("span", { class: "row-title" }, m.name, regions && m.kind ? h("span", { class: "muted" }, " · " + m.kind) : null),
            h("small", { class: "row-sub" }, [m.quality === "gut" ? "gut, empfohlen" : m.quality, m.small ? "klein" : "", mb(m.size)].filter(Boolean).join(" · ") || " ")),
          here ? h("span", { class: "badge ok" }, tids.length > 1 ? `auf ${here}` : "geladen") : null,
          h("button", { type: "button", class: "btn sm light", onclick: () => install(m) }, icon("download"), here ? "Neu laden" : "Laden"));
      })) : h("div", { class: "group" }, row(h("span", { class: "grow muted" }, models.live
        ? "Für diese Sprache gibt es keine eingebaute Stimme. Samsung oder Google haben vielleicht eine (unten)."
        : "Diese Sprache steht in der kurzen Liste nicht. Mit Internet am Laptop zeigt die Liste alle Stimmen."))));
      ui.catFoot.textContent = models.live ? "Stimmen von sherpa-onnx (Piper, Coqui), freie Lizenzen." : "Liste nicht erreichbar, bekannte Stimmen von sherpa-onnx.";
    };
    const fillLangs = () => {
      const have = new Set(LANG_FIRST.slice(0, 5));
      (models ? models.list : []).forEach((m) => have.add(m.base));
      tids.forEach((tid) => ((speechOf(tid) || {}).voices || []).forEach((v) => have.add(baseLang(v.lang))));
      have.add(ui.lang);
      const list = [...have].filter((l) => l && l !== "und");
      list.sort((a, b) => ((LANG_FIRST.indexOf(a) + 1 || 99) - (LANG_FIRST.indexOf(b) + 1 || 99)) || langLabel(a).localeCompare(langLabel(b), "de"));
      if (same(ui.langSel, JSON.stringify(list))) return;
      fill(ui.langSel, ...list.map((l) => h("option", { value: l }, langLabel(l))));
      ui.langSel.value = ui.lang;
    };
    return {
      title: "Stimmen",
      build(body) {
        ui.check = h("div", {});
        ui.prefer = h("div", {});
        ui.voices = h("div", {});
        ui.cat = h("div", {}, h("div", { class: "empty", style: "padding:24px 0" }, h("span", { class: "spin", style: "display:inline-block" })));
        ui.catFoot = h("div", { class: "foot" });
        ui.more = h("div", {});
        ui.langSel = h("select", { class: "lang-sel", "aria-label": "Sprache" });
        ui.langSel.addEventListener("change", () => { ui.lang = ui.langSel.value; ui.redraw(); });
        ui.redraw = () => { this.refresh(true); drawCatalog(); };
        add(body, ui.check, ui.prefer, ui.voices, groupH("Eingebaute Stimme laden"), ui.cat, ui.catFoot, ui.more);
        loadModels().then(() => { fillLangs(); drawCatalog(); });
      },
      refresh(force) {
        if (tids.length === 1) voiceCheck(ui.check, tids[0], ui.lang);
        fillLangs();
        if (models) drawCatalog();
        const sps = tids.map(speechOf);
        const known = sps.filter(Boolean);
        const key = JSON.stringify([ui.lang, known.map((s) => [s.preferred, s.bridge, s.voices, s.engines, s.embedded, s.last]),
          tids.map((tid) => (g(tablets.get(tid) || {}, "state.tts.engines") || []).filter((e) => OLD_TTS_APPS.includes(e.package)).map((e) => e.package))]);
        if (!force && same(ui.voices, key)) return;
        if (force) same(ui.voices, key);
        if (!known.length) {
          fill(ui.prefer);
          fill(ui.voices, h("div", { class: "notice" }, icon("speak"), h("span", { class: "grow" }, h("b", {}, "Braucht die neue FreeKiosk-Version (qr9)"),
            h("small", {}, "Mit ihr spricht FreeKiosk selbst, mit eingebauten Stimmen und denen von Samsung und Google."))));
          fill(ui.more);
          return;
        }
        // Standard output: what speaks when a page asks for no particular voice
        const options = new Map([["embedded", "Eingebaut (offline)"]]);
        known.forEach((s) => (s.engines || []).filter((e) => e.ready).forEach((e) => options.set(e.package, e.label || e.package)));
        const prefs = new Set(known.map((s) => s.preferred || "embedded"));
        const pref = prefs.size === 1 ? [...prefs][0] : null;
        fill(ui.prefer,
          groupH("Standard-Stimme"),
          h("div", { class: "group" }, ...[...options].map(([value, label]) => h("button", { type: "button", class: "row nav", onclick: () => prefer(value, label) },
            h("span", { class: "nav-ic" }, icon(value === "embedded" ? "box" : "speak")),
            h("span", { class: "grow" }, h("span", { class: "row-title" }, label),
              h("small", { class: "row-sub" }, value === "embedded" ? "Offline-Stimmen von FreeKiosk, sonst Android" : "Sprachausgabe von Android")),
            pref === value ? icon("check", "chk") : null))),
          h("div", { class: "foot" }, "Gilt, wenn in AsTeRICS „Standard“ als Stimme gewählt ist. Jede Stimme lässt sich dort auch direkt wählen."));

        // Voices of the chosen language
        const voices = new Map();
        known.forEach((s) => (s.voices || []).filter((v) => baseLang(v.lang) === ui.lang).forEach((v) => {
          const e = voices.get(v.uri) || Object.assign({ count: 0 }, v);
          e.count++;
          voices.set(v.uri, e);
        }));
        const emb = new Map();
        known.forEach((s) => ((s.embedded || {}).voices || []).forEach((v) => emb.set(v.id, v)));
        const vrow = (v) => {
          const isEmb = v.engine === "embedded";
          const id = isEmb ? v.uri.replace(/^fk:emb:/, "") : "";
          const info = isEmb ? emb.get(id) : null;
          const label = engineLabel(known[0], v.engine);
          // "Samsung · Deutsch (Deutschland)": the engine goes into the second line
          const title = isEmb ? v.name.replace(/ · eingebaut$/, "") : v.name.startsWith(label + " · ") ? v.name.slice(label.length + 3) : v.name;
          return row(
            h("span", { class: "nav-ic" }, icon(isEmb ? "box" : "speak")),
            h("span", { class: "grow" }, h("span", { class: "row-title" }, title),
              h("small", { class: "row-sub" }, [isEmb ? "Eingebaut" : label, isEmb ? v.lang : "", info && info.size ? mb(info.size) : "",
                tids.length > 1 ? `auf ${v.count} von ${tids.length}` : ""].filter(Boolean).join(" · "))),
            h("button", { type: "button", class: "btn sm light", onclick: () => probe(v.uri, v.lang, v.name) }, icon("play"), "Probe"),
            isEmb ? h("button", { type: "button", class: "btn sm ghost", title: "Entfernen", "aria-label": `${v.name} entfernen`, onclick: () => removeVoice(id, v.name) }, icon("trash")) : null);
        };
        const list = [...voices.values()].sort((a, b) => ((b.engine === "embedded") - (a.engine === "embedded")) || a.name.localeCompare(b.name, "de"));
        const ems = known.map((s) => s.embedded || {});
        const busy = ems.find((e) => e.installing);
        const err = ems.map((e) => e.lastError).find(Boolean);
        const last = known.length === 1 && known[0].last && !known[0].last.ok ? known[0].last : null;
        const unavailable = ems.find((e) => e.available === false);
        fill(ui.voices,
          groupH("Stimmen am Tablet", ui.langSel),
          h("div", { class: "group" }, ...(list.length ? list.map(vrow)
            : [row(h("span", { class: "grow muted" }, `Keine Stimme für ${langLabel(ui.lang)}. Unten eine eingebaute laden.`))])),
          busy ? h("div", { class: "foot" }, h("span", { class: "spin", style: "display:inline-block;vertical-align:-3px;margin-right:6px" }),
            busy.phase === "unpack" ? "Wird entpackt" : "Lädt herunter",
            busy.total ? ` … ${Math.min(100, Math.round(100 * busy.done / busy.total))} %` : " …", tids.length > 1 ? "" : ` (${busy.installing})`) : null,
          !busy && err ? h("div", { class: "foot err" }, err) : null,
          !busy && !err && ems.length === 1 && ems[0].lastAction ? h("div", { class: "foot" }, ems[0].lastAction) : null,
          last ? h("div", { class: "foot warn-t" }, `Letzte Probe: ${last.voice || "keine Stimme"} – ${last.message}`) : null,
          unavailable ? h("div", { class: "foot warn-t" }, unavailable.error || "Eingebaute Stimmen gehen auf diesem Tablet nicht.") : null,
          known.some((s) => s.bridge === false) ? h("div", { class: "notice" }, icon("speak"),
            h("span", { class: "grow" }, h("b", {}, "Sprachbrücke ist aus"), h("small", {}, "AsTeRICS hört dann nur die Standard-Stimme von Android.")),
            h("button", { type: "button", class: "btn sm", onclick: () => sendAll(ready(), "speech_bridge", "ON", "Sprachbrücke an") }, "Einschalten")) : null);

        // Samsung/Google languages, and old voice apps that are no longer needed
        const oldApps = new Map();
        tids.forEach((tid) => (g(tablets.get(tid) || {}, "state.tts.engines") || []).filter((e) => OLD_TTS_APPS.includes(e.package)).forEach((e) => oldApps.set(e.package, e)));
        fill(ui.more,
          groupH("Samsung und Google"),
          h("div", { class: "group" },
            row(h("span", { class: "nav-ic" }, icon("download")),
              h("span", { class: "grow" }, h("span", { class: "row-title" }, "Weitere Sprachen dazu"), h("small", { class: "row-sub" }, "Öffnet am Tablet die Download-Seite von Samsung oder Google")),
              h("button", { type: "button", class: "btn sm light", onclick: () => sendSigned(tids, "tts_voice_data", "", "", { package: "" }, "Wird am Tablet geöffnet") }, "Am Tablet öffnen")),
            ...[...oldApps.values()].map((e) => row(h("span", { class: "nav-ic" }, icon("trash")),
              h("span", { class: "grow" }, h("span", { class: "row-title" }, e.package === SHERPA_PKG ? "sherpa-App" : e.label || e.package),
                h("small", { class: "row-sub" }, "Einzelne Stimmen-App, nicht mehr nötig")),
              h("button", { type: "button", class: "btn sm ghost", onclick: () => { if (confirm(`Die App von ${where()} entfernen?`)) sendSigned(tids, "tts_uninstall", e.package, "", { package: e.package }, "Wird entfernt …"); } }, "Entfernen")))),
          h("div", { class: "foot" }, "Dort geladene Sprachen erscheinen hier und in AsTeRICS von selbst."));
      },
    };
  }
  // From "a voice on the tablet" to "AsTeRICS speaks with it", one step at a time
  function voiceCheck(box, tid, lang) {
    const sp = speechOf(tid);
    if (!sp) { fill(box); return; }
    const page = pageOf(tid);
    const mine = (sp.voices || []).filter((v) => baseLang(v.lang) === lang);
    const said = page && page.result && page.result.action === "speak" ? page.result : null;
    const seen = page && page.voices ? page.voices.filter((v) => /^fk:/.test(v.uri || "")).length : null;
    const last = sp.last;
    const key = JSON.stringify([lang, mine.map((v) => v.uri), last, said && [said.msg, said.ok], seen]);
    if (same(box, key)) return;
    const step = (state, n, title, detail, action) => row(
      h("span", { class: "ck " + state }, state === "ok" ? icon("check") : String(n)),
      h("span", { class: "grow" }, h("span", { class: "row-title" }, title), detail ? h("small", { class: "row-sub" }, detail) : null),
      action || null);
    const btn = (label, fn) => h("button", { type: "button", class: "btn sm light", onclick: fn }, label);
    const fresh = last && Date.now() - last.at < 120000;
    fill(box,
      groupH("Stimmen-Check"),
      h("div", { class: "group" },
        step(mine.length ? "ok" : "todo", 1, `Stimme für ${langLabel(lang)}`,
          mine.length ? mine.slice(0, 3).map((v) => v.name).join(", ") + (mine.length > 3 ? ` und ${mine.length - 3} weitere` : "") : "Unten eine eingebaute Stimme laden"),
        step(fresh ? (last.ok ? "ok" : "warn") : "todo", 2, "Probe über FreeKiosk",
          fresh ? (last.ok ? `Gesprochen mit ${last.voice}` : `${last.voice || "Keine Stimme"}: ${last.message}`) : "Spricht mit der Standard-Stimme, zu hören am Tablet",
          btn("Abspielen", () => sendAll([tid], "tts", JSON.stringify({ text: SAMPLES[lang] || SAMPLES.de, lang }), "Spricht"))),
        step(said ? (said.ok ? "ok" : "warn") : "todo", 3, "Probe in AsTeRICS",
          said ? said.msg : seen != null ? `AsTeRICS sieht ${seen} ${seen === 1 ? "Stimme" : "Stimmen"} von FreeKiosk` : "AsTeRICS Grid muss offen sein",
          btn("Abspielen", () => agent([tid], "speak", { text: SAMPLES[lang] || SAMPLES.de, plain: true }, { sending: "Spricht …", label: "Gesprochen", reprobe: 0 }))),
        h("button", { type: "button", class: "row nav", onclick: () => push(voicePage([tid])) },
          h("span", { class: "ck info" }, "4"),
          h("span", { class: "grow" }, h("span", { class: "row-title" }, "In AsTeRICS als Stimme wählen"), h("small", { class: "row-sub" }, "Grid › Stimme")))),
      h("div", { class: "foot" }, "FreeKiosk spricht selbst. AsTeRICS sieht alle Stimmen nebeneinander, ohne Umstellen in Android und ohne Neustart."));
  }

  // ---------------------------------------------------------------- page: Wi-Fi networks
  // Spare networks: Android joins another saved network by itself when one is gone.
  // The password travels encrypted with the kit key; the command is signed with it.
  const WIFI_TYPES = [["WPA", "WPA2 / WPA3"], ["SAE", "nur WPA3"], ["OPEN", "Offen"]];
  function wifiPage(tids) {
    const ui = {};
    const states = () => tids.map((tid) => g(tablets.get(tid) || {}, "state.wifiNetworks"));
    const where = () => (tids.length > 1 ? `${tids.length} Tablets` : displayName(tids[0]));
    const save = async () => {
      const ssid = ui.ssid.value.trim(), pass = ui.pass.value, type = ui.type.value;
      if (!ssid) { ui.ssid.focus(); return; }
      if (type !== "OPEN" && pass.length < 8) { hud("Passwort braucht mindestens 8 Zeichen", "bad"); ui.pass.focus(); return; }
      const ready = tids.filter((tid, i) => states()[i]);
      if (!ready.length) { hud("Braucht die neue FreeKiosk-Version", "bad"); return; }
      let enc = "";
      try { if (type !== "OPEN") enc = await encryptFor("wifi", pass); }
      catch (e) { hud(e.message, "bad"); return; }
      const hidden = ui.hidden.checked;
      if (await sendSigned(ready, "wifi_add", ssid, `${enc}|${type}|${hidden ? 1 : 0}`, { ssid, enc, type, hidden }, `„${ssid}“ wird gespeichert`)) {
        ui.ssid.value = ""; ui.pass.value = ""; ui.hidden.checked = false;
      }
    };
    const remove = (ssid) => {
      if (confirm(`„${ssid}“ von ${where()} entfernen?`)) sendSigned(tids, "wifi_remove", ssid, "", { ssid }, "Wird entfernt …");
    };
    return {
      title: "WLANs",
      build(body) {
        ui.list = h("div", {});
        ui.ssid = h("input", { type: "text", placeholder: "Netzwerkname", spellcheck: "false", autocomplete: "off", maxlength: "32" });
        ui.pass = h("input", { type: "password", placeholder: "mindestens 8 Zeichen", autocomplete: "new-password" });
        ui.type = h("select", { "aria-label": "Sicherheit" }, ...WIFI_TYPES.map(([v, l]) => h("option", { value: v }, l)));
        ui.type.addEventListener("change", () => { ui.pass.disabled = ui.type.value === "OPEN"; });
        ui.hidden = h("input", { type: "checkbox" });
        ui.pass.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
        add(body, ui.list,
          groupH("WLAN hinzufügen"),
          h("div", { class: "group" },
            h("label", { class: "row" }, h("span", { class: "lbl" }, "Name"), ui.ssid),
            h("label", { class: "row" }, h("span", { class: "lbl" }, "Passwort"), ui.pass),
            h("label", { class: "row" }, h("span", { class: "lbl" }, "Sicherheit"), ui.type),
            h("label", { class: "row" }, h("span", { class: "lbl" }, "Versteckt"), h("span", { class: "grow muted" }, "Name wird nicht angezeigt"), ui.hidden),
            row(h("button", { type: "button", class: "btn sm", onclick: save }, icon("plus"), "Speichern"))),
          h("div", { class: "foot" }, "Fällt ein WLAN aus, wechselt das Tablet von selbst in ein anderes gespeichertes. Das Passwort geht verschlüsselt mit dem Kit-Schlüssel über MQTT."));
      },
      refresh() {
        const st = states();
        const known = st.filter(Boolean);
        const curs = tids.map((tid) => g(tablets.get(tid) || {}, "state.wifi.ssid") || g(tablets.get(tid) || {}, "state.wifiNetworks.current"));
        const key = JSON.stringify([known, curs]);
        if (isFocused(ui.list) || same(ui.list, key)) return;
        if (!known.length) {
          fill(ui.list, h("div", { class: "group" }, row(h("span", { class: "grow muted" }, "Braucht die neue FreeKiosk-Version (qr4) auf dem Tablet."))));
          return;
        }
        const nets = new Map();
        st.forEach((w, i) => (w ? w.saved || [] : []).forEach((x) => {
          const e = nets.get(x.ssid) || { ssid: x.ssid, count: 0, current: 0, ours: false };
          e.count++;
          if (x.current || curs[i] === x.ssid) e.current++;
          e.ours = e.ours || x.ours;
          nets.set(x.ssid, e);
        }));
        const list = [...nets.values()].sort((a, b) => b.current - a.current || a.ssid.localeCompare(b.ssid, "de"));
        const err = known.map((w) => w.lastError).find(Boolean);
        const last = known.length === 1 ? known[0].lastAction : "";
        fill(ui.list,
          groupH("Gespeichert"),
          h("div", { class: "group" }, ...(list.length ? list.map((x) => row(
            h("span", { class: "nav-ic" }, icon("wifi")),
            h("span", { class: "grow" }, h("span", { class: "row-title" }, x.ssid),
              h("small", { class: "row-sub" }, [x.current ? (tids.length > 1 ? `verbunden auf ${x.current}` : "verbunden") : "", tids.length > 1 ? `auf ${x.count} von ${tids.length}` : ""].filter(Boolean).join(" · ") || "bereit")),
            x.current && tids.length === 1 ? h("span", { class: "badge ok" }, "aktiv")
              : h("button", { type: "button", class: "btn sm ghost", title: "Entfernen", "aria-label": `${x.ssid} entfernen`, onclick: () => remove(x.ssid) }, icon("trash"))))
            : [row(h("span", { class: "grow muted" }, "Keine WLANs bekannt"))])),
          err ? h("div", { class: "foot err" }, err) : last ? h("div", { class: "foot" }, last) : null,
          known.some((w) => !w.complete) ? h("div", { class: "foot" }, "Android zeigt hier nur das aktuelle WLAN und die vom Kit gespeicherten.") : null,
          known.some((w) => !w.signed) ? h("div", { class: "foot warn-t" }, "Ohne Kit-Schlüssel auf dem Tablet geht das nicht. Einmal mit einem neuen QR-Code einrichten.") : null);
      },
    };
  }

  // ---------------------------------------------------------------- settings sheet
  function mirror(srcId, type, placeholder) {
    const src = $(srcId);
    const el = h("input", { type, value: src.value, placeholder: placeholder || "", spellcheck: "false" });
    el.addEventListener("input", () => { src.value = el.value; src.dispatchEvent(new Event("input", { bubbles: true })); });
    return el;
  }
  function adminKeyRow() {
    const inp = h("input", { type: "text", value: Kit.adminKey(), spellcheck: "false", autocomplete: "off", class: "mono", style: "font-size:12px" });
    inp.addEventListener("change", () => {
      const v = inp.value.trim().toLowerCase();
      if (Kit.setAdminKey(v)) hud("Schlüssel übernommen");
      else { hud("Mindestens 32 Zeichen 0-9 und a-f", "bad"); inp.value = Kit.adminKey(); }
    });
    return row(h("span", { class: "lbl" }, "Kit-Schlüssel"), h("div", { class: "inline" }, inp,
      h("button", { type: "button", class: "btn sm light", onclick: () => { navigator.clipboard && navigator.clipboard.writeText(Kit.adminKey()).then(() => hud("Kopiert"), () => {}); } }, "Kopieren")));
  }
  function openSettings() {
    openSheet({
      title: "Verbindung",
      build(body) {
        const ws = h("input", { type: "text", value: cfg.ws, placeholder: wsDefault($("mq-broker").value) || "wss://…", spellcheck: "false" });
        ws.addEventListener("input", () => { cfg.ws = ws.value.trim(); lsSet(STORE, cfg); clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 900); });
        const tile = (label, ic, prop) => toggle(label, ic, cfg[prop], (on) => { cfg[prop] = on; lsSet(STORE, cfg); });
        add(body,
          groupH("Server"),
          h("div", { class: "group" },
            h("label", { class: "row" }, h("span", { class: "lbl" }, "MQTT-Server"), mirror("mq-broker", "text")),
            h("label", { class: "row" }, h("span", { class: "lbl" }, "WebSocket"), ws),
            h("label", { class: "row" }, h("span", { class: "lbl" }, "Kanal"), mirror("mq-topic", "text")),
            h("label", { class: "row" }, h("span", { class: "lbl" }, "Benutzer"), mirror("mq-user", "text", "optional")),
            h("label", { class: "row" }, h("span", { class: "lbl" }, "Passwort"), mirror("mq-pass", "password", "optional"))),
          h("div", { class: "foot" }, "Gilt auch für neue QR-Codes."),
          groupH("Schlüssel"),
          h("div", { class: "group" }, adminKeyRow()),
          h("div", { class: "foot" }, "Kommt mit dem QR-Code aufs Tablet und erlaubt das Laden von Stimmen. Ein zweiter Laptop braucht denselben Schlüssel."),
          groupH("Akku"),
          h("div", { class: "tgrid" }, tile("Hinweis unter 20 %", "bell", "batWarn"), tile("Hinweis vorlesen", "speak", "batTts")),
          h("div", { class: "foot" }, "Nur solange diese Seite offen ist."));
      },
      refresh() { fill($("sheet-sub"), ...connLine()); },
    });
  }
  $("t-settings").addEventListener("click", openSettings);

  // ---------------------------------------------------------------- start
  setInterval(() => { if (Kit.view === "tablets" || stack.length) scheduleRender(); }, 5000);
  Kit.onShow("tablets", scheduleRender);
  Kit.onShow("setup", () => { $("t-selbar").hidden = true; });
  Kit.onShow("grids", () => { $("t-selbar").hidden = true; });
  setTimeout(connect, 300);
  function publishRaw(topic, payload, retain) {
    if (!client || client.state !== "online") return false;
    client.publish(topic, payload, { retain: !!retain });
    return true;
  }
  window.KitTablets = {
    tablets, settings, wsDefault, gridAgent, agent, send, sendAll, publishRaw, agentReachable, listen,
    openSheet, push, pop, closeSheet, groupH, row, navRow, visibleEntries, statusOf, pageOf, avatarEl, displayName,
    get conn() { return conn; }, get online() { return !!client && client.state === "online"; },
  };
})();
