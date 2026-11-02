// ============================================================
// Gesetzliche Feiertage für Österreich und Tschechien
// (bewegliche Feiertage werden aus dem Osterdatum berechnet).
// Die Namen bleiben in der Landessprache, so stehen sie auch in jedem Kalender.
// ============================================================

// Ostersonntag nach der Gauß'schen Osterformel (gregorianisch)
function ostersonntag(jahr) {
  const a = jahr % 19, b = Math.floor(jahr / 100), c = jahr % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const monat = Math.floor((h + l - 7 * m + 114) / 31)
  const tag = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(jahr, monat - 1, tag)
}

const plus = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const schluessel = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

const LISTEN = {
  at: (j, o) => [
    [new Date(j, 0, 1), 'Neujahr'], [new Date(j, 0, 6), 'Hl. Drei Könige'], [plus(o, 1), 'Ostermontag'],
    [new Date(j, 4, 1), 'Staatsfeiertag'], [plus(o, 39), 'Christi Himmelfahrt'], [plus(o, 50), 'Pfingstmontag'],
    [plus(o, 60), 'Fronleichnam'], [new Date(j, 7, 15), 'Mariä Himmelfahrt'], [new Date(j, 9, 26), 'Nationalfeiertag'],
    [new Date(j, 10, 1), 'Allerheiligen'], [new Date(j, 11, 8), 'Mariä Empfängnis'], [new Date(j, 11, 25), 'Christtag'],
    [new Date(j, 11, 26), 'Stefanitag']
  ],
  cz: (j, o) => [
    [new Date(j, 0, 1), 'Nový rok'], [plus(o, -2), 'Velký pátek'], [plus(o, 1), 'Velikonoční pondělí'],
    [new Date(j, 4, 1), 'Svátek práce'], [new Date(j, 4, 8), 'Den vítězství'], [new Date(j, 6, 5), 'Cyril a Metoděj'],
    [new Date(j, 6, 6), 'Jan Hus'], [new Date(j, 8, 28), 'Den české státnosti'], [new Date(j, 9, 28), 'Vznik Československa'],
    [new Date(j, 10, 17), 'Den boje za svobodu'], [new Date(j, 11, 24), 'Štědrý den'], [new Date(j, 11, 25), '1. svátek vánoční'],
    [new Date(j, 11, 26), '2. svátek vánoční']
  ]
}

// Auswählbare Länder ('' = keine Feiertage). Die Namen der Länder stehen in den Sprachdateien.
export const FEIERTAG_LAENDER = ['', 'at', 'cz']

const cache = {}
// Name des Feiertags an diesem Datum, oder null
export function feiertag(datum, land) {
  if (!land || !LISTEN[land]) return null
  const jahr = datum.getFullYear()
  const k = land + jahr
  if (!cache[k]) cache[k] = new Map(LISTEN[land](jahr, ostersonntag(jahr)).map(([d, n]) => [schluessel(d), n]))
  return cache[k].get(schluessel(datum)) || null
}
