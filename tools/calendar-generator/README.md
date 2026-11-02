# Calendar generator for Asterics AAC

A small web app that creates **linked calendar grids** for [Asterics AAC](https://github.com/asterics/Asterics-AAC) and saves them as a `.grd` file. Any user can import the file. The tedious part of building a calendar by hand (days in the right order, every page linked to the next) is done automatically.

The idea came from LIFEtool (Diakonie, Czech Republic): families asked for a simple visual and talking calendar inside Asterics AAC.

## Features

- **Views**, each optional: overview ("Today is …" and months), month, week, day
  - Day view either *one day in detail* (several cells per part of the day) or *yesterday · today · tomorrow*
  - Every grid has previous/next buttons and buttons to switch to the other views
- **Type**: weekly plan with parts of the day (morning, midday …) or timetable with times (number, start, length, break)
- **Symbols** from [ARASAAC](https://arasaac.org), the same source and file format Asterics AAC uses. Drag them onto a cell or tap symbol and cell
- **Events like in a calendar app**: once, every week, every 2 weeks, every weekday. Remove a single occurrence without touching the series, edit, move, undo/redo, clear a page or everything
- **Public holidays** for Austria and Czech Republic, highlighted and optionally skipped by repeating events
- **Languages**: German, English, Czech
  - the *page language* switches the web app
  - the *grid language* switches the preview and what you edit
  - the file always contains all languages, so Asterics AAC shows the calendar in whatever content language is set there (speech included)
- Live preview in tablet format (16:10), nothing is uploaded anywhere

## Importing the file into Asterics AAC

1. Open **Manage grids** and tap **more** (top right)
2. Choose **Import custom data from file** and select the `.grd` file
3. In your home grid add an element with the action **Navigate to grid** pointing to the calendar

> Do **not** use *Restore backup from file*, it deletes all existing grids.

After importing, caregivers can still change every cell in Asterics AAC as usual (*Editing on*).

## Development

Requires Node.js 18 or newer.

```bash
cd calendar-generator
npm install
npm run dev      # local server, usually http://localhost:5173
npm test         # tests for the calendar logic
npm run build    # production build into dist/
```

### Project structure

```
calendar-generator/
├── src/
│   ├── App.vue                 page frame: header, menu left, preview right
│   ├── main.js                 starts the app, loads the styles
│   ├── zustand.js              shared state: settings, preview, events, undo
│   ├── components/
│   │   ├── EinstellungenMenue.vue   left column with all settings
│   │   ├── SymbolLeiste.vue         ARASAAC search and symbol palette
│   │   ├── Vorschau.vue             preview, tools, download
│   │   └── TerminEditor.vue         editing a clicked event
│   ├── kalender/               calendar logic, plain JavaScript (no Vue)
│   │   ├── erzeugen.js         settings -> Asterics backup file (the core)
│   │   ├── termine.js          events: series, exceptions
│   │   ├── datum.js            date helpers, ISO week numbers, timetable times
│   │   ├── feiertage.js        public holidays AT / CZ
│   │   ├── arasaac.js          ARASAAC search, image format like Asterics
│   │   └── symbole.js          small own SVG symbols (arrows, parts of the day)
│   ├── sprachen/               one file per language
│   │   ├── index.js            list of languages and helpers
│   │   ├── de.js · en.js · cs.js
│   └── styles/
│       ├── basis.css           colours, layout, inputs, buttons
│       ├── menue.css           left column
│       └── vorschau.css        right column
└── test/kalender.test.mjs
```

Names and code comments are in German, as the tool was written at FH Technikum Wien.

### Adding a language

1. Copy `src/sprachen/de.js`, e.g. to `es.js`, and translate all texts
2. Import it in `src/sprachen/index.js` and add it to `SPRACHEN`

The test `alle Sprachdateien haben dieselben Schlüssel` checks that no text is missing.

### Notes on the Asterics AAC file format

Checked against the Asterics AAC source code (`src/js/model`, `dataService.js`, `gridUtil.js`):

- A `.grd` file is JSON: `{ grids: [...], dictionaries: [] }`. No user settings are written, so home grid and global grid stay untouched.
- On import all grid ids are replaced by a plain text search (`gridUtil.regenerateIDs`). If one id were the beginning of another (`kal-1` and `kal-10`), links would break, so all generated ids have the same length. A test simulates this.
- Texts are objects `{ de, en, cs }`. Asterics shows the current content language.
- `modelVersion` 6 is written on purpose; Asterics upgrades it on import.
- Labels with one or two characters are auto-enlarged by Asterics like keyboard letters (digits count as emoji). Day numbers are therefore padded with invisible characters, so "7" and "17" have the same size.
- ARASAAC images are stored exactly like Asterics does (`url`, `author`, `authorURL`, `searchProviderName`).

## Hosting on GitHub Pages

The workflow `.github/workflows/calendar-generator.yml` runs the tests, builds the app and publishes it on every push to `main` that changes this folder (or manually in the *Actions* tab).

One-time setup: **Settings → Pages → Source: GitHub Actions**. The app is then available at `https://<owner>.github.io/Asterics-AAC-Helper/`.

## Wish list and limitations

- **"Today" button**: a button that jumps directly to the current week/day is not possible with a static file, because Asterics AAC only knows fixed navigation targets. The generator offers the overview page with the live date instead. Proposal for Asterics AAC: a new navigation type, e.g. `navigateToDateGrid` with a date pattern (date-fns), that opens the grid whose name starts with today's formatted date:

  | View | Grid name | Pattern |
  |---|---|---|
  | Week | `Kalender 2026 KW 44` | `'Kalender' RRRR 'KW' II` |
  | Day | `Kalender 2026-10-21 Mi` | `'Kalender' yyyy-MM-dd` |
  | Month | `Kalender 2026-10 Oktober` | `'Kalender' yyyy-MM` |

- Holiday names stay in the language of the country.
- Translations of symbol names come from ARASAAC and can be corrected when editing an event.

## License

AGPL-3.0, like the rest of this repository. Symbols by ARASAAC are licensed CC BY-NC-SA.
