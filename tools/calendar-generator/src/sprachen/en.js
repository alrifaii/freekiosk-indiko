// English
// "oberflaeche" = texts of the web page, "kalender" = texts written into the Asterics grids.
// Placeholders in {curly braces} are replaced when displayed.

export default {
  code: 'en',
  name: 'English',
  locale: 'en-GB',

  oberflaeche: {
    titel: 'Calendar generator for Asterics AAC',
    untertitel: 'Creates linked calendar grids as a file you can import into Asterics AAC.',
    seitenSprache: 'Page language',

    ansichtenTitel: 'Which grids do you want?',
    ansichten: {
      uebersicht: { name: 'Overview', text: '"Today is …" and months' },
      monat: { name: 'Month', text: 'one grid per month' },
      woche: { name: 'Week', text: 'one grid per week' },
      tag: { name: 'Day', text: 'one grid per day' }
    },
    tagGenauer: 'One day in detail',
    tagDrei: 'Yesterday · Today · Tomorrow',
    felderProAbschnitt: 'Cells per part of the day',
    ansichtenHinweis: 'Enabled views are linked with buttons on every grid.',

    artTitel: 'Type',
    arten: {
      abschnitte: { name: 'Weekly plan', text: 'Parts of the day with symbols.' },
      stundenplan: { name: 'Timetable', text: 'Lessons with times.' }
    },

    zeitraumTitel: 'Period',
    von: 'From',
    bis: 'To',
    dieserMonat: 'This month',
    bisJahresende: 'Until end of year',
    schuljahr: 'School year',
    wochenende: 'Show weekend',

    abschnitteTitel: 'Parts of the day',
    abschnitteHinweis: 'The name is edited in the grid language ({sprache}).',
    abschnittName: 'Name',
    abschnittHinzufuegen: '+ Part of the day',
    symbolWechseln: 'Change symbol',
    entfernen: 'Remove',

    einheitenTitel: 'Lessons',
    anzahl: 'Number',
    beginn: 'Start',
    dauer: 'Length (min)',
    pause: 'Break (min)',
    anordnung: 'Layout of the week',
    tageZeilen: 'Days in rows, times in columns',
    tageSpalten: 'Days in columns, times in rows',

    symboleTitel: 'Symbols (ARASAAC)',
    suchePlatzhalter: 'Search symbol, e.g. school',
    suchen: 'Search',
    vorschlaege: ['School', 'Eat', 'Swim', 'Doctor', 'Therapy', 'Bus', 'Play', 'Shopping', 'Grandmother', 'Sleep'],
    sucheLaeuft: 'Searching …',
    nichtsGefunden: 'Nothing found, try another word.',
    arasaacFehler: 'ARASAAC cannot be reached. Are you online?',
    neueWiederholen: 'Repeat new symbols',
    lizenz: 'Symbols by ARASAAC, licence CC BY-NC-SA, arasaac.org',
    wiederholungen: {
      einmal: 'Only once',
      woche: 'Every week',
      zweiWochen: 'Every 2 weeks',
      werktag: 'Every weekday (Mon–Fri)'
    },

    feiertageTitel: 'Public holidays',
    feiertageFuer: 'Show public holidays for',
    feiertagLaender: { '': 'None', at: 'Austria', cz: 'Czech Republic' },
    feiertageAuslassen: 'Skip repeated events on public holidays',

    aussehenTitel: 'Appearance',
    farbigeTage: 'Coloured weekdays',
    eigeneSymbole: 'Own symbols for arrows and parts of the day',

    vorschau: 'Preview',
    vorherigeSeite: 'Previous page',
    naechsteSeite: 'Next page',
    gridSprache: 'Grid language',
    gridSpracheHinweis: 'The file contains all languages. Asterics shows the language set in its settings.',

    rueckgaengig: '↶ Undo',
    wiederholen: '↷ Redo',
    seiteLeeren: 'Clear this page',
    seiteLeerenHinweis: 'Remove events on this page, series stay in other weeks',
    alleLoeschen: 'Delete all events',
    wirklichLoeschen: 'Really delete all {anzahl}?',
    ja: 'Yes, delete',
    nein: 'No',

    nurHierEntfernen: 'Remove only on this day',
    nurAmEntfernen: 'Remove only on {datum}',
    terminLoeschen: 'Delete event',
    serieLoeschen: 'Delete whole series',
    fertig: 'Done',
    textIn: 'Text {sprache}',
    wiederholung: 'Repeat',
    ab: 'from {datum}',
    ausnahmen: '{anzahl} exception(s)',
    zuruecksetzen: 'reset',
    gewaehlt: '"{name}" selected ({wiederholung}). Now tap a cell.',
    tipps: [
      'Drag a symbol onto a cell, or tap it and then tap the cell',
      'Click an event to edit it · ✕ removes it only on this day',
      'Drag an event to another cell to move it · blue cells turn pages'
    ],

    herunterladen: '⬇ Create and download file',

    anTablets: '➜ Send to tablets',
    statistik: '{grids} grids · approx. {kb} KB · {termine} events · page {seite} of {seiten}',
    importTitel: 'How to import the file into Asterics AAC',
    importSchritte: [
      'Open "Manage grids" and tap "more" in the top right corner.',
      'Choose "Import custom data from file" and select the .grd file.',
      'In your home grid add an element with the action "Navigate to grid" pointing to the calendar.'
    ],
    importWarnung: 'Do not use "Restore backup from file", it deletes all existing grids.',

    fehlerKeineAnsicht: 'Please select at least month, week or day.',
    fehlerZuViele: 'That would be {anzahl} grids. Please choose a shorter period or fewer views (max. {max}).'
  },

  kalender: {
    kalender: 'Calendar',
    kw: 'Wk',
    kwSprechen: 'Week',
    uebersicht: 'Overview',
    monat: 'Month',
    woche: 'Week',
    tag: 'Day',
    gestern: 'Yesterday',
    heute: 'Today',
    morgen: 'Tomorrow',
    heuteIst: 'Today is {0}',
    wocheVonBis: 'Week from {von} to {bis}',
    abschnitte: { morgen: 'Morning', vormittag: 'Late morning', mittag: 'Midday', nachmittag: 'Afternoon', abend: 'Evening', nacht: 'Night' }
  }
}
