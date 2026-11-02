// inDiKo Kit: "USB" view. Emergency help for a tablet on the cable, through adb on
// this laptop (the kit server runs the commands; only for requests from this laptop).
(function () {
  "use strict";
  const { $, h, fill, icon, hud, api } = Kit;
  let data = null;
  let error = "";
  let busy = false;
  let loading = false;
  let timer = null;
  const pins = {};

  async function refresh() {
    if (loading || busy) return;
    if (!Kit.info) { render(); return; }
    loading = true;
    try { data = await api("/api/usb"); error = ""; } catch (e) { error = e.message; }
    loading = false;
    render();
  }

  async function run(serial, action, extra) {
    if (busy) return;
    busy = true;
    render();
    try {
      await api("/api/usb/run", { json: Object.assign({ serial, action }, extra || {}) });
      hud("Erledigt");
    } catch (e) {
      hud(e.message, "bad");
    }
    busy = false;
    loading = false;
    await refresh();
  }

  async function getAdb() {
    busy = true;
    render();
    try { await api("/api/usb/adb", { json: {} }); hud("adb geladen"); } catch (e) { hud(e.message, "bad"); }
    busy = false;
    await refresh();
  }

  function empty(ic, title, text, button) {
    return h("div", { class: "empty" }, icon(ic), h("h2", {}, title), text ? h("p", {}, text) : null, button || null);
  }

  function tile(ic, title, sub, onClick, done) {
    return h("button", { type: "button", class: "tile", onclick: onClick, disabled: busy },
      icon(ic), h("b", {}, title), sub ? h("small", {}, sub) : null,
      done ? h("span", { class: "done", title: "erledigt" }, icon("check")) : null);
  }

  function device(d) {
    if (d.state && d.state !== "device") {
      const text = d.state === "unauthorized" ? "Am Tablet „USB-Debugging zulassen“ bestätigen." : "Tablet antwortet nicht. Kabel neu anstecken.";
      return h("div", { class: "usb-card" },
        h("div", { class: "usb-head" }, h("span", { class: "dot warn" }), h("div", {}, h("h2", {}, d.serial), h("p", { class: "sub" }, text))));
    }
    const pinIn = h("input", { class: "pin-in", type: "text", inputmode: "numeric", maxlength: "6", placeholder: "PIN", value: pins[d.serial] || "", "aria-label": "PIN" });
    pinIn.addEventListener("input", () => { pinIn.value = pinIn.value.replace(/\D/g, "").slice(0, 6); pins[d.serial] = pinIn.value; });
    const sendPin = () => {
      if (!/^\d{4,6}$/.test(pinIn.value)) { pinIn.focus(); hud("PIN eingeben", "bad"); return; }
      run(d.serial, "pin", { pin: pinIn.value });
    };
    pinIn.addEventListener("keydown", (e) => { if (e.key === "Enter") sendPin(); });
    const pinTile = h("div", { class: "tile" }, icon("key"), h("b", {}, "PIN senden"),
      h("div", { class: "inline" }, pinIn, h("button", { type: "button", class: "btn sm", onclick: sendPin, disabled: busy }, "OK")),
      h("small", {}, "Vorher ins PIN-Feld tippen"));

    const title = d.name || d.model || d.serial;
    return h("div", { class: "usb-card" },
      h("div", { class: "usb-head" },
        h("span", { class: "dot ok" }),
        h("div", { style: "flex:1;min-width:0" }, h("h2", {}, title), h("p", { class: "sub" }, [d.model, d.serial].filter(Boolean).join(" · "))),
        d.battery != null ? h("span", { class: "pill" }, `Akku ${d.battery} %`) : null,
        busy ? h("span", { class: "spin" }) : null),
      d.freekiosk === false ? h("p", { class: "err", style: "margin:-6px 0 14px" }, "FreeKiosk ist nicht installiert.") : null,
      h("div", { class: "tiles" },
        d.btOn === false
          ? tile("bluetooth", "Bluetooth an", "Geräte verbinden sich wieder", () => run(d.serial, "bt_on"))
          : tile("bluetooth", "Bluetooth aus", "Taster trennen, Tastatur kommt", () => run(d.serial, "bt_off")),
        tile("keyboard", "Tastatur erzwingen", "auch mit Taster", () => run(d.serial, "keyboard"), d.ime),
        pinTile,
        tile("eye", "Bildschirm wecken", null, () => run(d.serial, "wake")),
        tile("shield", "Rechte nachrüsten", "Akku, Tastatur, Statistik", () => run(d.serial, "rights"), d.secure && d.idle)),
      (d.bonded && d.bonded.length) ? h("div", {},
        h("div", { class: "group-h", style: "margin-top:20px" }, "Gekoppelt"),
        h("div", { class: "group", style: "background:var(--fill)" }, ...d.bonded.map((b) =>
          h("div", { class: "row" }, h("span", { class: "grow" }, b.name || "ohne Namen"), h("span", { class: "val mono" }, b.address))))) : null
    );
  }

  function render() {
    const box = $("u-body");
    const focused = document.activeElement;
    if (focused && focused.classList && focused.classList.contains("pin-in") && box.contains(focused)) return;
    if (!Kit.info) {
      fill(box, empty("plug", "Nur mit Start.bat", "Die Seite über Start.bat öffnen."));
      return;
    }
    if (!data) {
      fill(box, error ? empty("x", "Fehler", error) : h("div", { class: "empty" }, h("span", { class: "spin", style: "display:inline-block" })));
      return;
    }
    if (!data.adb) {
      fill(box, empty("download", "adb fehlt", "Die Android-Platform-Tools von Google, etwa 7 MB.",
        h("button", { type: "button", class: "btn", onclick: getAdb, disabled: busy }, busy ? "Lädt …" : "Laden")));
      return;
    }
    const devices = data.devices || [];
    if (!devices.length) {
      fill(box, empty("plug", "Kein Tablet am Kabel", "USB-Debugging muss am Tablet an sein."));
      return;
    }
    fill(box, ...devices.map(device), error ? h("p", { class: "err" }, error) : null);
  }

  Kit.onShow("usb", async () => {
    await Kit.ready;
    render();
    refresh();
    clearInterval(timer);
    timer = setInterval(() => { if (Kit.view === "usb" && !document.hidden) refresh(); }, 3000);
  });
  $("u-refresh").addEventListener("click", () => { loading = false; refresh(); });
})();
