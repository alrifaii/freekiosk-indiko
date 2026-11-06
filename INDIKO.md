# inDiKo-Änderungen an FreeKiosk

Dieses Repo ist ein Fork von [FreeKiosk](https://github.com/RushB-fr/freekiosk) (MIT-Lizenz) für das Projekt inDiKo an der FH Technikum Wien. Grundlage ist FreeKiosk 2.1.0-beta.1, Commit `6507d53` vom 26.10.2026. Hier steht, was wir dazugebaut oder geändert haben und warum, damit man es prüfen und begründen kann, ohne ganz FreeKiosk zu lesen.

## Die drei Teile

```
 Master (Laptop)                 MQTT-Server                Tablet
 eine Webseite im Browser  <-->  broker.emqx.io      <-->  FreeKiosk-APK
 tools/provisioning-kit          (nicht unser Code)        zeigt AsTeRICS Grid

                 GitHub baut die APK (Tag v…-qrN) und legt sie unter Releases ab.
                 Beim Einrichten lädt das Tablet sie von dort (Link im QR-Code).
```

- **Tablet-App (APK)** ist FreeKiosk mit unseren Ergänzungen, also alles außer `tools/`. Neu geschriebene Teile liegen in eigenen Ordnern, in Original-Dateien gibt es nur Einstiegspunkte.
- **Master** ist das inDiKo Kit in `tools/provisioning-kit`. Es ist kein Python und kein Server, sondern eine Webseite aus HTML und JavaScript, die direkt per WebSocket mit dem MQTT-Server spricht. `Start.bat` öffnet sie nur im Browser.
- **Build** ist `.github/workflows/build-provisioning-apk.yml`. Er baut die APK, packt das Kit als ZIP und schreibt Link und Prüfsumme der APK in `web/config.js` des Kits. Die Prüfsumme rechnet `.github/scripts/apk-signature-checksum.py` aus.

## Wo was liegt

```
android/app/src/main/java/com/freekiosk/
├─ indiko/                        NEU, alles von uns
│  ├─ AdminSignature.kt           signierte Befehle (Schlüssel aus dem QR-Code)
│  ├─ BluetoothMqttBridge.kt      Bluetooth über MQTT (Taster koppeln)
│  ├─ WifiNetworksBridge.kt       weitere WLANs speichern
│  └─ speech/                     TTS: FreeKiosk spricht selbst
│     ├─ SpeechHub.kt             eine Sprachausgabe für Webseite, MQTT und REST
│     ├─ EmbeddedVoices.kt        eingebaute Offline-Stimmen laden und sprechen
│     ├─ SpeechModule.kt          Verbindung zu React Native (FreeKioskSpeech)
│     ├─ TarExtractor.java        Stimmen-Archive auspacken (.tar)
│     └─ Bzip2InputStream.java    … und entpacken (.bz2)
├─ mqtt/MqttModule.kt             geändert, ruft indiko/ auf
├─ mqtt/KioskMqttClient.kt        geändert, neue MQTT-Befehle, Reconnect
├─ MainActivity.kt                geändert, Einstellungen aus dem QR-Code
├─ DeviceAdminReceiver.kt         geändert, Einstellungen aus dem QR-Code merken
├─ PolicyComplianceActivity.kt    geändert, dasselbe für neuere Android-Versionen
├─ MainApplication.kt             geändert, Sprachausgabe anmelden
└─ api/HttpServerModule.kt        geändert, REST-tts über SpeechHub
android/app/src/main/java/com/k2fsa/sherpa/onnx/Tts.kt   NEU, unverändert aus sherpa-onnx
android/app/build.gradle          geändert, sherpa-Bibliothek holen, Build-Nummer
src/indiko/speechBridge.ts        NEU, speechSynthesis für AsTeRICS im WebView
src/components/WebViewComponent.tsx   geändert, Sprachbrücke statt FreeKiosk-Polyfill
src/components/PinInput.tsx       geändert, Ziffernfeld für die PIN
src/screens/KioskScreen.tsx       geändert, MQTT bleibt verbunden, Seite öffnen
tools/provisioning-kit/           NEU, der Master
.github/workflows/build-provisioning-apk.yml   NEU, Build
docs/MQTT.md                      ergänzt, neue Befehle mit (inDiKo) markiert
```

Jede Stelle, an der wir eine Original-Datei von FreeKiosk anfassen, trägt das Wort `inDiKo` im Kommentar. Eine Suche nach `inDiKo` (in VS Code Strg+Umschalt+F) zeigt also alle Eingriffe.

## Was an FreeKiosk anders ist und warum

### 1. Einrichten per QR-Code mit allen Einstellungen

Android übergibt beim Einrichten per QR-Code einen Block mit Zusatzdaten an die App. FreeKiosk hat davon nur die Cloud-Anmeldung gelesen. Wir merken uns die übrigen Werte (`DeviceAdminReceiver.persistProvisioningConfig`, auch aus `PolicyComplianceActivity`) und spielen sie beim ersten Start durch denselben Weg wie eine Einrichtung per ADB (`MainActivity.applyProvisioningConfig` → `handleAdbConfig`). So gelten dieselben Regeln, etwa dass eine PIN Pflicht ist.

Dazu sind einige Schlüssel neu erlaubt. Bildschirmfoto über MQTT, die Schalter am PIN-Bildschirm (`lockscreen_*`), der Kit-Schlüssel `mqtt_admin_key` und weitere WLANs `wifi_more`.

Warum. Ein Tablet soll nach dem Scannen fertig sein, ohne Laptop-Kabel und ohne ADB.

### 2. Sprachausgabe (TTS)

FreeKiosk hatte eine eigene `speechSynthesis` für Webseiten (Polyfill in `WebViewComponent.tsx`). Sie hat das Ende einer Ansage nur geschätzt, kannte nur die Standard-Sprachausgabe von Android und konnte keine Offline-Stimmen, die nicht als Android-Sprachausgabe installiert sind.

Wir ersetzen sie durch eine Sprachbrücke (`src/indiko/speechBridge.ts`) und eine native Sprachausgabe (`indiko/speech/SpeechHub.kt`).
- Webseiten (AsTeRICS Grid), der MQTT-Befehl `tts` und die REST-API sprechen alle über dieselbe Stelle.
- Stimmen kommen von zwei Seiten zugleich. Eingebaute Offline-Stimmen (sherpa-onnx mit Piper- und Coqui-Modellen, `EmbeddedVoices.kt`) und alle Android-Sprachausgaben wie Samsung und Google, jede einzeln über ihren Paketnamen.
- Start, Ende und Fehler einer Ansage kommen als echte Ereignisse zurück, so wie die Web Speech API es vorsieht.
- Eingebaute Stimmen lädt das Tablet selbst von GitHub (sherpa-onnx Releases) und entpackt sie. Danach sprechen sie ohne Internet.
- Die native Bibliothek (`libsherpa-onnx-jni.so`, nur arm64) holt `build.gradle` beim Bauen und prüft ihre SHA-256. `Tts.kt` ist die passende Kotlin-Seite, unverändert übernommen, weil die Bibliothek diese Klassen beim Namen sucht (`proguard-rules.pro` schützt sie).

Warum. Der Browser in Android (auch in FreeKiosk) sieht nur die Stimmen der Standard-Sprachausgabe und übergeht Sprachausgaben ohne Länderangabe. AsTeRICS konnte deshalb keine Offline-Stimme verwenden. Mit der Sprachbrücke muss in Android nichts umgestellt werden und eine eigene Stimmen-App braucht es nicht.

Für alle FreeKiosk-Nutzer ändert sich dadurch, dass Webseiten im WebView diese `speechSynthesis` bekommen und `tts` über SpeechHub läuft. Scheitert SpeechHub bei REST, nimmt `HttpServerModule` den alten Weg.

### 3. Bedienung mit Tastern

- **PIN-Ziffernfeld** (`PinInput.tsx`). Ein Bluetooth-Taster meldet sich als Tastatur an. Android blendet dann die Bildschirmtastatur aus, und die PIN ließ sich nicht mehr eingeben. Bei Ziffern-PINs zeigt FreeKiosk jetzt ein eigenes Tastenfeld.
- **Bildschirmtastatur neben Tastern** (`MainActivity.ensureImeWithHardKeyboard`). Setzt `show_ime_with_hard_keyboard`, damit Eingabefelder ihre Tastatur behalten. Wirkt nur, wenn FreeKiosk einmal per WLAN-Debugging das Recht `WRITE_SECURE_SETTINGS` bekommen hat, sonst tut es nichts.

### 4. MQTT bleibt verbunden

- `KioskMqttClient.kt` versucht es auch dann erneut, wenn schon die erste Verbindung scheitert (nach dem Einschalten ist oft noch kein WLAN da). Vorher blieb das Tablet offline, bis jemand in den Einstellungen „Verbinden“ drückte.
- `KioskScreen.tsx` behält MQTT beim Neuaufbau des Bildschirms (nach dem Einspielen der QR-Einstellungen startet die App neu, und der alte Bildschirm hat MQTT dabei abgeschaltet). Dazu kommt eine Überwachung, die nach zwei Fehlversuchen neu verbindet.
- Nach dem Einrichten fragt FreeKiosk einmal nach der Ausnahme von der Akku-Optimierung. Ohne sie legt Android die App schlafen, samt Netzwerk. Der Status meldet das als `device.batteryExempt`, der Master kann die Frage mit `battery_exempt` erneut stellen.

### 5. Neue Fernsteuerung über MQTT

Alle neuen Befehle stehen in `docs/MQTT.md` mit „(inDiKo)“.
- **Bluetooth** `bt_power`, `bt_scan`, `bt_pair`, `bt_unpair` und der Block `bluetooth` im Status. So koppelt man Taster vom Laptop aus.
- **Weitere WLANs** `wifi_add`, `wifi_remove` und `wifiNetworks` im Status. Das Tablet wechselt selbst, wenn ein WLAN ausfällt. Das Passwort geht verschlüsselt.
- **Stimmen** `voice_install`, `voice_remove`, `voice_prefer`, `voice_data` (öffnet die Download-Seite von Samsung oder Google), `speech_stop` und der Block `speech` im Status.
- **Seite öffnen** über den vorhandenen Befehl `url`. Neu ist, dass bei aktivem „Nur Start-Seite“ die neue Seite samt Unterseiten freigegeben wird, und dass der Status die wirklich offene Seite (`currentUrl`) und die Start-Seite (`startUrl`) getrennt meldet.
- **Build-Nummer** `device.build` im Status (der Tag, zum Beispiel `v2.1.0-beta.1-qr11`). `device.version` ist für alle qr-Builds gleich.

Die URL-Freigabe `https://*.beispiel.at/*` passt jetzt nur noch auf Subdomains und nicht mehr auf beliebige Pfade (`WebViewComponent.tsx`). Das ist eine Sicherheitskorrektur für alle Nutzer.

### 6. Signierte Befehle

Der MQTT-Server kann öffentlich sein. Befehle, die das Tablet selbst verändern (Stimmen laden oder entfernen, WLANs speichern, Download-Seite öffnen), tragen deshalb eine HMAC-SHA256-Unterschrift mit dem Kit-Schlüssel (`AdminSignature.kt`). Der Schlüssel kommt nur über den QR-Code aufs Tablet und geht nie über MQTT. Jeder Befehl gilt einmal und höchstens 15 Minuten. WLAN-Passwörter sind zusätzlich mit AES-256-GCM verschlüsselt.

## Der Master (inDiKo Kit)

```
tools/provisioning-kit/
├─ Start.bat              öffnet web/index.html im Browser
├─ LIESMICH.txt           Anleitung für die Schule
├─ taster/puck-taster.js  Programm für einen Puck.js-Taster
└─ web/
   ├─ index.html          Oberfläche und Aussehen
   ├─ app.js              Navigation, Bereich „Einrichten“ (QR-Code)
   ├─ provisioning.js     baut den Inhalt des QR-Codes
   ├─ tablets.js          Bereich „Tablets“, steuert AsTeRICS, Stimmen, WLAN, Bluetooth
   ├─ grids.js            Bereich „Grids“, Dateien und Add-ons an Tablets senden
   ├─ mqtt.js             kleiner MQTT-Client über WebSocket
   ├─ config.js           Link und Prüfsumme der APK (schreibt der Build)
   └─ qrcode.js           fremde Bibliothek (Kazuhiko Arase, MIT)
```

Add-ons sind Webseiten, die man per Link im Master hinzufügt. Sie laufen dort in einem Rahmen und können fertige Grids an die Tablets geben. Der Kalender-Generator ist so ein Add-on und liegt in einem eigenen Repo.

## Beim Aufräumen entfernt (qr11)

- Der Master liefert keine APK mehr aus. Dadurch fiel der Server weg (`server.ps1`, `server.py`, `start.command`, der Windows-Test im Build).
- Der alte Stimmen-Weg mit eigener sherpa-App (`TtsPackageBridge.kt`, Befehle `tts_install`, `tts_uninstall`, `tts_engine`). Seit qr9 spricht FreeKiosk selbst. Tablets, bei denen damals Samsung oder Google versteckt wurden, bekommen sie beim ersten Start wieder (`SpeechHub.unhideOldEngines`).
- Der Schalter für die Sprachbrücke (`speech_bridge`).
- Der Kalender-Generator (`tools/calendar-generator`, `web/kalender`). Er ist jetzt ein eigenes Projekt und ein Add-on.
- `tools/dev/Test-Tablet.ps1`, weil die APK über GitHub gebaut wird.

## Neue FreeKiosk-Versionen übernehmen

Konflikte kann es nur in den Original-Dateien mit `inDiKo` geben, die Ordner `indiko/` gehören ganz uns.

```
git remote add upstream https://github.com/RushB-fr/freekiosk.git
git fetch upstream
git merge upstream/main
```
