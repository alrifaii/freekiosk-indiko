#!/usr/bin/env python3
"""inDiKo Kit - kleiner Webserver fuer macOS, Linux (und Windows mit Python).

Liefert die Oberflaeche (web/) und die FreeKiosk-APK an Browser und Tablets aus.
Gleiche Endpunkte wie server.ps1:
  /                  Oberflaeche
  /api/info          Port, APK, Adressen
  /freekiosk.apk     die App fuer die Tablets
  /api/usb           Tablets am USB-Kabel (nur von diesem Rechner aus)
  /api/usb/run       Notfall-Aktion per adb (POST, nur von diesem Rechner aus)
  /api/usb/adb       Android-Platform-Tools von Google laden (POST, nur lokal)
"""
import argparse
import io
import json
import os
import re
import shutil
import socket
import stat
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
import zipfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
PKG = "com.freekiosk"
SERIAL_RE = re.compile(r"^[A-Za-z0-9_.:\-]{1,64}$")
BONDED_RE = re.compile(r"([0-9A-Fa-fXx]{2}(?::[0-9A-Fa-fXx]{2}){5})\s*(?:\[[^\]]*\]\s*)*(.*)")
LOOPBACK = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}

# One adb round trip collects everything the USB view shows. Kept identical in server.ps1.
INFO_CMD = (
    "settings get global device_name; echo ---; getprop ro.product.model; echo ---; "
    "settings get global bluetooth_on; echo ---; dumpsys battery | grep level; echo ---; "
    "pm list packages com.freekiosk; echo ---; dumpsys deviceidle whitelist | grep -c com.freekiosk; echo ---; "
    "settings get secure show_ime_with_hard_keyboard; echo ---; "
    "dumpsys package com.freekiosk | grep -c 'WRITE_SECURE_SETTINGS: granted=true'; echo ---; "
    "dumpsys bluetooth_manager | grep -A 20 'Bonded devices'"
)
ACTIONS = {
    "bt_off": ["cmd bluetooth_manager disable"],
    "bt_on": ["cmd bluetooth_manager enable"],
    "keyboard": ["settings put secure show_ime_with_hard_keyboard 1"],
    "wake": ["input keyevent 224"],
    "rights": ["appops set com.freekiosk android:get_usage_stats allow; "
               "pm grant com.freekiosk android.permission.WRITE_SECURE_SETTINGS; "
               "dumpsys deviceidle whitelist +com.freekiosk; "
               "settings put secure show_ime_with_hard_keyboard 1"],
}
ADB_LOCK = threading.Lock()


def find_apk():
    apks = [os.path.join(ROOT, f) for f in os.listdir(ROOT) if f.lower().endswith(".apk")]
    return max(apks, key=os.path.getmtime) if apks else None


def lan_addresses():
    found = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        found.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append(info[4][0])
    except OSError:
        pass
    out = []
    for a in found:
        if a.startswith("127.") or a.startswith("169.254.") or a in [x["address"] for x in out]:
            continue
        out.append({"address": a, "name": "", "wifi": False})
    return out


def load_config():
    path = os.path.join(ROOT, "config.json")
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        print(f"  config.json konnte nicht gelesen werden: {e}")
        return {}


# ---------------------------------------------------------------- adb
def find_adb():
    exe = "adb.exe" if os.name == "nt" else "adb"
    home = os.path.expanduser("~")
    candidates = [
        os.path.join(ROOT, exe),
        os.path.join(ROOT, "platform-tools", exe),
        shutil.which("adb") or "",
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Android", "Sdk", "platform-tools", exe),
        os.path.join(home, "Library", "Android", "sdk", "platform-tools", exe),
        os.path.join(home, "Android", "Sdk", "platform-tools", exe),
        os.path.join(home, "Downloads", "platform-tools", exe),
    ]
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    return ""


def adb(exe, args, serial=None, timeout=15, stdout_only=False):
    cmd = [exe] + (["-s", serial] if serial else []) + list(args)
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, creationflags=flags,
                           encoding="utf-8", errors="replace")
    except subprocess.TimeoutExpired:
        return 124, "adb antwortet nicht"
    return r.returncode, (r.stdout or "") + ("" if stdout_only else (r.stderr or ""))


def parse_info(serial, out):
    parts = [p.strip() for p in out.split("---")]
    while len(parts) < 9:
        parts.append("")
    d = {"serial": serial, "state": "device", "name": "", "model": "", "btOn": None, "battery": None,
         "freekiosk": None, "idle": False, "ime": False, "secure": False, "bonded": []}
    name = parts[0]
    d["name"] = "" if name in ("null", "") else name
    d["model"] = parts[1]
    d["btOn"] = parts[2] == "1" if parts[2] in ("0", "1") else None
    m = re.search(r"(\d+)", parts[3])
    d["battery"] = int(m.group(1)) if m else None
    d["freekiosk"] = ("package:" + PKG) in parts[4]
    d["idle"] = parts[5].strip().isdigit() and int(parts[5].strip()) > 0
    d["ime"] = parts[6].strip() == "1"
    d["secure"] = parts[7].strip().isdigit() and int(parts[7].strip()) > 0
    started, seen = False, set()
    for line in parts[8].splitlines():
        if "Bonded devices" in line:
            started = True
            continue
        if not started:
            continue
        m = BONDED_RE.search(line)
        if not m:
            break
        if m.group(1) not in seen:
            seen.add(m.group(1))
            d["bonded"].append({"address": m.group(1), "name": m.group(2).strip()})
    return d


def usb_list():
    exe = find_adb()
    result = {"adb": exe, "devices": []}
    if not exe:
        return result
    with ADB_LOCK:
        # stdout only: a starting adb daemon reports on stderr
        code, out = adb(exe, ["devices"], timeout=10, stdout_only=True)
        for line in out.splitlines()[1:]:
            parts = line.split()
            if len(parts) < 2 or not SERIAL_RE.match(parts[0]):
                continue
            if parts[1] != "device":
                result["devices"].append({"serial": parts[0], "state": parts[1]})
                continue
            _, info = adb(exe, ["shell", INFO_CMD], serial=parts[0], timeout=15, stdout_only=True)
            result["devices"].append(parse_info(parts[0], info))
    return result


def usb_run(body):
    exe = find_adb()
    if not exe:
        raise ValueError("adb fehlt")
    serial = str(body.get("serial", ""))
    action = str(body.get("action", ""))
    if not SERIAL_RE.match(serial):
        raise ValueError("Ungültiges Gerät")
    if action == "pin":
        pin = str(body.get("pin", ""))
        if not re.fullmatch(r"\d{4,6}", pin):
            raise ValueError("PIN: 4 bis 6 Ziffern")
        steps = [f"input text {pin}", "input keyevent 66"]
    elif action in ACTIONS:
        steps = ACTIONS[action]
    else:
        raise ValueError("Unbekannte Aktion")
    output = ""
    with ADB_LOCK:
        for step in steps:
            code, out = adb(exe, ["shell", step], serial=serial, timeout=20)
            output += out
            if code != 0:
                raise RuntimeError(out.strip().splitlines()[-1] if out.strip() else f"adb-Fehler {code}")
    return {"ok": True, "output": output.strip()}


def get_adb():
    plat = "windows" if os.name == "nt" else ("darwin" if sys.platform == "darwin" else "linux")
    url = f"https://dl.google.com/android/repository/platform-tools-latest-{plat}.zip"
    with urllib.request.urlopen(url, timeout=120) as r:
        data = r.read()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        z.extractall(ROOT)
    exe = os.path.join(ROOT, "platform-tools", "adb.exe" if os.name == "nt" else "adb")
    if os.name != "nt" and os.path.exists(exe):
        os.chmod(exe, os.stat(exe).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    if not os.path.isfile(exe):
        raise RuntimeError("adb nicht im Paket gefunden")
    return {"ok": True, "adb": exe}


# ---------------------------------------------------------------- http
class Handler(SimpleHTTPRequestHandler):
    apk_path = None
    info = {}
    port = 0

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass

    def _send_bytes(self, body, ctype, head_only, code=200):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def _json(self, obj, code=200, head_only=False):
        self._send_bytes(json.dumps(obj).encode("utf-8"), "application/json; charset=utf-8", head_only, code)

    def _local_only(self):
        """USB endpoints: only this computer, only under a loopback host name (no DNS rebinding)."""
        if self.client_address[0] not in LOOPBACK:
            return False
        host = (self.headers.get("Host") or "").lower()
        allowed = {f"localhost:{self.port}", f"127.0.0.1:{self.port}", f"[::1]:{self.port}"}
        if host not in allowed:
            return False
        origin = self.headers.get("Origin")
        if origin and origin.lower().split("://", 1)[-1] not in allowed:
            return False
        return True

    def _route(self, head_only):
        path = self.path.split("?", 1)[0]
        if path == "/api/info":
            self._json(self.info, head_only=head_only)
            return True
        if path == "/api/usb":
            if not self._local_only():
                self._json({"error": "Nur an diesem Laptop"}, 403, head_only)
                return True
            try:
                self._json(usb_list(), head_only=head_only)
            except Exception as e:  # noqa: BLE001 - shown in the page
                self._json({"error": str(e)}, 500, head_only)
            return True
        if path == "/freekiosk.apk":
            size = os.path.getsize(self.apk_path)
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.android.package-archive")
            self.send_header("Content-Length", str(size))
            self.end_headers()
            if not head_only:
                try:
                    with open(self.apk_path, "rb") as f:
                        while True:
                            chunk = f.read(65536)
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    print(f"  {time.strftime('%H:%M:%S')}  Verbindung zu {self.client_address[0]} abgebrochen")
                    return True
                if self.client_address[0] not in LOOPBACK:
                    print(f"  {time.strftime('%H:%M:%S')}  {self.client_address[0]} hat die App geladen")
            return True
        return False

    def do_GET(self):
        if not self._route(False):
            super().do_GET()

    def do_HEAD(self):
        if not self._route(True):
            super().do_HEAD()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path not in ("/api/usb/run", "/api/usb/adb"):
            self._json({"error": "Nicht gefunden"}, 404)
            return
        if not self._local_only() or self.headers.get("X-Kit") != "1":
            self._json({"error": "Nur an diesem Laptop"}, 403)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length > 4096:
            self._json({"error": "Zu groß"}, 413)
            return
        try:
            body = json.loads(self.rfile.read(length) or b"{}") if length else {}
            if not isinstance(body, dict):
                raise ValueError("Ungültige Anfrage")
            result = usb_run(body) if path == "/api/usb/run" else get_adb()
            self._json(result)
        except ValueError as e:
            self._json({"error": str(e)}, 400)
        except Exception as e:  # noqa: BLE001 - shown in the page
            self._json({"error": str(e)}, 500)


def main():
    parser = argparse.ArgumentParser(description="inDiKo Kit")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    apk = find_apk()
    if not apk:
        print(f"\n  Keine .apk-Datei im Ordner gefunden.\n  Bitte die FreeKiosk-APK neben Start.bat legen: {ROOT}")
        return 2

    server = None
    port = args.port
    for p in range(args.port, args.port + 20):
        try:
            server = ThreadingHTTPServer(("0.0.0.0", p), partial(Handler, directory=WEB))
            port = p
            break
        except OSError:
            continue
    if not server:
        print(f"  Kein freier Port zwischen {args.port} und {args.port + 19}.")
        return 3

    config = load_config()
    addresses = lan_addresses()
    Handler.apk_path = apk
    Handler.port = port
    Handler.info = {
        "port": port,
        "apkName": os.path.basename(apk),
        "apkSize": os.path.getsize(apk),
        "version": config.get("version"),
        "releaseUrl": config.get("releaseUrl"),
        "ips": addresses,
        "server": "python",
    }

    print("\n  inDiKo Kit laeuft.")
    print(f"  App:          {os.path.basename(apk)}  ({os.path.getsize(apk) / 1048576:.1f} MB)")
    print(f"  Oberflaeche:  http://localhost:{port}/")
    for a in addresses:
        print(f"  Fuer Tablets: http://{a['address']}:{port}/freekiosk.apk")
    print("\n  Dieses Fenster offen lassen, solange Tablets eingerichtet werden.")
    print("  Beenden mit Strg+C.\n")

    if not args.no_browser:
        webbrowser.open(f"http://localhost:{port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
