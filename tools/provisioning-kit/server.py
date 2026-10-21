#!/usr/bin/env python3
"""FreeKiosk QR-Kit - kleiner Webserver fuer macOS, Linux (und Windows mit Python).

Liefert die Oberflaeche (web/) und die FreeKiosk-APK an Browser und Tablets aus.
Gleiche Endpunkte wie server.ps1: /, /api/info, /freekiosk.apk.
"""
import argparse
import json
import os
import socket
import sys
import time
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")


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


class Handler(SimpleHTTPRequestHandler):
    apk_path = None
    info = {}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass

    def _send_bytes(self, body, ctype, head_only):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def _route(self, head_only):
        path = self.path.split("?", 1)[0]
        if path == "/api/info":
            self._send_bytes(json.dumps(self.info).encode("utf-8"), "application/json; charset=utf-8", head_only)
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
                if not self.client_address[0].startswith("127."):
                    print(f"  {time.strftime('%H:%M:%S')}  {self.client_address[0]} hat die App geladen")
            return True
        return False

    def do_GET(self):
        if not self._route(False):
            super().do_GET()

    def do_HEAD(self):
        if not self._route(True):
            super().do_HEAD()


def main():
    parser = argparse.ArgumentParser(description="FreeKiosk QR-Kit")
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
    Handler.info = {
        "port": port,
        "apkName": os.path.basename(apk),
        "apkSize": os.path.getsize(apk),
        "version": config.get("version"),
        "releaseUrl": config.get("releaseUrl"),
        "ips": addresses,
        "server": "python",
    }

    print("\n  FreeKiosk QR-Kit laeuft.")
    print(f"  App:         {os.path.basename(apk)}  ({os.path.getsize(apk) / 1048576:.1f} MB)")
    print(f"  Oberflaeche: http://localhost:{port}/")
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
