// inDiKo Kit: the Android provisioning JSON that goes into the QR code.
// The tablet downloads FreeKiosk itself from the link (GitHub release) and checks it
// against the signature checksum; both come from config.js, written by the build.
// No DOM access, so it can be tested in Node.
const COMPONENT = "com.freekiosk/com.freekiosk.DeviceAdminReceiver";
const X = "android.app.extra.PROVISIONING_";

// Messages stay short: the kit shows them under the QR code.
function buildProvisioning(o) {
  const problems = [], warnings = [], infos = [];
  const json = {};
  json[X + "DEVICE_ADMIN_COMPONENT_NAME"] = COMPONENT;
  const url = (o.url || "").trim();
  let parsed = null;
  try { parsed = new URL(url); } catch (e) { parsed = null; }
  if (!parsed || !/^https?:$/.test(parsed.protocol)) problems.push("Link zur App fehlt (unter Mehr).");
  else {
    if (parsed.protocol === "http:") warnings.push("Link ohne https.");
    if (!/\.apk$/i.test(parsed.pathname)) warnings.push("Link endet nicht auf .apk.");
  }
  json[X + "DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION"] = url;

  // SHA-256 of the signing certificate, base64url: the same for every build with one key
  const sig = (o.sigChecksum || "").trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(sig)) problems.push("Prüfsumme der App fehlt (unter Mehr).");
  json[X + "DEVICE_ADMIN_SIGNATURE_CHECKSUM"] = sig;

  const ssid = (o.ssid || "").trim();
  if (ssid) {
    json[X + "WIFI_SSID"] = ssid;
    json[X + "WIFI_SECURITY_TYPE"] = o.security;
    if (o.security !== "NONE") {
      if (!o.password) problems.push("WLAN-Passwort fehlt.");
      json[X + "WIFI_PASSWORD"] = o.password || "";
      if (o.security === "WPA" && o.password && o.password.length < 8) warnings.push("WLAN-Passwort zu kurz.");
    }
    if (o.hidden) json[X + "WIFI_HIDDEN"] = true;
    if (/[^\x20-\x7e]/.test(ssid + (o.password || ""))) warnings.push("Umlaute im WLAN liest nicht jeder Scanner.");
  } else infos.push("Ohne WLAN fragt das Tablet selbst.");

  if (o.keepApps) json[X + "LEAVE_ALL_SYSTEM_APPS_ENABLED"] = true;
  if (o.skipEdu) json[X + "SKIP_EDUCATION_SCREENS"] = true;
  if ((o.locale || "").trim()) json[X + "LOCALE"] = o.locale.trim();
  if ((o.tz || "").trim()) json[X + "TIME_ZONE"] = o.tz.trim();

  if (o.fk) {
    const fk = o.fk;
    const extras = {};
    const pin = (fk.pin || "").trim();
    if (!/^\d{4,6}$/.test(pin)) problems.push("PIN fehlt (4 bis 6 Ziffern).");
    extras.pin = pin;
    const startUrl = (fk.url || "").trim();
    let su = null;
    try { su = new URL(startUrl); } catch (e) { su = null; }
    if (!su || !/^https?:$/.test(su.protocol)) problems.push("Start-Seite ist ungültig.");
    extras.url = startUrl;
    extras.kiosk_enabled = "true";
    extras.auto_launch = "true";
    extras.keep_screen_on = String(!!fk.keepScreenOn);
    extras.status_bar_enabled = String(!!fk.statusBar);
    // Only what differs from FreeKiosk's defaults goes in: every byte makes the QR denser.
    if (fk.statusBar) extras.status_bar_theme = "light";
    if (fk.urlFilter && su) {
      extras.url_filter_enabled = "true";
      extras.url_filter_mode = "whitelist";
      extras.url_filter_list = JSON.stringify([su.origin + "/*"]);
    }
    if (fk.noZoom) extras.disable_user_zoom = "true";
    if (fk.lockPower) extras.allow_power_button = "false";
    if (fk.blockReset) extras.block_factory_reset = "true";
    if (fk.cornerReturn) {
      // Only the bottom-right corner opens the PIN screen; fast tapping while
      // using the grid, or a volume key, no longer does.
      extras.return_mode = "button"; // bottom-right is the default position
      extras.return_tap_count = "7";
      extras.return_tap_timeout = "3000";
      extras.volume_up_5tap_enabled = "false";
    }
    if (fk.lockBluetooth) {
      extras.lockscreen_controls_enabled = "true";
      extras.lockscreen_bluetooth_enabled = "true";
    }
    if (fk.mqtt) {
      const broker = (fk.broker || "").trim();
      if (!broker) problems.push("MQTT-Server fehlt.");
      if (/^[a-z]+:\/\//i.test(broker)) warnings.push("Beim MQTT-Server nur den Namen, ohne mqtt://.");
      const port = String(fk.port || "").trim() || "1883";
      if (!/^\d{1,5}$/.test(port)) problems.push("MQTT-Port muss eine Zahl sein.");
      extras.mqtt_enabled = "true";
      extras.mqtt_broker_url = broker;
      if (port !== "1883") extras.mqtt_port = port;
      if ((fk.user || "").trim()) extras.mqtt_username = fk.user.trim();
      if (fk.pass) extras.mqtt_password = fk.pass;
      if ((fk.topic || "").trim()) extras.mqtt_base_topic = fk.topic.trim();
      if (fk.adminKey) extras.mqtt_admin_key = fk.adminKey;
      // Screen picture on request in the kit (Tablets > Bildschirmfoto); small enough for any broker
      extras.mqtt_screenshot_enabled = "true";
      extras.mqtt_screenshot_max_width = "900";
      const devName = (fk.name || "").trim();
      if (devName) {
        extras.mqtt_device_name = devName;
        if (!/^[A-Za-z0-9_.-]+$/.test(devName)) warnings.push("Name besser ohne Leerzeichen, z. B. tablet-01.");
      } else problems.push("Name fehlt.");
    }
    // Spare networks: FreeKiosk saves them as Device Owner, Android switches by itself
    const more = (fk.wifiMore || []).filter((w) => w.s && w.s !== ssid);
    if (more.length) {
      extras.wifi_more = JSON.stringify(more.map((w) => ({ s: w.s, p: w.p })));
      more.forEach((w) => {
        if (!w.p) problems.push(`Passwort für „${w.s}“ fehlt.`);
        else if (w.p.length < 8) problems.push(`Passwort für „${w.s}“ zu kurz (mindestens 8 Zeichen).`);
      });
      if (new Set(more.map((w) => w.s)).size < more.length) warnings.push("Ein weiteres WLAN steht doppelt in der Liste.");
    }
    const lines = (fk.extra || "").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!line.trim() || line.trim().startsWith("#")) return;
      const m = line.match(/^\s*([a-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) { warnings.push(`Zeile ${i + 1} unter „Weitere“ hat nicht die Form schluessel=wert.`); return; }
      extras[m[1]] = m[2];
    });
    json[X + "ADMIN_EXTRAS_BUNDLE"] = extras;
  }

  const bytes = new TextEncoder().encode(JSON.stringify(json)).length;
  if (bytes > 1500) warnings.push("Sehr dichter QR. Vollbild nutzen.");

  return { json, problems, warnings, infos, bytes };
}

if (typeof module !== "undefined") module.exports = { buildProvisioning };
