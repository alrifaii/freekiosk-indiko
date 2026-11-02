// inDiKo Kit: navigation, shared helpers and the "Einrichten" (QR) view.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const STORE = "fkkit.v3";
  const OLD_STORE = "fkkit.v2";

  // ---------------------------------------------------------------- helpers
  const ICONS = {
    refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
    power: "M12 3v8M6.3 6.6a8 8 0 1 0 11.4 0",
    sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
    volume: "M4 9v6h4l5 4V5L8 9H4zM16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11",
    bluetooth: "M7 7l10 10-5 4V3l5 4L7 17",
    wifi: "M2.5 8.8a14 14 0 0 1 19 0M5.5 12.2a9.5 9.5 0 0 1 13 0M8.7 15.5a5 5 0 0 1 6.6 0M12 19h.01",
    bell: "M18 16v-5a6 6 0 0 0-12 0v5l-2 2h16zM10 20.5a2 2 0 0 0 4 0",
    message: "M4 5h16v11H9l-5 4z",
    eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    moon: "M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z",
    check: "M5 12l5 5L20 7",
    x: "M6 6l12 12M18 6L6 18",
    search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
    trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
    plus: "M12 5v14M5 12h14",
    keyboard: "M3 7h18v10H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
    key: "M7.5 15.5a4 4 0 1 1 3.9-5H21v3h-2v3h-3v-3h-4.6a4 4 0 0 1-3.9 2z",
    grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    download: "M12 3v12M7 10l5 5 5-5M5 21h14",
    shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-4.5",
    tablet: "M6 2.5h12a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2zM11 18.5h2",
    plug: "M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5",
    home: "M4 11l8-7 8 7M6 9.5V20h12V9.5",
    speak: "M4 9v6h4l5 4V5L8 9H4zM17 8l4-2M17 12h4M17 16l4 2",
    chev: "M9 6l6 6-6 6",
    cloudOff: "M3 3l18 18M8.5 6.2A6 6 0 0 1 17.6 10 4.5 4.5 0 0 1 20 18M16 19H7a5 5 0 0 1-2.4-9.4",
  };
  function icon(name, cls) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "i" + (cls ? " " + cls : ""));
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", ICONS[name] || "");
    svg.appendChild(p);
    return svg;
  }
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "style") el.setAttribute("style", v);
      else if (k in el && typeof v !== "string") el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === "string" || typeof kid === "number" ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  }
  // replaceChildren() would print "null" for skipped optional parts
  function fill(el, ...kids) {
    el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  }
  let hudTimer = null;
  function hud(text, kind) {
    const el = $("hud");
    fill(el, icon(kind === "bad" ? "x" : "check"), text);
    el.classList.add("show");
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => el.classList.remove("show"), 1800);
  }
  function ago(ts) {
    if (!ts) return "nie";
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 10) return "gerade eben";
    if (s < 60) return `vor ${s} s`;
    if (s < 3600) return `vor ${Math.round(s / 60)} min`;
    if (s < 86400) return `vor ${Math.round(s / 3600)} h`;
    return new Date(ts).toLocaleDateString("de-AT");
  }
  function lsGet(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } }
  function lsSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }
  async function api(path, opts) {
    const o = Object.assign({ cache: "no-store" }, opts || {});
    if (o.json !== undefined) {
      o.method = o.method || "POST";
      o.headers = Object.assign({ "Content-Type": "application/json", "X-Kit": "1" }, o.headers || {});
      o.body = JSON.stringify(o.json);
      delete o.json;
    }
    const r = await fetch(path, o);
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { data = { error: text }; }
    if (!r.ok) throw new Error((data && data.error) || `Fehler ${r.status}`);
    return data;
  }

  // ---------------------------------------------------------------- navigation
  const views = ["setup", "tablets", "usb"];
  const listeners = {};
  function show(view) {
    if (!views.includes(view)) view = "setup";
    for (const v of views) $("v-" + v).hidden = v !== view;
    document.querySelectorAll(".bar .seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === view)));
    if (location.hash.slice(1) !== view) history.replaceState(null, "", view === "setup" ? location.pathname : "#" + view);
    current = view;
    (listeners[view] || []).forEach((fn) => fn());
  }
  let current = "setup";
  document.querySelectorAll(".bar .seg button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));

  // ---------------------------------------------------------------- setup state
  const persistIds = ["ssid", "sec-wpa", "sec-wep", "sec-none", "mq-name", "fk-url",
    "fk-filter", "fk-zoom", "fk-screen", "fk-statusbar", "fk-power", "fk-lockbt", "fk-corner", "fk-reset",
    "fk-mqtt", "mq-broker", "mq-port", "mq-topic", "mq-user",
    "src-laptop", "src-net", "ip", "net-url", "locale", "tz", "hidden-net", "keep-apps", "skip-edu", "cs-sig", "cs-pkg", "fk-extra"];
  const state = { info: null, sig: null, pkg: null, scheme: 0, apkName: "", apkSize: 0, loading: true };
  const changeHooks = [];

  function randomChannel() {
    const a = new Uint8Array(4);
    crypto.getRandomValues(a);
    return "indiko-" + Array.from(a, (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 6) + "/kiosk";
  }

  function load() {
    let saved = lsGet(STORE);
    if (!saved) {
      // Carry over the previous kit's values (different ids for a few fields).
      const old = lsGet(OLD_STORE);
      if (old) {
        saved = {};
        for (const k of ["ssid", "mq-name", "fk-url", "fk-screen", "fk-statusbar", "fk-corner", "fk-lockbt", "fk-reset", "fk-mqtt",
          "mq-broker", "mq-port", "mq-user", "mq-topic", "src-laptop", "src-net", "ip", "net-url", "locale", "tz", "hidden-net",
          "keep-apps", "skip-edu", "cs-sig", "cs-pkg", "fk-extra"]) if (k in old) saved[k] = old[k];
        if (old.sec) { saved["sec-wpa"] = old.sec === "WPA"; saved["sec-wep"] = old.sec === "WEP"; saved["sec-none"] = old.sec === "NONE"; }
        if (saved["mq-topic"] === "freekiosk") delete saved["mq-topic"];
      } else saved = {};
    }
    for (const id of persistIds) {
      if (!(id in saved)) continue;
      const el = $(id);
      if (!el) continue;
      if (el.type === "checkbox" || el.type === "radio") el.checked = !!saved[id]; else el.value = saved[id];
    }
    if (!$("mq-topic").value.trim()) $("mq-topic").value = randomChannel();
    return saved;
  }
  function save() {
    const out = {};
    for (const id of persistIds) {
      const el = $(id);
      out[id] = (el.type === "checkbox" || el.type === "radio") ? el.checked : el.value;
    }
    lsSet(STORE, out);
  }

  const radio = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
  function apkUrl() {
    if (radio("src") === "laptop") {
      if (!state.info || !$("ip").value) return "";
      return `http://${$("ip").value}:${state.info.port}/freekiosk.apk`;
    }
    return $("net-url").value.trim();
  }

  function mqttSettings() {
    return {
      enabled: $("fk-mqtt").checked,
      broker: $("mq-broker").value.trim(),
      base: $("mq-topic").value.trim().replace(/\/+$/, ""),
      user: $("mq-user").value.trim(),
      pass: $("mq-pass").value,
    };
  }

  function opts() {
    return {
      url: apkUrl(), localSource: radio("src") === "laptop", checksumType: radio("cs"),
      sigChecksum: state.sig, pkgChecksum: state.pkg,
      ssid: $("ssid").value, password: $("pw").value, security: radio("sec"), hidden: $("hidden-net").checked,
      keepApps: $("keep-apps").checked, skipEdu: $("skip-edu").checked, locale: $("locale").value, tz: $("tz").value,
      fk: {
        pin: $("fk-pin").value, url: $("fk-url").value, keepScreenOn: $("fk-screen").checked,
        statusBar: $("fk-statusbar").checked, blockReset: $("fk-reset").checked, urlFilter: $("fk-filter").checked,
        noZoom: $("fk-zoom").checked, lockPower: $("fk-power").checked,
        cornerReturn: $("fk-corner").checked, lockBluetooth: $("fk-lockbt").checked,
        mqtt: $("fk-mqtt").checked, broker: $("mq-broker").value, port: $("mq-port").value,
        user: $("mq-user").value, pass: $("mq-pass").value, topic: $("mq-topic").value, name: $("mq-name").value,
        extra: $("fk-extra").value,
      },
    };
  }

  // Every module gets the same whole number of device pixels. A QR scaled by a
  // fractional factor has uneven modules, which scanners struggle with once it is dense.
  function drawQR(canvas, text, cssMax) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
    const qr = qrcode(0, "L");
    qr.addData(text, "Byte");
    qr.make();
    const count = qr.getModuleCount();
    const quiet = 4;
    const dpr = window.devicePixelRatio || 1;
    const modules = count + quiet * 2;
    const cell = Math.max(1, Math.floor((cssMax * dpr) / modules));
    const size = modules * cell;
    canvas.width = size; canvas.height = size;
    canvas.style.width = canvas.style.height = size / dpr + "px";
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000";
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
    }
    return count;
  }
  const cardSize = () => Math.min(300, $("frame").clientWidth || 300);
  const fullSize = () => Math.max(200, Math.min(window.innerWidth - 48, window.innerHeight - 130));

  let lastText = "";
  function render() {
    const laptop = radio("src") === "laptop";
    $("row-ip").hidden = !laptop;
    $("row-net").hidden = laptop;
    $("mqtt-rows").hidden = !$("fk-mqtt").checked;

    const res = buildProvisioning(opts());
    if (laptop && !state.info) res.problems.unshift("Start.bat läuft nicht. Oder Quelle „Internet“.");
    if (laptop && state.info && state.loading) res.problems.unshift("App wird gelesen …");
    lastText = JSON.stringify(res.json);
    $("json").textContent = JSON.stringify(res.json, null, 2);

    const msgs = $("msgs");
    msgs.textContent = "";
    const add = (cls, t) => msgs.appendChild(h("li", {}, h("span", { class: "dot " + cls }), h("span", {}, t)));
    res.problems.forEach((t) => add("bad", t));
    res.warnings.forEach((t) => add("warn", t));

    let modules = 0;
    try { modules = drawQR($("qr"), lastText, cardSize()); } catch (e) { add("bad", "QR zu groß: " + e.message); }
    const ready = !res.demo && res.problems.length === 0 && modules > 0;
    const pill = $("pill");
    pill.className = "pill " + (ready ? "ok" : "bad");
    fill(pill, h("span", { class: "dot " + (ready ? "ok" : "bad") }), ready ? "Bereit zum Scannen" : res.problems.length + (res.problems.length === 1 ? " Punkt offen" : " Punkte offen"));
    $("frame").classList.toggle("wait", !ready);
    $("qr-wait").hidden = ready;
    $("qr-wait-text").textContent = res.problems[0] || "Noch nicht scannen";

    const name = $("mq-name").value.trim();
    $("qr-name").textContent = name;

    const pi = $("print-info");
    fill(pi,
      name ? h("p", {}, h("b", {}, name)) : null,
      h("p", {}, `WLAN: ${$("ssid").value.trim() || "–"}`),
      h("p", {}, "Zurücksetzen · am Willkommen-Bildschirm 6× tippen · scannen · Weiter")
    );
    if (!$("full").hidden) renderFull();
    save();
    changeHooks.forEach((fn) => fn());
  }

  function renderFull() {
    drawQR($("qr-full"), lastText, fullSize());
    $("full-name").textContent = $("mq-name").value.trim();
  }

  function showApk(name, size, r) {
    state.sig = r.signatureChecksum; state.pkg = r.packageChecksum; state.scheme = r.scheme;
    state.apkName = name; state.apkSize = size;
    const ver = state.info && state.info.version && name === state.info.apkName ? state.info.version + " · " : "";
    $("apk-line").textContent = `${ver}${(size / 1048576).toFixed(1)} MB${r.scheme ? "" : " · v1"}`;
    $("apk-line").title = name + "\n" + (r.signatureChecksum || r.packageChecksum);
    if (!r.signatureChecksum) $("cs-pkg").checked = true;
  }

  async function handleFile(file) {
    if (!file) return;
    $("drop-title").textContent = file.name + " …";
    try {
      showApk(file.name, file.size, await apkChecksums(await file.arrayBuffer()));
      $("drop-title").textContent = file.name;
      state.loading = false;
      if (state.info) $("src-net").checked = true;
    } catch (e) {
      $("drop-title").textContent = e.message;
    }
    render();
  }

  function nextTablet() {
    const el = $("mq-name");
    const m = el.value.match(/^(.*?)(\d+)\s*$/);
    el.value = m ? m[1] + String(parseInt(m[2], 10) + 1).padStart(m[2].length, "0") : (el.value.trim() || "tablet") + "-02";
    render();
    hud(el.value);
  }

  function serverBadge() {
    const box = $("server-state");
    if (state.info) fill(box, h("span", { class: "dot ok" }), "Start.bat läuft");
    else fill(box, h("span", { class: "dot" }), "Ohne Start.bat");
  }

  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });

  async function boot() {
    const saved = load();
    try { state.info = await api("/api/info"); } catch (e) { state.info = null; }
    serverBadge();
    readyResolve(state.info);

    const ipSel = $("ip");
    ipSel.textContent = "";
    if (state.info) {
      const ips = Array.isArray(state.info.ips) ? state.info.ips : (state.info.ips ? [state.info.ips] : []);
      for (const a of ips) ipSel.appendChild(h("option", { value: a.address }, a.name ? `${a.address} · ${a.name}` : a.address));
      if (saved.ip && ips.some((a) => a.address === saved.ip)) ipSel.value = saved.ip;
      if (!ips.length) ipSel.appendChild(h("option", { value: "" }, "Kein Netzwerk"));
      if (state.info.releaseUrl && !$("net-url").value) $("net-url").value = state.info.releaseUrl;
      render();
      try {
        const buf = await (await fetch("/freekiosk.apk", { cache: "no-store" })).arrayBuffer();
        showApk(state.info.apkName, buf.byteLength, await apkChecksums(buf));
      } catch (e) {
        $("apk-line").textContent = "konnte nicht gelesen werden";
      }
    } else {
      ipSel.appendChild(h("option", { value: "" }, "nur mit Start.bat"));
      $("src-net").checked = true;
      $("apk-line").textContent = "unter Mehr auswählen";
    }
    state.loading = false;
    render();
  }

  $("apk").addEventListener("change", (e) => handleFile(e.target.files[0]));
  const drop = $("drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("is-over"); }));
  drop.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));
  $("form").addEventListener("input", render);
  $("form").addEventListener("change", render);
  $("form").addEventListener("submit", (e) => e.preventDefault());
  $("fk-pin").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); });
  $("btn-next").addEventListener("click", nextTablet);
  $("btn-print").addEventListener("click", () => window.print());
  // Print from a large drawing; the print stylesheet sets the physical size.
  window.addEventListener("beforeprint", () => { if (lastText) drawQR($("qr"), lastText, 1400); });
  window.addEventListener("afterprint", () => { if (lastText) drawQR($("qr"), lastText, cardSize()); });
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!lastText) return;
      drawQR($("qr"), lastText, cardSize());
      if (!$("full").hidden) renderFull();
    }, 150);
  });
  $("btn-large").addEventListener("click", () => { $("full").hidden = false; renderFull(); $("full-close").focus(); });
  $("full-close").addEventListener("click", () => { $("full").hidden = true; });
  $("full").addEventListener("click", (e) => { if (e.target === $("full") || e.target === $("qr-full")) $("full").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("full").hidden = true; });
  $("btn-copy").addEventListener("click", () => {
    const done = () => hud("Kopiert");
    const fallback = () => {
      const range = document.createRange(); range.selectNodeContents($("json"));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    };
    try { navigator.clipboard.writeText($("json").textContent).then(done, fallback); } catch (e) { fallback(); }
  });

  window.Kit = {
    $, h, fill, icon, hud, ago, api, lsGet, lsSet, mqttSettings,
    onShow(view, fn) { (listeners[view] = listeners[view] || []).push(fn); },
    onChange(fn) { changeHooks.push(fn); },
    ready,
    get info() { return state.info; },
    get view() { return current; },
  };

  document.addEventListener("DOMContentLoaded", () => {
    boot();
    show(location.hash.slice(1) || "setup");
  });
})();
