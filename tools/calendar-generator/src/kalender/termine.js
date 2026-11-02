// ============================================================
// Termine, die per Symbol in die Kalender-Felder gesetzt werden.
// Sie funktionieren wie in einer Kalender-App: als Serie mit Ausnahmen.
//
// Ein Termin sieht so aus:
//   {
//     id: 't1',
//     symbol: { id: 38, url: '…' },     ARASAAC-Symbol
//     text: { de: 'Schule', en: 'School', cs: 'Škola' },
//     datum: '2026-10-19',              erster Tag
//     slot: 0,                          Zeile (Tagesabschnitt oder Uhrzeit)
//     feld: 0,                          Feld im Abschnitt (die Tagesansicht hat mehrere)
//     wiederholung: 'woche',            siehe WIEDERHOLUNGEN
//     ausnahmen: ['2026-11-02']         an diesen Tagen NICHT anzeigen
//   }
// ============================================================
import { isoText, textZuDatum, tageZwischen, wochentagNr } from './datum.js'
import { feiertag } from './feiertage.js'

export const WIEDERHOLUNGEN = ['einmal', 'woche', 'zweiWochen', 'werktag']

// Kommt der Termin an diesem Tag vor?
export function terminAnTag(termin, tag, feiertagsLand, feiertageAuslassen) {
  const iso = isoText(tag)
  if (termin.ausnahmen.includes(iso)) return false
  if (termin.wiederholung === 'einmal') return iso === termin.datum

  const abstand = tageZwischen(textZuDatum(termin.datum), tag)
  if (abstand < 0) return false
  if (feiertageAuslassen && feiertag(tag, feiertagsLand)) return false
  if (termin.wiederholung === 'woche') return abstand % 7 === 0
  if (termin.wiederholung === 'zweiWochen') return abstand % 14 === 0
  if (termin.wiederholung === 'werktag') return wochentagNr(tag) < 5
  return false
}

// Welcher Termin steht in diesem Feld? Einmalige Termine gehen vor Serien, sonst gewinnt der neueste.
export function findeTermin(termine, tag, slot, feld, feiertagsLand, feiertageAuslassen) {
  let treffer = null
  for (const t of termine) {
    if (t.slot !== slot || t.feld !== feld || !terminAnTag(t, tag, feiertagsLand, feiertageAuslassen)) continue
    if (!treffer || t.wiederholung === 'einmal' || treffer.wiederholung !== 'einmal') treffer = t
  }
  return treffer
}
