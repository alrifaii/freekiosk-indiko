// ============================================================
// Der gemeinsame Zustand der App: Einstellungen, Vorschau, Termine.
// Alle Komponenten lesen und ändern ihn über diese Datei,
// so liegt die Logik an einer Stelle und die .vue-Dateien bleiben übersichtlich.
// ============================================================
import { reactive, computed, watch, nextTick } from 'vue'
import { SPRACHEN, CODES, alle, fuellen, browserSprache } from './sprachen/index.js'
import { erzeugeKalender } from './kalender/erzeugen.js'
import { isoText } from './kalender/datum.js'
import { uebersetzungen } from './kalender/arasaac.js'

const heute = new Date()
const abschnitt = (schluessel, symbol) => ({ name: alle((l) => SPRACHEN[l].kalender.abschnitte[schluessel]), symbol })

// ---------- Einstellungen (alles, was in die Datei einfließt) ----------
export const einstellungen = reactive({
  uebersicht: false,                                   // Seite mit "Heute ist …" und den Monaten
  ansichten: { monat: false, woche: true, tag: false },
  tagLayout: 'genauer',                                // 'genauer' oder 'dreiTage' (gestern/heute/morgen)
  felderProAbschnitt: 4,                               // nur Tagesansicht "genauer"

  art: 'abschnitte',                                   // 'abschnitte' = Wochenplan, 'stundenplan' = mit Uhrzeiten
  abschnitte: [abschnitt('morgen', 'morning'), abschnitt('mittag', 'midday'), abschnitt('nachmittag', 'afternoon'), abschnitt('abend', 'evening')],
  stunden: { anzahl: 6, beginn: '08:00', dauer: 45, pause: 5 },
  ausrichtung: 'tageZeilen',                           // Stundenplan: 'tageZeilen' oder 'tageSpalten'

  vonDatum: isoText(heute),
  bisDatum: isoText(new Date(heute.getFullYear(), heute.getMonth() + 2, 0)),
  wochenende: true,

  feiertagsLand: 'at',
  feiertageAuslassen: true,                            // Serien an Feiertagen nicht anzeigen
  farbigeTage: true,
  symbole: true,                                       // eigene Symbole für Pfeile und Abschnitte

  termine: []                                          // siehe kalender/termine.js
})

// ---------- Bedienung (kommt nicht in die Datei) ----------
export const ansicht = reactive({
  seitenSprache: browserSprache(),  // Sprache der Webseite
  gridSprache: browserSprache(),    // Sprache, in der man die Grids sieht und bearbeitet
  seitenKey: null,                  // angezeigte Seite, z. B. "w:2026-10-19"
  gewaehlt: null,                   // angetipptes Symbol aus der Leiste
  neueWiederholung: 'woche',
  bearbeiteId: null,                // Termin, der gerade bearbeitet wird
  bearbeitetAm: null                // an welchem Tag er angeklickt wurde
})

// ---------- Texte der Webseite ----------
// t('vorschau'), t('ab', { datum: '3.11.' }), t('ansichten.woche.name')
export function t(schluessel, werte) {
  const text = schluessel.split('.').reduce((o, k) => o?.[k], SPRACHEN[ansicht.seitenSprache].oberflaeche)
  return typeof text === 'string' ? fuellen(text, werte) : text ?? schluessel
}
export const sprachName = (l) => SPRACHEN[l].name
export const datumText = (d) => d?.toLocaleDateString(SPRACHEN[ansicht.seitenSprache].locale, { weekday: 'long', day: 'numeric', month: 'long' })
export { CODES as SPRACH_CODES }

// ---------- Ergebnis des Generators (rechnet bei jeder Änderung neu) ----------
export const ergebnis = computed(() => {
  const a = einstellungen.ansichten
  if (!a.monat && !a.woche && !a.tag) return { fehler: t('fehlerKeineAnsicht') }
  try {
    return erzeugeKalender(einstellungen)
  } catch (fehler) {
    if (fehler.code === 'ZU_VIELE') return { fehler: t('fehlerZuViele', fehler) }
    throw fehler
  }
})
export const seiten = computed(() => ergebnis.value.seiten || [])
export const grids = computed(() => ergebnis.value.backup?.grids || [])
export const felderInfo = computed(() => ergebnis.value.felderInfo || {})
export const aktuelleNr = computed(() => Math.max(seiten.value.findIndex((s) => s.key === ansicht.seitenKey), 0))
export const aktuellesGrid = computed(() => grids.value[aktuelleNr.value])
export const groesseKB = computed(() => (ergebnis.value.backup ? Math.round(JSON.stringify(ergebnis.value.backup).length / 1024) : 0))

// ---------- Blättern in der Vorschau ----------
// Die Seite wird über ihren Schlüssel gemerkt, so verrutscht sie nicht, wenn Seiten dazukommen oder wegfallen.
export function setzeSeite(i) {
  if (seiten.value[i]) ansicht.seitenKey = seiten.value[i].key
}
export const blaettern = (richtung) => setzeSeite(Math.min(Math.max(aktuelleNr.value + richtung, 0), seiten.value.length - 1))
export const springeZuGrid = (gridId) => setzeSeite(grids.value.findIndex((g) => g.id === gridId))

// Zur ersten Seite einer Ansicht springen, damit man Änderungen sofort sieht
export function zeigeErsteSeite(art) {
  nextTick(() => {
    for (const a of [art, 'woche', 'tag', 'monat', 'uebersicht']) {
      const i = seiten.value.findIndex((s) => s.art === a)
      if (i >= 0) return setzeSeite(i)
    }
  })
}
zeigeErsteSeite('woche')
watch(() => [einstellungen.art, einstellungen.ausrichtung], () => zeigeErsteSeite(einstellungen.ansichten.woche ? 'woche' : 'tag'))
watch(() => einstellungen.tagLayout, () => zeigeErsteSeite('tag'))

// Ansicht ein-/ausschalten. Eingeschaltet: gleich in der Vorschau zeigen.
export const ansichtAn = (art) => (art === 'uebersicht' ? einstellungen.uebersicht : einstellungen.ansichten[art])
export function ansichtUmschalten(art) {
  if (art === 'uebersicht') einstellungen.uebersicht = !einstellungen.uebersicht
  else einstellungen.ansichten[art] = !einstellungen.ansichten[art]
  if (ansichtAn(art)) zeigeErsteSeite(art)
}

// ---------- Rückgängig / Wiederholen (für Termine) ----------
export const verlauf = reactive({ zurueck: [], vor: [] })
function aendern(aenderung) {
  verlauf.zurueck.push(JSON.stringify(einstellungen.termine))
  if (verlauf.zurueck.length > 100) verlauf.zurueck.shift()
  verlauf.vor = []
  aenderung()
}
export function rueckgaengig() {
  if (!verlauf.zurueck.length) return
  verlauf.vor.push(JSON.stringify(einstellungen.termine))
  einstellungen.termine = JSON.parse(verlauf.zurueck.pop())
  ansicht.bearbeiteId = null
}
export function wiederholen() {
  if (!verlauf.vor.length) return
  verlauf.zurueck.push(JSON.stringify(einstellungen.termine))
  einstellungen.termine = JSON.parse(verlauf.vor.pop())
}

// ---------- Termine ----------
const finde = (id) => einstellungen.termine.find((x) => x.id === id)
const ohne = (id) => (einstellungen.termine = einstellungen.termine.filter((x) => x.id !== id))
let zaehler = 0
const neueId = () => `t${Date.now().toString(36)}${zaehler++}`

// Symbol auf ein Feld der Vorschau setzen (Termin-Feld oder Tagesabschnitt)
export function symbolSetzen(info, symbol) {
  if (!info || !symbol) return
  if (info.art === 'abschnitt') {
    einstellungen.abschnitte[info.index].symbol = { id: symbol.id, url: symbol.url }
    return
  }
  const termin = {
    id: neueId(),
    symbol: { id: symbol.id, url: symbol.url },
    text: { [ansicht.gridSprache]: symbol.text },
    datum: isoText(info.datum),
    slot: info.slot,
    feld: info.feld,
    wiederholung: ansicht.neueWiederholung,
    ausnahmen: []
  }
  aendern(() => einstellungen.termine.push(termin))
  // Namen in den anderen Sprachen im Hintergrund von ARASAAC holen
  const andere = CODES.filter((l) => l !== ansicht.gridSprache)
  uebersetzungen(symbol.id, andere).then((ue) => {
    const echt = finde(termin.id)
    if (echt) andere.forEach((l) => ue[l] && !echt.text[l] && (echt.text[l] = ue[l]))
  })
}

// Nur an diesem Tag entfernen: Serien bekommen eine Ausnahme, einmalige Termine werden gelöscht
export function nurHierEntfernen(id, tag) {
  const termin = finde(id)
  if (!termin) return
  aendern(() => {
    if (termin.wiederholung === 'einmal') ohne(id)
    else if (!termin.ausnahmen.includes(isoText(tag))) termin.ausnahmen.push(isoText(tag))
  })
  if (ansicht.bearbeiteId === id) ansicht.bearbeiteId = null
}
export function serieLoeschen(id) {
  aendern(() => ohne(id))
  ansicht.bearbeiteId = null
}
export const wiederholungAendern = (termin, wert) => aendern(() => (termin.wiederholung = wert))
export const ausnahmenZuruecksetzen = (termin) => aendern(() => (termin.ausnahmen = []))

// Termin auf ein anderes Feld ziehen. Bei Serien wandert nur dieses eine Vorkommen.
export function verschieben(id, vonTag, info) {
  const termin = finde(id)
  if (!termin || info?.art !== 'termin') return
  const nach = isoText(info.datum)
  if (vonTag === nach && termin.slot === info.slot && termin.feld === info.feld) return
  aendern(() => {
    if (termin.wiederholung === 'einmal') {
      Object.assign(termin, { datum: nach, slot: info.slot, feld: info.feld })
    } else {
      termin.ausnahmen.push(vonTag)
      einstellungen.termine.push({ ...JSON.parse(JSON.stringify(termin)), id: neueId(), datum: nach, slot: info.slot, feld: info.feld, wiederholung: 'einmal', ausnahmen: [] })
    }
  })
}

// Alle Termine auf der angezeigten Seite entfernen (Serien nur hier)
export function seiteLeeren() {
  const belegt = aktuellesGrid.value.gridElements.map((f) => felderInfo.value[f.id]).filter((i) => i?.terminId)
  if (!belegt.length) return
  aendern(() => {
    for (const i of belegt) {
      const termin = finde(i.terminId)
      if (!termin) continue
      if (termin.wiederholung === 'einmal') ohne(termin.id)
      else if (!termin.ausnahmen.includes(isoText(i.datum))) termin.ausnahmen.push(isoText(i.datum))
    }
  })
  ansicht.bearbeiteId = null
}
export function alleTermineLoeschen() {
  aendern(() => (einstellungen.termine = []))
  ansicht.bearbeiteId = null
}

// ---------- Datei herunterladen ----------
// Im inDiKo-Kit eingebettet (?kit=1): die Datei geht an das Kit, das sie direkt auf
// ausgewählte Tablets lädt. Nur an die eigene Seite (gleiche Herkunft).
export const imKit = typeof window !== 'undefined' && window.parent !== window && new URLSearchParams(location.search).has('kit')

export function herunterladen() {
  if (!ergebnis.value.backup) return
  if (imKit) {
    window.parent.postMessage({
      typ: 'asterics-grd',
      name: `kalender-${einstellungen.vonDatum}-${einstellungen.bisDatum}.grd`,
      inhalt: JSON.stringify(ergebnis.value.backup)
    }, location.origin)
    return
  }
  const blob = new Blob([JSON.stringify(ergebnis.value.backup)], { type: 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `kalender-${einstellungen.vonDatum}-${einstellungen.bisDatum}.grd`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
