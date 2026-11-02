// Tests für die Kalender-Logik. Starten mit:  npm test
// Nutzt den eingebauten Test-Runner von Node, keine zusätzlichen Pakete.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { erzeugeKalender, MAX_GRIDS } from '../src/kalender/erzeugen.js'
import { findeTermin } from '../src/kalender/termine.js'
import { kalenderwoche, textZuDatum } from '../src/kalender/datum.js'
import { feiertag } from '../src/kalender/feiertage.js'
import { SPRACHEN, CODES } from '../src/sprachen/index.js'

const abschnitt = (de, en, cs) => ({ name: { de, en, cs }, symbol: 'morning' })
const basis = {
  uebersicht: true, ansichten: { monat: true, woche: true, tag: true }, tagLayout: 'genauer', felderProAbschnitt: 4,
  art: 'abschnitte', abschnitte: [abschnitt('Morgen', 'Morning', 'Ráno'), abschnitt('Abend', 'Evening', 'Večer')],
  stunden: { anzahl: 6, beginn: '08:00', dauer: 45, pause: 5 }, ausrichtung: 'tageZeilen',
  vonDatum: '2026-10-19', bisDatum: '2026-12-31', wochenende: true,
  feiertagsLand: 'at', feiertageAuslassen: true, farbigeTage: true, symbole: true, termine: []
}

// Prüft eine erzeugte Datei: eindeutige Ids, gleich lange Grid-Ids, keine Überlappung, alle Links gültig, alle Sprachen da
function pruefe(backup) {
  const ids = new Set(backup.grids.map((g) => g.id))
  assert.equal(ids.size, backup.grids.length, 'Grid-Ids eindeutig')
  assert.equal(new Set(backup.grids.map((g) => g.id.length)).size, 1, 'Grid-Ids gleich lang')
  for (const g of backup.grids) {
    const belegt = new Set()
    for (const e of g.gridElements) {
      assert.ok(e.x >= 0 && e.x + e.width <= g.minColumnCount && e.y < g.rowCount, `Feld im Grid (${g.label.de})`)
      for (let x = e.x; x < e.x + e.width; x++) {
        assert.ok(!belegt.has(`${x}/${e.y}`), `keine Überlappung (${g.label.de})`)
        belegt.add(`${x}/${e.y}`)
      }
      for (const a of e.actions) if (a.toGridId) assert.ok(ids.has(a.toGridId), 'Link zeigt auf vorhandenes Grid')
      if (Object.keys(e.label).length) for (const l of CODES) assert.ok(e.label[l], `Text in ${l} vorhanden`)
    }
  }
}

// Macht dasselbe wie Asterics beim Import (gridUtil.regenerateIDs): Ids per Textsuche ersetzen
function importSimulieren(backup) {
  const neu = {}
  backup.grids.forEach((g, i) => (neu[g.id] = `grid-data-${1700000000000 + i}-${100 + i}`))
  return backup.grids.map((g) => {
    let json = JSON.stringify({ ...g, id: neu[g.id] })
    for (const alt of Object.keys(neu)) json = json.replace(new RegExp(alt, 'g'), neu[alt])
    return JSON.parse(json)
  })
}

test('Kalenderwochen nach ISO 8601', () => {
  assert.equal(kalenderwoche(textZuDatum('2026-10-19')), 43)
  assert.equal(kalenderwoche(textZuDatum('2027-01-01')), 53)
  assert.equal(kalenderwoche(textZuDatum('2024-12-30')), 1)
})

test('Feiertage Österreich und Tschechien', () => {
  assert.equal(feiertag(textZuDatum('2026-10-26'), 'at'), 'Nationalfeiertag')
  assert.equal(feiertag(textZuDatum('2026-04-06'), 'at'), 'Ostermontag')
  assert.equal(feiertag(textZuDatum('2026-10-28'), 'cz'), 'Vznik Československa')
  assert.equal(feiertag(textZuDatum('2026-10-27'), 'at'), null)
})

test('alle Ansichten und Layouts ergeben gültige Dateien', () => {
  const varianten = [
    basis,
    { ...basis, tagLayout: 'dreiTage' },
    { ...basis, wochenende: false, uebersicht: false },
    { ...basis, art: 'stundenplan' },
    { ...basis, art: 'stundenplan', ausrichtung: 'tageSpalten', felderProAbschnitt: 1 },
    { ...basis, ansichten: { monat: true, woche: false, tag: false } }
  ]
  for (const v of varianten) pruefe(erzeugeKalender(v).backup)
})

test('Links funktionieren auch nach dem Import in Asterics', () => {
  pruefe({ grids: importSimulieren(erzeugeKalender(basis).backup) })
})

test('Seiten: Übersicht, Monate nur im Zeitraum, ganze Wochen', () => {
  const { seiten } = erzeugeKalender(basis)
  const anzahl = (art) => seiten.filter((s) => s.art === art).length
  assert.equal(anzahl('uebersicht'), 1)
  assert.equal(anzahl('monat'), 3) // Oktober bis Dezember, kein Jänner
  assert.equal(anzahl('woche'), 11) // KW 43 bis KW 53
  assert.equal(anzahl('tag'), 77)
})

test('Serien mit Ausnahmen und Feiertagen', () => {
  const termine = [
    { id: 'a', text: { de: 'Schule' }, datum: '2026-10-19', slot: 0, feld: 0, wiederholung: 'werktag', ausnahmen: ['2026-10-28'] },
    { id: 'b', text: { de: 'Arzt' }, datum: '2026-10-28', slot: 0, feld: 0, wiederholung: 'einmal', ausnahmen: [] }
  ]
  const an = (tag) => findeTermin(termine, textZuDatum(tag), 0, 0, 'at', true)?.id ?? null
  assert.equal(an('2026-10-20'), 'a')
  assert.equal(an('2026-10-26'), null, 'Nationalfeiertag fällt aus')
  assert.equal(an('2026-10-28'), 'b', 'Ausnahme, dafür einmaliger Termin')
  assert.equal(an('2026-10-31'), null, 'Samstag')
})

test('Pfeile sprechen das ganze Wort, Tageszahlen sind gleich lang', () => {
  const { backup } = erzeugeKalender({ ...basis, uebersicht: false, ansichten: { monat: true, woche: true, tag: true } })
  const tag = backup.grids.find((g) => g.label.de === 'Kalender 2026-10-21 Mi')
  const zurueck = tag.gridElements.find((e) => e.x === 0 && e.y === 0)
  assert.equal(zurueck.label.de, 'Di 20.10.')
  assert.equal(zurueck.actions[0].speakText.de, 'Dienstag, 20. Oktober')
  const monat = backup.grids.find((g) => g.label.de.startsWith('Kalender 2026-11'))
  const zahlen = monat.gridElements.filter((e) => e.y >= 2).map((e) => e.label.de)
  assert.ok(zahlen.every((z) => z.length === 3), 'alle Zahlen 3 Zeichen lang')
})

test('alle Sprachdateien haben dieselben Schlüssel', () => {
  const schluessel = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? schluessel(v, p + k + '.') : [p + k]))
  const deutsch = schluessel(SPRACHEN.de).sort()
  for (const l of CODES) assert.deepEqual(schluessel(SPRACHEN[l]).sort(), deutsch, `Sprache ${l} vollständig`)
})

test('zu viele Grids werden abgelehnt', () => {
  assert.throws(() => erzeugeKalender({ ...basis, vonDatum: '2026-01-01', bisDatum: '2028-12-31' }), (f) => f.code === 'ZU_VIELE' && f.max === MAX_GRIDS)
})
