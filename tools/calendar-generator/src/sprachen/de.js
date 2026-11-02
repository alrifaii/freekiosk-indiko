// Deutsch
// "oberflaeche" = Texte der Webseite, "kalender" = Texte, die in die Asterics-Grids geschrieben werden.
// Platzhalter in {geschweiften Klammern} werden beim Anzeigen ersetzt.

export default {
  code: 'de',
  name: 'Deutsch',
  locale: 'de-AT', // für Wochentage, Monate und Datumsformat

  oberflaeche: {
    titel: 'Kalender-Generator für Asterics AAC',
    untertitel: 'Erzeugt fertig verlinkte Kalender-Grids als Datei, die du in Asterics AAC importierst.',
    seitenSprache: 'Sprache der Seite',

    ansichtenTitel: 'Welche Grids willst du?',
    ansichten: {
      uebersicht: { name: 'Übersicht', text: '„Heute ist …" und Monate' },
      monat: { name: 'Monat', text: 'ein Grid pro Monat' },
      woche: { name: 'Woche', text: 'ein Grid pro Woche' },
      tag: { name: 'Tag', text: 'ein Grid pro Tag' }
    },
    tagGenauer: 'Ein Tag genauer',
    tagDrei: 'Gestern · Heute · Morgen',
    felderProAbschnitt: 'Felder pro Abschnitt im Tag',
    ansichtenHinweis: 'Eingeschaltete Ansichten sind auf jedem Grid mit Buttons verbunden.',

    artTitel: 'Art',
    arten: {
      abschnitte: { name: 'Wochenplan', text: 'Tagesabschnitte mit Symbolen.' },
      stundenplan: { name: 'Stundenplan', text: 'Einheiten mit Uhrzeit.' }
    },

    zeitraumTitel: 'Zeitraum',
    von: 'Von',
    bis: 'Bis',
    dieserMonat: 'Dieser Monat',
    bisJahresende: 'Bis Jahresende',
    schuljahr: 'Schuljahr',
    wochenende: 'Wochenende anzeigen',

    abschnitteTitel: 'Tagesabschnitte',
    abschnitteHinweis: 'Der Name wird in der Grid-Sprache bearbeitet ({sprache}).',
    abschnittName: 'Name',
    abschnittHinzufuegen: '+ Abschnitt',
    symbolWechseln: 'Symbol wechseln',
    entfernen: 'Entfernen',

    einheitenTitel: 'Einheiten',
    anzahl: 'Anzahl',
    beginn: 'Beginn',
    dauer: 'Dauer (Min.)',
    pause: 'Pause (Min.)',
    anordnung: 'Anordnung in der Woche',
    tageZeilen: 'Tage untereinander, Uhrzeiten nebeneinander',
    tageSpalten: 'Tage nebeneinander, Uhrzeiten untereinander',

    symboleTitel: 'Symbole (ARASAAC)',
    suchePlatzhalter: 'Symbol suchen, z. B. Schule',
    suchen: 'Suchen',
    vorschlaege: ['Schule', 'Essen', 'Schwimmen', 'Arzt', 'Therapie', 'Bus', 'Spielen', 'Einkaufen', 'Oma', 'Schlafen'],
    sucheLaeuft: 'Suche läuft …',
    nichtsGefunden: 'Nichts gefunden, probier ein anderes Wort.',
    arasaacFehler: 'ARASAAC ist gerade nicht erreichbar. Bist du online?',
    neueWiederholen: 'Neue Symbole wiederholen',
    lizenz: 'Symbole von ARASAAC, Lizenz CC BY-NC-SA, arasaac.org',
    wiederholungen: {
      einmal: 'Nur einmal',
      woche: 'Jede Woche',
      zweiWochen: 'Alle 2 Wochen',
      werktag: 'Jeden Werktag (Mo–Fr)'
    },

    feiertageTitel: 'Feiertage',
    feiertageFuer: 'Feiertage anzeigen für',
    feiertagLaender: { '': 'Keine', at: 'Österreich', cz: 'Tschechien' },
    feiertageAuslassen: 'Wiederholte Termine an Feiertagen auslassen',

    aussehenTitel: 'Aussehen',
    farbigeTage: 'Farbige Wochentage',
    eigeneSymbole: 'Eigene Symbole für Pfeile und Abschnitte',

    vorschau: 'Vorschau',
    vorherigeSeite: 'Vorherige Seite',
    naechsteSeite: 'Nächste Seite',
    gridSprache: 'Sprache im Grid',
    gridSpracheHinweis: 'Die Datei enthält alle Sprachen. In Asterics wird die Sprache aus den Einstellungen angezeigt.',

    rueckgaengig: '↶ Rückgängig',
    wiederholen: '↷ Wiederholen',
    seiteLeeren: 'Diese Seite leeren',
    seiteLeerenHinweis: 'Termine auf dieser Seite entfernen, Serien bleiben in anderen Wochen',
    alleLoeschen: 'Alle Termine löschen',
    wirklichLoeschen: 'Wirklich alle {anzahl} löschen?',
    ja: 'Ja, löschen',
    nein: 'Nein',

    nurHierEntfernen: 'Nur an diesem Tag entfernen',
    nurAmEntfernen: 'Nur am {datum} entfernen',
    terminLoeschen: 'Termin löschen',
    serieLoeschen: 'Ganze Serie löschen',
    fertig: 'Fertig',
    textIn: 'Text {sprache}',
    wiederholung: 'Wiederholung',
    ab: 'ab {datum}',
    ausnahmen: '{anzahl} Ausnahme(n)',
    zuruecksetzen: 'zurücksetzen',
    gewaehlt: '„{name}" gewählt ({wiederholung}). Jetzt ein Feld antippen.',
    tipps: [
      'Symbol aus der Leiste auf ein Feld ziehen, oder antippen und dann das Feld antippen',
      'Termin anklicken zum Bearbeiten · ✕ entfernt ihn nur an diesem Tag',
      'Termin auf ein anderes Feld ziehen zum Verschieben · blaue Felder blättern'
    ],

    herunterladen: '⬇ Datei erzeugen und herunterladen',

    anTablets: '➜ An Tablets senden',
    statistik: '{grids} Grids · ca. {kb} KB · {termine} Termine · Seite {seite} von {seiten}',
    importTitel: 'So importierst du die Datei in Asterics AAC',
    importSchritte: [
      '„Grids verwalten" öffnen, oben rechts auf „mehr" tippen.',
      '„Benutzerdefinierte Daten aus Datei importieren" wählen und die .grd-Datei auswählen.',
      'Im eigenen Start-Grid ein Element mit der Aktion „Navigieren zu Grid" auf den Kalender anlegen.'
    ],
    importWarnung: 'Nicht „Sicherung aus Datei wiederherstellen" verwenden, das löscht alle bestehenden Grids.',

    fehlerKeineAnsicht: 'Bitte mindestens Monat, Woche oder Tag auswählen.',
    fehlerZuViele: 'Das wären {anzahl} Grids. Bitte einen kürzeren Zeitraum oder weniger Ansichten wählen (max. {max}).'
  },

  kalender: {
    kalender: 'Kalender',
    kw: 'KW',
    kwSprechen: 'Kalenderwoche', // wird statt der Abkürzung vorgelesen
    uebersicht: 'Übersicht',
    monat: 'Monat',
    woche: 'Woche',
    tag: 'Tag',
    gestern: 'Gestern',
    heute: 'Heute',
    morgen: 'Morgen',
    heuteIst: 'Heute ist {0}', // {0} füllt Asterics selbst mit dem heutigen Datum
    wocheVonBis: 'Woche vom {von} bis {bis}',
    abschnitte: { morgen: 'Morgen', vormittag: 'Vormittag', mittag: 'Mittag', nachmittag: 'Nachmittag', abend: 'Abend', nacht: 'Nacht' }
  }
}
