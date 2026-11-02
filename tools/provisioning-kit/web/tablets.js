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
    client.subscribe([`${s.base}/+/availability`, `${s.base}/+/state`, `${s.base}/+/page`]);
    client.connect();
  }
  let reconnectTimer = null;
  Kit.onChange(() => { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 900); });

  function tablet(tid) {
    let t = tablets.get(tid);
    if (!t) { t = { online: null, state: null, retained: false, seen: 0, page: null, pageAt: 0, bat: null, asked: false }; tablets.set(tid, t); }
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
    return true;
  }
  function sendAll(tids, cmd, payload, label) {
    if (!client || client.state !== "online") { hud("Keine Verbindung", "bad"); return false; }
    tids.forEach((tid) => send(tid, cmd, payload, true));
    hud(label || (tids.length > 1 ? `An ${tids.length} Tablets gesendet` : "Gesendet"));
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
        ts: Date.now(), hash: location.hash, host: location.host, path: location.pathname, title: document.title,
        api: !!S,
        user: (S && tryf(function () { return S.getAutologinUser() || S.getLastActiveUser(); }, "")) || lsGet("AUTOLOGIN_USER_KEY") || lsGet("LAST_ACTIVEUSER_KEY") || "",
        users: online.map(function (u) { return { name: u, online: true }; }).concat(local.map(function (u) { return { name: u, online: false }; })),
        appVersion: lsGet("AG_CURRENT_VERSION_KEY"),
        voice: { uri: vc.preferredVoice || "", rate: vc.voiceRate || 1, pitch: vc.voicePitch || 1 },
        locked: us && us.metadata && "locked" in us.metadata ? !!us.metadata.locked : null,
        template: (us && us.originGridsetFilename) || "",
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
      var synth = window.speechSynthesis;
      if (!synth) return finish(res(false, "Keine Sprachausgabe"));
      var vc = tryf(function () { return S.getUserSettings().voiceConfig; }, {});
      var u = new SpeechSynthesisUtterance(x.text || "Hallo");
      var match = (synth.getVoices() || []).filter(function (v) { return (v.voiceURI || v.name) === vc.preferredVoice; })[0];
      if (match) { u.lang = match.lang; try { u.voice = match; } catch (e) {} }
      u.rate = vc.voiceRate || 1;
      u.pitch = vc.voicePitch || 1;
      synth.speak(u);
      return finish(res(true));
    }
    if (a === "app") {
      var patch = {};
      if ("lang" in x) patch.appLang = x.lang || "";
      if ("sync" in x) patch.syncNavigation = !!x.sync;
      if ("passcode" in x) patch.unlockPasscode = x.passcode || null;
      S.saveAppSettings(patch);
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

  function render() {
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
      h("div", { class: "tcard-top" }, h("span", { class: "dot " + dot }), h("span", { class: "tcard-name" }, tid)),
      h("div", { class: "tcard-meta" },
        battery(s),
        Number.isFinite(sig) && g(s, "wifi.connected") !== false ? h("span", { title: g(s, "wifi.ssid") || "" }, icon("wifi"), `${sig} %`) : null,
        g(s, "screen.on") === false ? h("span", { title: "Bildschirm aus" }, icon("moon")) : null,
        btOn ? h("span", { title: "Bluetooth-Gerät verbunden" }, icon("bluetooth"), String(btOn)) : null),
      p && p.user ? h("div", { class: "tcard-meta" }, h("span", { title: "AsTeRICS-Benutzer" }, icon("user"), p.user), p.hash ? h("span", {}, icon("grid"), gridName(p.hash)) : null) : null,
      h("div", { class: "tcard-meta" }, st === "on" && t.seen ? `${label} · ${ago(t.seen)}` : st === "stale" ? `${label} · ${ago(t.seen || conn.since)}` : label));
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
    stack = [page];
    $("sheet").classList.add("open");
    $("sheet").setAttribute("aria-hidden", "false");
    $("scrim").classList.add("open");
    showPage();
  }
  function push(page) { stack.push(page); showPage(); }
  function pop() { if (stack.length > 1) { stack.pop(); showPage(); } }
  function closeSheet() {
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
      title: tid,
      build(body) {
        ui.stats = h("div", { class: "stats" });
        ui.bright = slider("sun", "Helligkeit", (v) => send(tid, "brightness", v));
        ui.vol = slider("volume", "Lautstärke", (v) => send(tid, "volume", v));
        ui.page = h("div", { class: "group" });
        ui.ag = h("div", {});
        ui.bt = h("div", {});
        ui.info = h("div", { class: "group" });
        ui.raw = h("pre", { class: "raw" });
        add(body,
          ui.stats,
          groupH("Steuern"),
          h("div", { class: "actions" },
            act("refresh", "Neu laden", () => send(tid, "reload")),
            act("eye", "Wecken", () => send(tid, "wake")),
            act("moon", "Bildschirm aus", () => send(tid, "screen", "OFF")),
            act("bell", "Piepen", () => send(tid, "audio_beep")),
            act("power", "Neustart", () => { if (confirm(`${tid} neu starten?`)) send(tid, "reboot"); }, "danger")),
          h("div", { class: "group", style: "margin-top:10px" }, ui.bright.el, ui.vol.el),
          groupH("Nachricht"),
          h("div", { class: "group" }, textSend("Text", [["Zeigen", (v) => send(tid, "toast", v)], ["Vorlesen", (v) => send(tid, "tts", v)]])),
          groupH("Seite"), ui.page,
          ui.ag,
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
          h("div", { class: "stat" }, h("small", {}, "WLAN"), h("strong", { title: g(s, "wifi.ssid") || "" }, sig != null ? `${sig} %` : "–")),
          h("div", { class: "stat" }, h("small", {}, "Bildschirm"), h("strong", {}, g(s, "screen.on") === true ? "an" : g(s, "screen.on") === false ? "aus" : "–")));
        ui.bright.set(g(s, "screen.brightness"));
        ui.vol.set(g(s, "audio.volume"));
        const host = hostOf(g(s, "webview.currentUrl"));
        if (!same(ui.page, host)) fill(ui.page, navRow("Start-Seite", host, () => push(urlPage(targets)), "globe"));
        renderAsterics(ui.ag, targets);
        renderBluetooth(ui.bt, tid, s.bluetooth);
        const info = [
          ["WLAN", g(s, "wifi.ssid")], ["IP", g(s, "device.ip") || g(s, "wifi.ipAddress")], ["FreeKiosk", g(s, "device.version")],
          ["Android", g(s, "device.androidVersion")], ["Modell", g(s, "device.model")],
          ["Geräteverwaltung", g(s, "device.isDeviceOwner") === true ? "ja" : g(s, "device.isDeviceOwner") === false ? "nein" : null],
          ["Kiosk", g(s, "device.kioskMode") === true ? "an" : g(s, "device.kioskMode") === false ? "aus" : null],
          ["Seite", g(s, "webview.currentUrl")], ["AsTeRICS", t.page && t.page.appVersion]];
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
      navRow("Benutzer", single ? single.user || "–" : "", () => push(usersPage(targets)), "user"),
      navRow("Grid", single ? gridName(single.hash) : "", () => push(gridPage(targets)), "grid"),
      navRow("Stimme", single ? (single.voice ? voiceLabel(v) : "–") : "", () => push(voicePage(targets)), "speak"),
      navRow("Vorlage laden", "", () => push(libraryPage(targets)), "download"),
      navRow("Einstellungen", "", () => push(gridSettingsPage(targets)), "sliders")),
      !single && targets.length === 1 ? h("div", { class: "foot" }, "Noch nicht abgefragt.") : null);
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
        add(body,
          h("div", { class: "chips" }, ...tids.map((t) => h("span", { class: "chip" }, t))),
          groupH("Steuern"),
          h("div", { class: "actions" },
            act("refresh", "Neu laden", () => sendAll(tids, "reload")),
            act("eye", "Wecken", () => sendAll(tids, "wake")),
            act("moon", "Bildschirm aus", () => sendAll(tids, "screen", "OFF")),
            act("bell", "Piepen", () => sendAll(tids, "audio_beep")),
            act("bluetooth", "Bluetooth aus", () => sendAll(tids, "bt_power", "OFF"))),
          groupH("Nachricht"),
          h("div", { class: "group" }, textSend("Text", [["Zeigen", (v) => sendAll(tids, "toast", v)], ["Vorlesen", (v) => sendAll(tids, "tts", v)]])),
          groupH("Seite"),
          h("div", { class: "group" }, navRow("Start-Seite", "", () => push(urlPage(tids)), "globe")),
          ui.ag);
      },
      refresh() { renderAsterics(ui.ag, tids); },
    });
  }

  // ---------------------------------------------------------------- page: start page
  function urlPage(tids) {
    const s0 = tids.length === 1 ? g(tablets.get(tids[0]) || {}, "state.webview.currentUrl") || "" : "";
    const presets = [
      { label: "AsTeRICS Grid", url: GRID_URL },
      { label: "AsTeRICS Grid Beta", url: GRID_URL + "latest/" },
    ];
    const fromSetup = ($("fk-url").value || "").trim();
    if (fromSetup && !presets.some((p) => p.url.replace(/\/$/, "") === fromSetup.replace(/\/$/, ""))) presets.push({ label: "Aus Einrichten", url: fromSetup });
    for (const u of lsGet(URLS_STORE) || []) if (!presets.some((p) => p.url === u)) presets.push({ label: hostOf(u), url: u });
    const choose = (url) => {
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;
      const recent = [url, ...(lsGet(URLS_STORE) || []).filter((u) => u !== url)].slice(0, 5);
      if (!/^https:\/\/grid\.asterics\.eu\/(latest\/)?$/.test(url)) lsSet(URLS_STORE, recent);
      if (sendAll(tids, "url", url, tids.length > 1 ? `${tids.length} Tablets öffnen ${hostOf(url)}` : `Öffne ${hostOf(url)}`)) pop();
    };
    const same = (a, b) => a.replace(/[?#].*$/, "").replace(/\/$/, "") === b.replace(/[?#].*$/, "").replace(/\/$/, "");
    return {
      title: "Start-Seite",
      build(body) {
        add(body,
          h("div", { class: "group" }, ...presets.map((p) =>
            h("button", { type: "button", class: "row nav", onclick: () => choose(p.url) },
              h("span", { class: "grow" }, h("span", { class: "row-title" }, p.label), h("small", { class: "row-sub" }, hostOf(p.url))),
              s0 && same(s0, p.url) ? icon("check", "chk") : null))),
          groupH("Andere Adresse"),
          h("div", { class: "group" }, textSend("https://…", [["Öffnen", (v) => choose(v), "primary"]], "url")),
          h("div", { class: "foot" }, "Wird die neue Start-Seite des Tablets."));
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
          h("span", { class: "nav-ic" }, icon("user")),
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
              h("span", { class: "nav-ic" }, icon("home")), h("span", { class: "grow" }, "Haupt-Grid öffnen"))),
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
          h("div", { class: "foot" }, "Offline-Stimmen kommen aus der Sprachausgabe von Android. Fehlt eine Sprache, am Tablet unter Einstellungen › Allgemeine Verwaltung › Text-zu-Sprache die Sprachdaten laden."));
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
        ui.lang = h("select", { "aria-label": "Sprache der Oberfläche" }, ...APP_LANGS.map(([v, l]) => h("option", { value: v }, l)));
        ui.lang.addEventListener("change", () => agent(tids, "app", { lang: ui.lang.value }, { label: "Sprache gesetzt", reprobe: 6000 }));
        ui.code = h("input", { type: "text", inputmode: "numeric", placeholder: "leer = kein Code", spellcheck: "false" });
        add(body,
          ui.tiles,
          h("div", { class: "group", style: "margin-top:10px" },
            h("label", { class: "row" }, h("span", { class: "lbl" }, "Sprache"), ui.lang),
            row(h("span", { class: "lbl" }, "Entsperr-Code"), h("div", { class: "inline" }, ui.code,
              h("button", { type: "button", class: "btn sm light", onclick: () => agent(tids, "app", { passcode: ui.code.value.trim() }, { label: ui.code.value.trim() ? "Code gesetzt" : "Code entfernt" }) }, "Setzen")))),
          groupH("Einschalten"),
          h("div", { class: "group" },
            h("button", { type: "button", class: "row nav", onclick: () => agent(tids, "flags", { scanning: true }, { label: "Scanning an", reprobe: 6000 }) },
              h("span", { class: "nav-ic" }, icon("scan")), h("span", { class: "grow" }, h("span", { class: "row-title" }, "Scanning"), h("small", { class: "row-sub" }, "Bedienung mit Taster")))),
          h("div", { class: "foot" }, "Scanning ausschalten und Feineinstellungen in AsTeRICS Grid unter Einstellungen. Mit Online-Konto auch am Laptop."));
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
            toggle("Gesperrt", "lock", locked, (on) => {
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

  // ---------------------------------------------------------------- settings sheet
  function mirror(srcId, type, placeholder) {
    const src = $(srcId);
    const el = h("input", { type, value: src.value, placeholder: placeholder || "", spellcheck: "false" });
    el.addEventListener("input", () => { src.value = el.value; src.dispatchEvent(new Event("input", { bubbles: true })); });
    return el;
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
  setTimeout(connect, 300);
  window.KitTablets = { tablets, settings, wsDefault, gridAgent, get conn() { return conn; } };
})();
