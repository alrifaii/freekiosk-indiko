// FreeKiosk QR-Kit: APK-Pruefsummen und Aufbau des Android-Provisionierungs-JSON.
// Ohne DOM-Zugriff, damit es sich auch in Node testen laesst.
const COMPONENT = "com.freekiosk/com.freekiosk.DeviceAdminReceiver";
const X = "android.app.extra.PROVISIONING_";
const EXAMPLE_CHECKSUM = "BEISPIEL_erst_APK_auswaehlen_xxxxxxxxxxxx";

function readSignerCert(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  const n = u8.length;
  let eocd = -1;
  for (let i = n - 22; i >= Math.max(0, n - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Das ist keine APK-Datei.");
  const cdOff = dv.getUint32(eocd + 16, true);
  if (cdOff < 32 || new TextDecoder().decode(u8.subarray(cdOff - 16, cdOff)) !== "APK Sig Block 42") return null;
  const size = Number(dv.getBigUint64(cdOff - 24, true));
  const start = cdOff - size - 8;
  if (start < 0 || Number(dv.getBigUint64(start, true)) !== size) throw new Error("Der Signaturblock der APK ist beschädigt.");
  const blocks = {};
  for (let p = start + 8; p < cdOff - 24;) {
    const len = Number(dv.getBigUint64(p, true));
    blocks[dv.getUint32(p + 8, true)] = { off: p + 12, len: len - 4 };
    p += 8 + len;
  }
  const scheme = blocks[0xf05368c0] ? 3 : blocks[0x7109871a] ? 2 : 0;
  if (!scheme) return null;
  const b = scheme === 3 ? blocks[0xf05368c0] : blocks[0x7109871a];
  const lp = (o) => ({ len: dv.getUint32(o, true), off: o + 4 });
  const signer = lp(lp(b.off).off);
  const signedData = lp(signer.off);
  const digests = lp(signedData.off);
  const certs = lp(digests.off + digests.len);
  const cert = lp(certs.off);
  return { scheme, der: u8.slice(cert.off, cert.off + cert.len) };
}

function b64url(bytes) {
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function apkChecksums(buf) {
  const sha = async (d) => new Uint8Array(await crypto.subtle.digest("SHA-256", d));
  const out = { packageChecksum: b64url(await sha(buf)), signatureChecksum: null, scheme: 0 };
  const signer = readSignerCert(buf);
  if (signer) { out.signatureChecksum = b64url(await sha(signer.der)); out.scheme = signer.scheme; }
  return out;
}

// Messages stay short: the kit shows them under the QR code.
function buildProvisioning(o) {
  const problems = [], warnings = [], infos = [];
  const json = {};
  json[X + "DEVICE_ADMIN_COMPONENT_NAME"] = COMPONENT;
  const url = (o.url || "").trim();
  let parsed = null;
  try { parsed = new URL(url); } catch (e) { parsed = null; }
  if (!parsed || !/^https?:$/.test(parsed.protocol)) problems.push("Download-Link fehlt.");
  else {
    if (parsed.protocol === "http:" && !o.localSource) warnings.push("Link ohne https.");
    if (!/\.apk$/i.test(parsed.pathname)) warnings.push("Link endet nicht auf .apk.");
  }
  json[X + "DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION"] = url;

  let demo = false;
  if (o.checksumType === "pkg") {
    if (o.pkgChecksum) json[X + "DEVICE_ADMIN_PACKAGE_CHECKSUM"] = o.pkgChecksum;
    else { demo = true; json[X + "DEVICE_ADMIN_PACKAGE_CHECKSUM"] = EXAMPLE_CHECKSUM; }
  } else {
    if (o.sigChecksum) json[X + "DEVICE_ADMIN_SIGNATURE_CHECKSUM"] = o.sigChecksum;
    else {
      demo = true;
      json[X + "DEVICE_ADMIN_SIGNATURE_CHECKSUM"] = EXAMPLE_CHECKSUM;
      if (o.pkgChecksum) problems.push("APK ohne v2/v3-Signatur. Unter Mehr „Datei-Hash“ wählen.");
    }
  }
  if (demo && !o.pkgChecksum) problems.push("Noch keine App geladen.");

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
      const devName = (fk.name || "").trim();
      if (devName) {
        extras.mqtt_device_name = devName;
        if (!/^[A-Za-z0-9_.-]+$/.test(devName)) warnings.push("Name besser ohne Leerzeichen, z. B. tablet-01.");
      } else problems.push("Name fehlt.");
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

  return { json, problems, warnings, infos, demo, bytes };
}

if (typeof module !== "undefined") module.exports = { readSignerCert, apkChecksums, buildProvisioning, b64url };
