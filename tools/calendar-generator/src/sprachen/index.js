// ============================================================
// Alle Sprachen an einer Stelle.
// Neue Sprache hinzufügen:
//   1. de.js kopieren, z. B. als es.js, und alle Texte übersetzen
//   2. hier importieren und in SPRACHEN eintragen
// Fertig. Die Webseite und die Kalender-Grids kennen die Sprache dann automatisch.
// ============================================================
import de from './de.js'
import en from './en.js'
import cs from './cs.js'

export const SPRACHEN = { de, en, cs }
export const CODES = Object.keys(SPRACHEN)

// Für jede Sprache eine Funktion aufrufen:  alle(l => …)  ->  { de: …, en: …, cs: … }
// So speichert Asterics Texte in mehreren Sprachen.
export const alle = (fn) => Object.fromEntries(CODES.map((l) => [l, fn(l)]))

// Einen Kalender-Text in allen Sprachen holen, z. B. kalenderText('woche') -> { de: 'Woche', en: 'Week', … }
export const kalenderText = (schluessel) => alle((l) => SPRACHEN[l].kalender[schluessel])

// Text aus { de, en, cs } in einer Sprache holen. Fehlt die Sprache, nimm die erste vorhandene.
export function inSprache(text, l) {
  if (!text) return ''
  if (typeof text === 'string') return text
  return text[l] || Object.values(text).find(Boolean) || ''
}

// Platzhalter ersetzen: fuellen('ab {datum}', { datum: '3.11.' }) -> 'ab 3.11.'
export function fuellen(text, werte = {}) {
  return String(text).replace(/\{(\w+)\}/g, (alles, k) => (werte[k] !== undefined ? werte[k] : alles))
}

// Browser-Sprache als Startwert für die Webseite
export function browserSprache() {
  const l = (typeof navigator !== 'undefined' && navigator.language || 'de').slice(0, 2)
  return CODES.includes(l) ? l : 'en'
}
