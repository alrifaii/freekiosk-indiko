// Puck.js als Taster fuer AsTeRICS Grid, ohne dass die Bildschirmtastatur verschwindet.
//
// Warum: Android blendet die Bildschirmtastatur aus, sobald eine Tastatur mit
// Buchstaben verbunden ist. Gepruft wird nur, ob das Geraet die Taste "Q" hat.
// Dieser Taster meldet sich deshalb nur mit Tasten ohne Buchstaben und Ziffern an
// (Enter, Leertaste, Tab, Satzzeichen, F1 bis F12). Er tippt weiter Leertaste und
// Enter, gilt fuer Android aber nicht als Tastatur. Die Bildschirmtastatur bleibt.
//
// Einspielen, ohne Kabel:
//   1. https://www.espruino.com/ide in Chrome oeffnen, "Connect" > Puck.js waehlen
//   2. Diesen Code rechts einfuegen, "Send to Espruino", dann links save() eingeben
//   3. Am Tablet den Puck.js einmal entfernen und neu koppeln (im Kit unter Tablets >
//      Bluetooth), denn Android merkt sich die alte Tastenliste.
//   4. In AsTeRICS Grid unter Eingabe > Scanning: Leertaste = weiter, Enter = auswaehlen.

var KEY = { ENTER: 0x28, SPACE: 0x2C, TAB: 0x2B, F1: 0x3A, F2: 0x3B };

// Standard-Tastaturbeschreibung (wie das Espruino-Modul ble_hid_keyboard). Einziger
// Unterschied ist der Tastenbereich unten: 0x28 bis 0x45 statt 0x00 bis 0x73.
// Buchstaben liegen bei 0x04 bis 0x1D, Ziffern bei 0x1E bis 0x27, Pfeile ab 0x4F.
var report = new Uint8Array([
  0x05, 0x01,       // Usage Page (Generic Desktop)
  0x09, 0x06,       // Usage (Keyboard)
  0xA1, 0x01,       // Collection (Application)
  0x05, 0x07,       //   Usage Page (Key Codes)
  0x19, 0xE0,       //   Usage Minimum (224, Strg/Umschalt/Alt/Win)
  0x29, 0xE7,       //   Usage Maximum (231)
  0x15, 0x00,       //   Logical Minimum (0)
  0x25, 0x01,       //   Logical Maximum (1)
  0x75, 0x01,       //   Report Size (1)
  0x95, 0x08,       //   Report Count (8)
  0x81, 0x02,       //   Input (Data, Variable, Absolute)  Modifier-Byte
  0x95, 0x01,       //   Report Count (1)
  0x75, 0x08,       //   Report Size (8)
  0x81, 0x01,       //   Input (Constant)  reserviertes Byte
  0x95, 0x05,       //   Report Count (5)
  0x75, 0x01,       //   Report Size (1)
  0x05, 0x08,       //   Usage Page (LEDs)
  0x19, 0x01,       //   Usage Minimum (1)
  0x29, 0x05,       //   Usage Maximum (5)
  0x91, 0x02,       //   Output (Data, Variable, Absolute)  LEDs
  0x95, 0x01,       //   Report Count (1)
  0x75, 0x03,       //   Report Size (3)
  0x91, 0x01,       //   Output (Constant)  Fuellbits
  0x95, 0x06,       //   Report Count (6)
  0x75, 0x08,       //   Report Size (8)
  0x15, 0x28,       //   Logical Minimum (0x28, Enter)      <- geaendert
  0x25, 0x45,       //   Logical Maximum (0x45, F12)        <- geaendert
  0x05, 0x07,       //   Usage Page (Key Codes)
  0x19, 0x28,       //   Usage Minimum (0x28)               <- geaendert
  0x29, 0x45,       //   Usage Maximum (0x45)               <- geaendert
  0x81, 0x00,       //   Input (Data, Array)  sechs Tasten
  0xC0              // End Collection
]);

NRF.setServices(undefined, { hid: report });

function tap(key) {
  try {
    NRF.sendHIDReport([0, 0, key, 0, 0, 0, 0, 0], function () {
      NRF.sendHIDReport([0, 0, 0, 0, 0, 0, 0, 0]);
    });
    LED2.set();
    setTimeout(function () { LED2.reset(); }, 80);
  } catch (e) {
    // Nicht verbunden: kurz rot
    LED1.set();
    setTimeout(function () { LED1.reset(); }, 300);
  }
}

// Kurz druecken = Leertaste (weiter), lang druecken (ab 0,8 s) = Enter (auswaehlen).
var pressedAt = 0;
setWatch(function (e) {
  if (e.state) { pressedAt = e.time; return; }
  tap(e.time - pressedAt >= 0.8 ? KEY.ENTER : KEY.SPACE);
}, BTN, { edge: "both", repeat: true, debounce: 30 });
