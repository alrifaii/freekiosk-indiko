// FreeKiosk QR-Kit: APK-Pruefsummen und Aufbau des Android-Provisionierungs-JSON.
// Wird von index.html geladen; ohne DOM-Zugriff, damit es sich auch in Node testen laesst.
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

function buildProvisioning(o) {
  const problems = [], warnings = [], infos = [];
  const json = {};
  json[X + "DEVICE_ADMIN_COMPONENT_NAME"] = COMPONENT;
  const url = (o.url || "").trim();
  let parsed = null;
  try { parsed = new URL(url); } catch (e) { parsed = null; }
  if (!parsed || !/^https?:$/.test(parsed.protocol)) problems.push("Download-Link fehlt oder ist ungültig.");
  else {
    if (parsed.protocol === "http:") warnings.push("Link ohne https. Geht nur im lokalen Netz, die Prüfsumme schützt die Datei trotzdem.");
    if (/github\.com$/.test(parsed.hostname)) infos.push("GitHub leitet auf einen anderen Server weiter. Hängt der Download, die APK lokal anbieten.");
    if (!/\.apk$/i.test(parsed.pathname)) warnings.push("Der Link endet nicht auf .apk. Bitte den direkten Datei-Link nehmen.");
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
      if (o.pkgChecksum) problems.push("Diese APK hat keinen v2/v3-Signaturblock. Bitte „Datei-Hash“ wählen.");
    }
  }
  if (demo && !o.pkgChecksum) problems.push("Noch keine APK ausgewählt. Der QR ist nur ein Beispiel.");

  const ssid = (o.ssid || "").trim();
  if (ssid) {
    json[X + "WIFI_SSID"] = ssid;
    json[X + "WIFI_SECURITY_TYPE"] = o.security;
    if (o.security !== "NONE") {
      if (!o.password) problems.push("WLAN-Passwort fehlt.");
      json[X + "WIFI_PASSWORD"] = o.password || "";
      if (o.security === "WPA" && o.password && o.password.length < 8) warnings.push("WPA-Passwörter haben mindestens 8 Zeichen.");
    }
    if (o.hidden) json[X + "WIFI_HIDDEN"] = true;
    if (/[^\x20-\x7e]/.test(ssid + (o.password || ""))) warnings.push("Umlaute oder Sonderzeichen im WLAN-Namen oder Passwort liest nicht jeder Scanner richtig. Für den Test lieber ein Netz ohne nehmen.");
  } else infos.push("Ohne WLAN im QR fragt das Tablet selbst nach einem Netz.");

  if (o.keepApps) json[X + "LEAVE_ALL_SYSTEM_APPS_ENABLED"] = true;
  if (o.skipEdu) json[X + "SKIP_EDUCATION_SCREENS"] = true;
  if ((o.locale || "").trim()) json[X + "LOCALE"] = o.locale.trim();
  if ((o.tz || "").trim()) json[X + "TIME_ZONE"] = o.tz.trim();

  if (o.fk) {
    const fk = o.fk;
    const extras = {};
    const pin = (fk.pin || "").trim();
    if (!/^\d{4,6}$/.test(pin)) problems.push("PIN für FreeKiosk fehlt (4 bis 6 Ziffern). Ohne PIN verwirft FreeKiosk alle Einstellungen.");
    extras.pin = pin;
    const startUrl = (fk.url || "").trim();
    let su = null;
    try { su = new URL(startUrl); } catch (e) { su = null; }
    if (!su || !/^https?:$/.test(su.protocol)) problems.push("Start-URL für FreeKiosk ist ungültig.");
    extras.url = startUrl;
    extras.kiosk_enabled = "true";
    extras.auto_launch = "true";
    extras.keep_screen_on = String(!!fk.keepScreenOn);
    extras.status_bar_enabled = String(!!fk.statusBar);
    if (fk.statusBar) { extras.status_bar_show_battery = "true"; extras.status_bar_show_time = "true"; }
    if (fk.blockReset) extras.block_factory_reset = "true";
    if (fk.mqtt) {
      const broker = (fk.broker || "").trim();
      if (!broker) problems.push("MQTT-Broker fehlt.");
      if (/^[a-z]+:\/\//i.test(broker)) warnings.push("Beim Broker nur Host oder IP eintragen, ohne mqtt:// davor.");
      const port = (fk.port || "").trim() || "1883";
      if (!/^\d{1,5}$/.test(port)) problems.push("MQTT-Port muss eine Zahl sein.");
      extras.mqtt_enabled = "true";
      extras.mqtt_broker_url = broker;
      extras.mqtt_port = port;
      if ((fk.user || "").trim()) extras.mqtt_username = fk.user.trim();
      if (fk.pass) extras.mqtt_password = fk.pass;
      if ((fk.topic || "").trim()) extras.mqtt_base_topic = fk.topic.trim();
      if ((fk.name || "").trim()) extras.mqtt_device_name = fk.name.trim();
    }
    const lines = (fk.extra || "").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!line.trim() || line.trim().startsWith("#")) return;
      const m = line.match(/^\s*([a-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) { warnings.push(`Zeile ${i + 1} bei den weiteren Einstellungen hat nicht die Form schluessel=wert und wird ignoriert.`); return; }
      extras[m[1]] = m[2];
    });
    json[X + "ADMIN_EXTRAS_BUNDLE"] = extras;
    infos.push("FreeKiosk übernimmt die Einstellungen beim ersten Start und startet dabei einmal neu.");
  }

  if (new TextEncoder().encode(JSON.stringify(json)).length > 1100) warnings.push("Der QR ist sehr dicht. Großansicht nutzen und die Bildschirmhelligkeit hochdrehen.");

  return { json, problems, warnings, infos, demo };
}

if (typeof module !== "undefined") module.exports = { readSignerCert, apkChecksums, buildProvisioning, b64url };
