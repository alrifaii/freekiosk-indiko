// inDiKo Kit: "Grids" view. Takes a grid file and loads it straight into AsTeRICS Grid
// on chosen tablets: the tablets fetch it in pieces over MQTT, the Grid agent on each
// imports it like "Import custom data from file".
//
// Add-ons: web pages the user adds by link (for example the calendar generator). The kit
// shows one in a frame with ?kit=1; a finished grid comes back as a message
//   window.parent.postMessage({ typ: "asterics-grd", name: "x.grd", inhalt: "<grd JSON>" }, "*")
// and goes to the tablets like a dropped file. Nothing of an add-on is in the kit itself.
(function () {
  "use strict";
  const { $, h, fill, icon, toggle, hud, lsGet, lsSet } = Kit;
  const T = () => window.KitTablets;
  const MAX_BYTES = 20 * 1024 * 1024;
  const CHUNK = 48 * 1024; // passes the message size limit of every common broker
  const OFFER_MS = 5 * 60 * 1000; // how long the kit answers tablets that say "ready"
  const ADDONS = "fkkit.addons";
  const te = new TextEncoder();

  let studio = null;

  const addons = () => (Array.isArray(lsGet(ADDONS)) ? lsGet(ADDONS) : []).filter((a) => a && /^https?:\/\//i.test(a.url || ""));
  function nameFromUrl(u) {
    try {
      const x = new URL(u);
      const last = x.pathname.split("/").filter(Boolean).pop() || "";
      return decodeURIComponent(last.replace(/\.html?$/i, "")) || x.hostname;
    } catch (e) { return u; }
  }

  function build() {
    const body = $("g-body");
    const file = h("input", { type: "file", accept: ".grd,.json,.txt,.obf,.obz" });
    const drop = h("label", { class: "dropzone" }, file,
      h("span", { class: "site-ic lime", style: "margin:0 auto" }, icon("upload")),
      h("b", {}, "Datei an Tablets senden"),
      h("span", {}, "AsTeRICS-Datei (.grd) oder Tafel (.obf, .obz) hierher ziehen oder antippen"));
    file.addEventListener("change", () => { if (file.files[0]) takeFile(file.files[0]); file.value = ""; });
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("is-over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("is-over");
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (f) takeFile(f);
    });

    studio = h("div", { class: "studio", hidden: true });
    const tiles = h("div", { class: "tools" });
    const link = h("input", { type: "url", placeholder: "https://…", spellcheck: "false", "aria-label": "Link des Add-ons" });
    const name = h("input", { type: "text", placeholder: "Name (optional)", spellcheck: "false", "aria-label": "Name des Add-ons" });
    const add = () => {
      const url = link.value.trim();
      if (!/^https?:\/\/[^/]+/i.test(url)) { hud("Bitte einen Link mit https://", "bad"); return; }
      const list = addons().filter((a) => a.url !== url);
      list.push({ name: name.value.trim() || nameFromUrl(url), url });
      lsSet(ADDONS, list);
      link.value = ""; name.value = "";
      drawTiles();
      hud("Add-on hinzugefügt");
    };
    link.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
    function drawTiles() {
      const list = addons();
      fill(tiles, drop, ...list.map((a) =>
        h("div", { class: "addon" },
          h("button", { type: "button", class: "tool", onclick: () => openAddon(a) },
            h("span", { class: "site-ic own" }, icon("box")),
            h("b", {}, a.name),
            h("small", {}, (() => { try { return new URL(a.url).hostname; } catch (e) { return a.url; } })())),
          h("button", { type: "button", class: "icon-btn addon-x", "aria-label": `${a.name} entfernen`, onclick: () => {
            if (!confirm(`Add-on „${a.name}“ entfernen?`)) return;
            lsSet(ADDONS, addons().filter((x) => x.url !== a.url));
            if (studio._addon === a.url) { studio.hidden = true; studio.replaceChildren(); }
            drawTiles();
          } }, icon("x")))));
    }
    drawTiles();
    fill(body,
      tiles,
      studio,
      h("div", { class: "group-h" }, h("span", {}, "Add-on hinzufügen")),
      h("div", { class: "group" },
        h("label", { class: "row" }, h("span", { class: "lbl" }, "Link"), link),
        h("label", { class: "row" }, h("span", { class: "lbl" }, "Name"), name),
        h("div", { class: "row", style: "background:none" }, h("button", { type: "button", class: "btn", onclick: add }, icon("plus"), "Hinzufügen"))),
      h("p", { class: "foot" }, "Ein Add-on ist eine Webseite, zum Beispiel der Kalender-Generator. Es läuft hier im Kit und kann fertige Grids direkt an die Tablets geben."));
  }

  function openAddon(a) {
    let src = a.url;
    try { const u = new URL(a.url); u.searchParams.set("kit", "1"); src = u.href; } catch (e) { /* keep as is */ }
    const frame = h("iframe", { src, title: a.name, allow: "clipboard-write",
      sandbox: "allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-modals" });
    fill(studio,
      h("div", { class: "studio-bar" },
        h("span", { class: "site-ic own", style: "width:30px;height:30px;border-radius:9px;box-shadow:none" }, icon("box")),
        h("b", {}, a.name),
        h("a", { class: "btn sm ghost", href: a.url, target: "_blank", rel: "noopener" }, "Eigenes Fenster"),
        h("button", { type: "button", class: "icon-btn", "aria-label": "Schließen", onclick: () => { studio.hidden = true; studio.replaceChildren(); studio._addon = ""; } }, icon("x"))),
      frame);
    studio.hidden = false;
    studio._frame = frame;
    studio._addon = a.url;
    studio._name = a.name;
    setTimeout(() => studio.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  // A grid from the open add-on (any origin: the user added it)
  window.addEventListener("message", (e) => {
    if (!studio || studio.hidden || !studio._frame || e.source !== studio._frame.contentWindow) return;
    const d = e.data;
    if (!d || d.typ !== "asterics-grd" || typeof d.inhalt !== "string") return;
    if (d.inhalt.length > MAX_BYTES) { hud("Grid zu groß (höchstens 20 MB)", "bad"); return; }
    const fname = String(d.name || "grid.grd").replace(/[\\/:*?"<>|]/g, "_");
    openSend({ name: /\.grd$/i.test(fname) ? fname : fname + ".grd", bytes: te.encode(d.inhalt) }, { open: true, what: studio._name || "Grid" });
  });

  async function takeFile(f) {
    if (!/\.(grd|json|txt|obf|obz)$/i.test(f.name)) { hud("Nur .grd, .obf oder .obz", "bad"); return; }
    if (f.size > MAX_BYTES) { hud("Datei zu groß (höchstens 20 MB)", "bad"); return; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    // AsTeRICS decides by file name; a .json backup is a .grd file
    const name = /\.json$/i.test(f.name) && !/\.grd\.json$/i.test(f.name) ? f.name.replace(/\.json$/i, ".grd") : f.name;
    openSend({ name, bytes }, { open: false, what: f.name });
  }

  async function gzip(bytes) {
    if (!window.CompressionStream) return null;
    try {
      return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
    } catch (e) { return null; }
  }

  function saveFile(file) {
    const a = h("a", { href: URL.createObjectURL(new Blob([file.bytes])), download: file.name });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  // Sheet: choose tablets and send. Reuses the Tablets sheet.
  function openSend(file, opts) {
    const K = T();
    if (!K) return;
    const chosen = new Set();
    const ui = { open: !!opts.open };
    const kb = Math.max(1, Math.round(file.bytes.length / 1024));
    // Each tablet opens its own connection, says "ready" and gets the file in pieces,
    // gzipped. Nothing stays on the MQTT server.
    const send = async () => {
      if (!K.online) { hud("Keine Verbindung", "bad"); return; }
      if (!K.agentReachable()) { hud("Braucht einen wss://-Server", "bad"); return; }
      const tids = [...chosen];
      if (!tids.length) { hud("Erst Tablets antippen", "bad"); return; }
      const packed = await gzip(file.bytes);
      const data = packed || file.bytes;
      const pieces = [];
      for (let i = 0; i < data.length; i += CHUNK) pieces.push(data.subarray(i, i + CHUNK));
      if (!pieces.length) pieces.push(new Uint8Array(0));
      const s = K.settings();
      const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
      const topic = `${s.base}/kit/inbox/${id}`;
      const asked = new Set();
      const stop = K.listen(topic + "/ready", (t, payload) => {
        const who = new TextDecoder().decode(payload);
        if (asked.has(who)) return;
        asked.add(who);
        hud(`Tablet holt die Datei (${pieces.length} ${pieces.length === 1 ? "Teil" : "Teile"})`);
        pieces.forEach((piece, i) => K.publishRaw(`${topic}/c/${i}`, piece, false));
      });
      setTimeout(stop, OFFER_MS);
      // Give the subscription a moment before the tablets can answer
      setTimeout(() => {
        K.agent(tids, "import", { topic, name: file.name, open: ui.open, n: pieces.length, gz: !!packed },
          { sending: tids.length > 1 ? `Sendet an ${tids.length} Tablets …` : "Sendet …", label: `${opts.what} importiert`, reprobe: 30000 });
      }, 300);
      K.closeSheet();
    };
    K.openSheet({
      title: "An Tablets senden",
      build(body) {
        ui.list = h("div", {});
        ui.btn = h("button", { type: "button", class: "btn", onclick: send }, icon("upload"), "Senden");
        const pub = ["broker.emqx.io", "broker.hivemq.com", "test.mosquitto.org"].includes((K.settings().broker || "").toLowerCase());
        body.append(
          h("div", { class: "group" },
            h("div", { class: "row" }, h("span", { class: "nav-ic" }, icon("file")),
              h("span", { class: "grow" }, h("span", { class: "row-title", style: "overflow-wrap:anywhere" }, file.name), h("small", { class: "row-sub" }, `${kb} KB`)),
              h("button", { type: "button", class: "btn sm light", onclick: () => saveFile(file) }, icon("download"), "Speichern"))),
          ui.list,
          h("div", { class: "tgrid", style: "margin-top:12px" }, toggle("Danach öffnen", "ag:th-large", ui.open, (on) => { ui.open = on; })),
          h("div", { class: "row", style: "padding:16px 0 0;background:none" }, ui.btn),
          h("div", { class: "foot" }, "Kommt zu den Grids dazu, nichts wird gelöscht. AsTeRICS Grid muss auf dem Tablet offen sein."),
          pub ? h("div", { class: "foot warn-t" }, "Die Datei geht über den öffentlichen MQTT-Server. Keine Namen oder Fotos von Personen in Grids, die so verschickt werden.") : null);
      },
      refresh() {
        const entries = K.visibleEntries();
        const key = JSON.stringify([entries.map(([tid, t]) => [tid, K.statusOf(t), !!(t.page && t.page.api)]), [...chosen]]);
        if (ui.list._key === key) return;
        ui.list._key = key;
        const rows = entries.map(([tid, t]) => {
          const st = K.statusOf(t);
          const ag = !!(t.page && t.page.api);
          const on = chosen.has(tid);
          return h("button", { type: "button", class: "row nav", "aria-pressed": String(on), onclick: () => { if (on) chosen.delete(tid); else chosen.add(tid); ui.list._key = ""; this.refresh(); } },
            K.avatarEl(tid, "sm"),
            h("span", { class: "grow" }, h("span", { class: "row-title" }, K.displayName(tid)),
              h("small", { class: "row-sub" }, st === "off" ? "Offline" : ag ? "AsTeRICS Grid offen" : t.page ? "Andere Seite offen" : "Noch nicht abgefragt")),
            on ? icon("check", "chk") : h("span", { class: "chk-empty" }));
        });
        const all = entries.filter(([, t]) => K.statusOf(t) !== "off").map(([tid]) => tid);
        fill(ui.list,
          h("div", { class: "group-h" }, h("span", {}, "Tablets"),
            all.length ? h("button", { type: "button", class: "link", onclick: () => {
              if (all.every((tid) => chosen.has(tid))) chosen.clear(); else all.forEach((tid) => chosen.add(tid));
              ui.list._key = ""; this.refresh();
            } }, all.length && all.every((tid) => chosen.has(tid)) ? "Keine" : "Alle") : null),
          h("div", { class: "group" }, ...(rows.length ? rows : [h("div", { class: "row" }, h("span", { class: "grow muted" }, "Noch keine Tablets verbunden"))])));
        ui.btn.disabled = !chosen.size;
        ui.btn.lastChild.textContent = chosen.size > 1 ? `An ${chosen.size} Tablets senden` : "Senden";
      },
    });
  }

  build();
  window.KitGrids = { openSend };
})();
