// ============================================================
// Rechnen mit Datum (ohne Uhrzeit, immer lokale Mitternacht)
// Datum als Text immer im Format "JJJJ-MM-TT", z. B. "2026-10-21"
// ============================================================

export function isoText(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function textZuDatum(text) {
  const [j, m, t] = String(text).split('-').map(Number)
  return new Date(j, m - 1, t)
}

export function plusTage(datum, tage) {
  const neu = new Date(datum)
  neu.setDate(neu.getDate() + tage)
  return neu
}

export const plusMonate = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1)
export const monatsAnfang = (d) => new Date(d.getFullYear(), d.getMonth(), 1)

// Wochentag-Nummer: Mo = 0 … So = 6
export const wochentagNr = (d) => (d.getDay() + 6) % 7
export const istWochenende = (d) => wochentagNr(d) >= 5
export const montagDerWoche = (d) => plusTage(d, -wochentagNr(d))

// Tage zwischen zwei Daten. Math.round, weil durch die Sommerzeit ein Tag manchmal nur 23 Stunden hat.
export const tageZwischen = (a, b) => Math.round((b - a) / 86400000)

// Kalenderwoche nach ISO 8601 (wie in Österreich und Tschechien üblich)
export function kalenderwoche(datum) {
  const donnerstag = plusTage(montagDerWoche(datum), 3)
  return 1 + Math.floor(tageZwischen(new Date(donnerstag.getFullYear(), 0, 1), donnerstag) / 7)
}

// Jahr, zu dem die Kalenderwoche gehört (KW 1 kann schon Ende Dezember beginnen)
export const kalenderwochenJahr = (datum) => plusTage(montagDerWoche(datum), 3).getFullYear()

// Uhrzeiten für den Stundenplan, z. B. { anzahl: 2, beginn: '08:00', dauer: 45, pause: 5 }
// -> ['08:00 – 08:45', '08:50 – 09:35']
export function zeitSlots({ anzahl, beginn, dauer, pause }) {
  const alsText = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
  const [h, m] = String(beginn || '08:00').split(':').map(Number)
  let start = h * 60 + m
  const liste = []
  for (let i = 0; i < anzahl; i++) {
    liste.push(`${alsText(start)} – ${alsText(start + dauer)}`)
    start += dauer + pause
  }
  return liste
}
