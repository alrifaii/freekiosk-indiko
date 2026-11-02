// ============================================================
// Herzstück: aus den Einstellungen wird eine Asterics-Backup-Datei.
// Reines JavaScript ohne Vue, deshalb auch in Tests nutzbar.
//
// Es gibt bis zu vier Arten von Seiten (= Grids in Asterics):
//   Übersicht  "Heute ist …" und die Monate
//   Monat      ein Grid pro Monat
//   Woche      ein Grid pro Woche (Tagesabschnitte oder Stundenplan)
//   Tag        ein Grid pro Tag (genauer, oder gestern/heute/morgen)
// Alle sind mit Vor/Zurück- und Ansicht-Buttons verbunden.
//
// Wichtig zum Asterics-Format (geprüft im Quellcode von Asterics AAC):
//  - Eine .grd-Datei ist JSON: { grids: [...], dictionaries: [] }
//  - Beim Import ersetzt Asterics alle Grid-Ids per Textsuche. Ist eine Id der Anfang
//    einer anderen ("kal-1" und "kal-10"), gehen Links kaputt. Deshalb sind alle Ids gleich lang.
//  - Texte sind { de, en, cs }. Asterics zeigt die Sprache aus seinen Einstellungen.
// ============================================================
import { SPRACHEN, alle, kalenderText as K, inSprache, fuellen } from '../sprachen/index.js'
import {
  isoText, textZuDatum, plusTage, plusMonate, monatsAnfang, montagDerWoche,
  wochentagNr, istWochenende, tageZwischen, kalenderwoche, kalenderwochenJahr, zeitSlots
} from './datum.js'
import { findeTermin } from './termine.js'
import { feiertag } from './feiertage.js'
import { symbolBild } from './symbole.js'
import { bildFuerAsterics } from './arasaac.js'

const VERSION = '{"major": 6, "minor": 0, "patch": 0}' // Asterics hebt das beim Import selbst auf die aktuelle Version
export const MAX_GRIDS = 450

export const WOCHENTAG_FARBEN = ['#c8e6c9', '#bbdefb', '#fff59d', '#ffccbc', '#e1bee7', '#f8bbd0', '#ffcdd2'] // Mo … So
const FARBE = {
  nav: '#dbe9f6', titel: '#ffffff', kopf: '#fff2c2', kopfWE: '#ffd9cc', zeile: '#eeeeee', zelle: '#ffffff',
  zelleWE: '#fff6f2', ausserhalb: '#e4e4e4', monat: '#e6f2e6', heute: '#ffe0b2', feiertag: '#ffcdd2'
}

// ---------- Datum als Text, in allen Sprachen ----------
const format = (d, optionen) => alle((l) => d.toLocaleDateString(SPRACHEN[l].locale, optionen))
const wtKurz = (d) => alle((l) => d.toLocaleDateString(SPRACHEN[l].locale, { weekday: 'short' }).replace('.', ''))
const datumKurz = (d) => format(d, { day: 'numeric', month: 'numeric' })
const tagKurz = (d) => alle((l) => `${wtKurz(d)[l]} ${datumKurz(d)[l]}`) // "Mo 26.10."
const tagLang = (d) => format(d, { weekday: 'long', day: 'numeric', month: 'long' }) // "Montag, 26. Oktober"
const tagTitel = (d) => format(d, { weekday: 'long', day: 'numeric', month: 'numeric' })
const monatTitel = (m) => format(m, { month: 'long', year: 'numeric' })
const monatName = (m) => format(m, { month: 'long' })
const kwKurz = (d) => alle((l) => `${K('kw')[l]} ${kalenderwoche(d)}`)
const kwLang = (d) => alle((l) => `${K('kwSprechen')[l]} ${kalenderwoche(d)}`)
const mitFeiertag = (text, name, trenner = ' · ') => (name ? alle((l) => `${text[l]}${trenner}${name}`) : text)

// Asterics vergrößert Beschriftungen mit 1–2 Zeichen automatisch (wie Tastatur-Buchstaben, Ziffern zählen dabei als Emoji).
// Damit "7" nicht größer ist als "17", wird die Zahl mit unsichtbaren Zeichen auf 3 Zeichen aufgefüllt.
const gleichGross = (zahl) => String(zahl).padStart(3, '​')

/**
 * Erzeugt den Kalender.
 * @param e Einstellungen (siehe zustand.js)
 * @returns {{ backup, felderInfo, seiten }}
 *   backup      kommt in die .grd-Datei
 *   felderInfo  nur für die Vorschau: welches Feld gehört zu welchem Tag/Abschnitt
 *   seiten      Liste aller Seiten mit Schlüssel und Art
 */
export function erzeugeKalender(e) {
  let zaehler = 0
  const neueId = (art) => `${art}-kal-${String(++zaehler).padStart(6, '0')}`
  const feiertagName = (d) => feiertag(d, e.feiertagsLand)

  // ---------- Zeitraum, immer ganze Wochen ----------
  let von = textZuDatum(e.vonDatum)
  let bis = textZuDatum(e.bisDatum)
  if (isNaN(von)) von = new Date()
  if (isNaN(bis) || bis < von) bis = von
  const ersterMontag = montagDerWoche(von)
  const letzterSonntag = plusTage(montagDerWoche(bis), 6)
  const sichtbar = (d) => e.wochenende || !istWochenende(d)
  const imZeitraum = (d) => d >= ersterMontag && d <= letzterSonntag

  // ---------- Zeilen: Tagesabschnitte oder Uhrzeiten ----------
  const slots = e.art === 'abschnitte'
    ? e.abschnitte
        .map((a, index) => ({ text: alle((l) => inSprache(a.name, l).trim()), symbol: a.symbol, index }))
        .filter((a) => Object.values(a.text).some(Boolean))
    : zeitSlots(e.stunden).map((zeit) => ({ text: alle(() => zeit) }))

  // ---------- 1. Welche Seiten gibt es? ----------
  const seiten = []
  if (e.uebersicht) seiten.push({ key: 'uebersicht', art: 'uebersicht' })
  if (e.ansichten.monat) for (let m = monatsAnfang(von); m <= bis; m = plusMonate(m, 1)) seiten.push({ key: 'm:' + isoText(m), art: 'monat', datum: m })
  if (e.ansichten.woche) for (let w = ersterMontag; w <= letzterSonntag; w = plusTage(w, 7)) seiten.push({ key: 'w:' + isoText(w), art: 'woche', datum: w })
  if (e.ansichten.tag) for (let d = ersterMontag; d <= letzterSonntag; d = plusTage(d, 1)) if (sichtbar(d)) seiten.push({ key: 'd:' + isoText(d), art: 'tag', datum: d })
  if (seiten.length > MAX_GRIDS) {
    const fehler = new Error('zu viele Grids')
    Object.assign(fehler, { code: 'ZU_VIELE', anzahl: seiten.length, max: MAX_GRIDS })
    throw fehler
  }

  const gridId = {}
  seiten.forEach((s, i) => (gridId[s.key] = `grid-data-kal-${String(i + 1).padStart(4, '0')}`))
  const gibt = (key) => Boolean(key) && gridId[key] !== undefined

  // ---------- 2. Wohin springt ein Button? (null = Seite gibt es nicht) ----------
  const zielTag = (d) => (gibt('d:' + isoText(d)) ? 'd:' + isoText(d) : null)
  const zielWoche = (d) => (gibt('w:' + isoText(montagDerWoche(d))) ? 'w:' + isoText(montagDerWoche(d)) : null)
  const zielMonat = (d) => (gibt('m:' + isoText(monatsAnfang(d))) ? 'm:' + isoText(monatsAnfang(d)) : null)
  const ersterTagAb = (d) => [...Array(7)].map((_, i) => plusTage(d, i)).find(zielTag) || null
  const nachbarTag = (d, richtung) => [...Array(7)].map((_, i) => plusTage(d, richtung * (i + 1))).find(zielTag) || null

  // ---------- 3. Bausteine für Felder ----------
  const felderInfo = {}

  function bild(symbol) {
    if (symbol && typeof symbol === 'object' && symbol.id) return bildFuerAsterics(symbol.id) // ARASAAC, immer
    const data = e.symbole && typeof symbol === 'string' ? symbolBild(symbol) : null // eigenes Symbol
    return data ? { data } : {}
  }

  // Ein Feld. text/sprechen sind { de, en, cs }. "sprechen" wird statt des Textes vorgelesen.
  function feld({ x, y, breite = 1, text = {}, sprechen, ziel, symbol, farbe, info }) {
    const actions = [
      sprechen
        ? { id: neueId('speak-custom'), modelName: 'GridActionSpeakCustom', modelVersion: VERSION, speakText: sprechen }
        : { id: neueId('speak'), modelName: 'GridActionSpeak', modelVersion: VERSION }
    ]
    if (gibt(ziel)) actions.push({ id: neueId('nav'), modelName: 'GridActionNavigate', modelVersion: VERSION, navType: 'navigateToGrid', toGridId: gridId[ziel] })
    const element = {
      id: neueId('element'), modelName: 'GridElement', modelVersion: VERSION,
      x, y, width: breite, height: 1, label: text, wordForms: [], image: bild(symbol), actions,
      type: 'ELEMENT_TYPE_NORMAL', additionalProps: {},
      ...(farbe ? { backgroundColor: farbe } : {})
    }
    if (info) felderInfo[element.id] = info
    return element
  }

  // Termin-Feld: leer, oder mit dem Termin, der an diesem Tag hier steht
  function terminFeld(x, y, tag, slot, feldNr, farbe, breite = 1) {
    const termin = findeTermin(e.termine, tag, slot, feldNr, e.feiertagsLand, e.feiertageAuslassen)
    return feld({
      x, y, breite, farbe,
      symbol: termin?.symbol,
      text: termin ? alle((l) => inSprache(termin.text, l)) : {},
      info: { art: 'termin', datum: tag, slot, feld: feldNr, terminId: termin?.id || null }
    })
  }

  // Beschriftung eines Tagesabschnitts / einer Uhrzeit
  const slotFeld = (x, y, s, farbe = FARBE.zeile, breite = 1) =>
    feld({ x, y, breite, text: s.text, symbol: s.symbol, farbe, info: s.index !== undefined ? { art: 'abschnitt', index: s.index } : null })

  // Navigationszeile:  [◀] [ Titel ……… ] [▶] [Ansicht] [Ansicht] [Übersicht]
  function navZeile(spalten, { zurueck, titel, sprechen, weiter, wechsel }) {
    const rechts = [{ ...weiter, symbol: 'next' }, ...wechsel]
    if (e.uebersicht) rechts.push({ ziel: 'uebersicht', text: K('uebersicht'), symbol: 'overview' })
    const felder = []
    if (zurueck.ziel) felder.push(feld({ x: 0, y: 0, ...zurueck, symbol: 'prev', farbe: FARBE.nav }))
    felder.push(feld({ x: 1, y: 0, breite: spalten - 1 - rechts.length, text: titel, sprechen, farbe: FARBE.titel }))
    rechts.forEach((r, i) => r.ziel && felder.push(feld({ x: spalten - rechts.length + i, y: 0, ...r, farbe: FARBE.nav })))
    return felder
  }
  const navSpalten = (anzahlWechsel) => 3 + anzahlWechsel + (e.uebersicht ? 1 : 0)

  // Buttons zu den anderen eingeschalteten Ansichten
  function wechselButtons(d, aktuell) {
    const b = []
    if (aktuell !== 'monat' && e.ansichten.monat) b.push({ ziel: zielMonat(d), text: K('monat'), symbol: 'ansichtMonat' })
    if (aktuell !== 'woche' && e.ansichten.woche) b.push({ ziel: zielWoche(d), text: K('woche'), symbol: 'ansichtWoche' })
    if (aktuell !== 'tag' && e.ansichten.tag) b.push({ ziel: zielTag(ersterTagAb(d < ersterMontag ? ersterMontag : d) || d), text: K('tag'), symbol: 'ansichtTag' })
    return b
  }

  const kopfFarbe = (d) => (feiertagName(d) ? FARBE.feiertag : e.farbigeTage ? WOCHENTAG_FARBEN[wochentagNr(d)] : istWochenende(d) ? FARBE.kopfWE : FARBE.kopf)
  const zellFarbe = (d) => (istWochenende(d) ? FARBE.zelleWE : FARBE.zelle)

  const grid = (seite, name, spalten, zeilen, felder) => ({
    id: gridId[seite.key], modelName: 'GridData', modelVersion: VERSION,
    label: name, rowCount: zeilen, minColumnCount: spalten,
    gridElements: felder, additionalFiles: [], webRadios: []
  })

  // ---------- 4. Die Seiten ----------

  function wochenSeite(seite) {
    const montag = seite.datum
    const sonntag = plusTage(montag, 6)
    const tage = [...Array(7)].map((_, i) => plusTage(montag, i)).filter(sichtbar)
    const tageAlsZeilen = e.art === 'stundenplan' && e.ausrichtung === 'tageZeilen'
    const wechsel = wechselButtons(montag, 'woche')
    const inhalt = 1 + (tageAlsZeilen ? slots.length : tage.length)
    const spalten = Math.max(inhalt, navSpalten(wechsel.length))
    // braucht die Navigation mehr Spalten als der Inhalt, wird die letzte Spalte breiter statt einer Lücke
    const breite = (i, anzahl) => (i === anzahl - 1 ? 1 + spalten - inhalt : 1)

    const felder = navZeile(spalten, {
      zurueck: { ziel: zielWoche(plusTage(montag, -7)), text: kwKurz(plusTage(montag, -7)), sprechen: kwLang(plusTage(montag, -7)) },
      titel: alle((l) => `${kwKurz(montag)[l]} · ${datumKurz(montag)[l]} – ${datumKurz(sonntag)[l]} ${sonntag.getFullYear()}`),
      sprechen: alle((l) => fuellen(K('wocheVonBis')[l], { von: tagLang(montag)[l], bis: tagLang(sonntag)[l] })),
      weiter: { ziel: zielWoche(plusTage(montag, 7)), text: kwKurz(plusTage(montag, 7)), sprechen: kwLang(plusTage(montag, 7)) },
      wechsel
    })
    tage.forEach((d, t) => {
      const ft = feiertagName(d)
      const pos = tageAlsZeilen ? { x: 0, y: 2 + t } : { x: 1 + t, y: 1, breite: breite(t, tage.length) }
      felder.push(feld({ ...pos, farbe: kopfFarbe(d), ziel: zielTag(d), text: mitFeiertag(tagKurz(d), ft), sprechen: mitFeiertag(tagLang(d), ft, ', ') }))
      slots.forEach((s, i) => {
        const p = tageAlsZeilen ? { x: 1 + i, y: 2 + t, b: breite(i, slots.length) } : { x: 1 + t, y: 2 + i, b: breite(t, tage.length) }
        felder.push(terminFeld(p.x, p.y, d, i, 0, zellFarbe(d), p.b))
      })
    })
    slots.forEach((s, i) => felder.push(tageAlsZeilen ? slotFeld(1 + i, 1, s, FARBE.zeile, breite(i, slots.length)) : slotFeld(0, 2 + i, s)))
    const name = alle((l) => `${K('kalender')[l]} ${kalenderwochenJahr(montag)} ${K('kw')[l]} ${String(kalenderwoche(montag)).padStart(2, '0')}`)
    return grid(seite, name, spalten, 2 + (tageAlsZeilen ? tage.length : slots.length), felder)
  }

  // Navigation für beide Tages-Layouts
  function tagesNavigation(d, spalten, wechsel) {
    const vor = nachbarTag(d, -1)
    const nach = nachbarTag(d, 1)
    const ft = feiertagName(d)
    return navZeile(spalten, {
      zurueck: { ziel: vor && zielTag(vor), text: vor && tagKurz(vor), sprechen: vor && tagLang(vor) },
      titel: mitFeiertag(tagTitel(d), ft),
      sprechen: mitFeiertag(tagLang(d), ft, ', '),
      weiter: { ziel: nach && zielTag(nach), text: nach && tagKurz(nach), sprechen: nach && tagLang(nach) },
      wechsel
    })
  }
  const tagesName = (d) => alle((l) => `${K('kalender')[l]} ${isoText(d)} ${wtKurz(d)[l]}`)

  // TAG genauer: mehrere Felder pro Abschnitt
  function tagSeiteGenauer(seite) {
    const d = seite.datum
    const wechsel = wechselButtons(d, 'tag')
    const anzahl = Math.max(1, Math.min(8, Number(e.felderProAbschnitt) || 1))
    const spalten = Math.max(1 + anzahl, navSpalten(wechsel.length))
    const felder = tagesNavigation(d, spalten, wechsel)
    const farbe = feiertagName(d) ? FARBE.feiertag : e.farbigeTage ? WOCHENTAG_FARBEN[wochentagNr(d)] : FARBE.zeile
    slots.forEach((s, i) => {
      felder.push(slotFeld(0, 1 + i, s, farbe))
      for (let k = 0; k < anzahl; k++) felder.push(terminFeld(1 + k, 1 + i, d, i, k, FARBE.zelle, k === anzahl - 1 ? spalten - anzahl : 1))
    })
    return grid(seite, tagesName(d), spalten, 1 + slots.length, felder)
  }

  // TAG gestern / heute / morgen: heute in der Mitte und am breitesten
  function tagSeiteDrei(seite) {
    const d = seite.datum
    const wechsel = wechselButtons(d, 'tag')
    const spalten = Math.max(4, navSpalten(wechsel.length))
    const felder = tagesNavigation(d, spalten, wechsel)
    const heuteBreite = spalten - 3
    const drei = [
      { tag: plusTage(d, -1), wort: K('gestern'), x: 1, breite: 1 },
      { tag: d, wort: K('heute'), x: 2, breite: heuteBreite, heute: true },
      { tag: plusTage(d, 1), wort: K('morgen'), x: 2 + heuteBreite, breite: 1 }
    ]
    drei.forEach((t) => {
      const ft = feiertagName(t.tag)
      felder.push(feld({
        x: t.x, y: 1, breite: t.breite,
        text: mitFeiertag(alle((l) => `${t.wort[l]} · ${tagKurz(t.tag)[l]}`), ft),
        sprechen: mitFeiertag(alle((l) => `${t.wort[l]}, ${tagLang(t.tag)[l]}`), ft, ', '),
        farbe: t.heute ? FARBE.heute : kopfFarbe(t.tag),
        ziel: t.heute ? null : zielTag(t.tag)
      }))
      slots.forEach((s, k) => felder.push(terminFeld(t.x, 2 + k, t.tag, k, 0, t.heute ? FARBE.zelle : FARBE.zelleWE, t.breite)))
    })
    slots.forEach((s, k) => felder.push(slotFeld(0, 2 + k, s)))
    return grid(seite, tagesName(d), spalten, 2 + slots.length, felder)
  }

  function monatsSeite(seite) {
    const m = seite.datum
    const vor = plusMonate(m, -1)
    const nach = plusMonate(m, 1)
    const wochentage = [...Array(7)].map((_, i) => plusTage(montagDerWoche(m), i)).filter(sichtbar)
    const wechsel = wechselButtons(m < ersterMontag ? ersterMontag : m, 'monat')
    const spalten = Math.max(wochentage.length, navSpalten(wechsel.length))
    const breite = (x) => (x === wochentage.length - 1 ? 1 + spalten - wochentage.length : 1) // letzte Spalte füllt den Rest
    const felder = navZeile(spalten, {
      zurueck: { ziel: zielMonat(vor), text: monatName(vor), sprechen: monatTitel(vor) },
      titel: monatTitel(m),
      sprechen: monatTitel(m),
      weiter: { ziel: zielMonat(nach), text: monatName(nach), sprechen: monatTitel(nach) },
      wechsel
    })
    wochentage.forEach((d, x) => felder.push(feld({
      x, y: 1, breite: breite(x), text: wtKurz(d), sprechen: format(d, { weekday: 'long' }),
      farbe: e.farbigeTage ? WOCHENTAG_FARBEN[wochentagNr(d)] : istWochenende(d) ? FARBE.kopfWE : FARBE.kopf
    })))
    for (let d = m; d < nach; d = plusTage(d, 1)) {
      if (!sichtbar(d)) continue
      const x = wochentage.findIndex((w) => wochentagNr(w) === wochentagNr(d))
      const reihe = Math.floor(tageZwischen(montagDerWoche(m), montagDerWoche(d)) / 7)
      const drin = imZeitraum(d)
      const ft = feiertagName(d)
      felder.push(feld({
        x, y: 2 + reihe, breite: breite(x),
        text: alle(() => gleichGross(d.getDate())),
        sprechen: mitFeiertag(tagLang(d), ft, ', '),
        ziel: drin ? zielTag(d) || zielWoche(d) : null,
        farbe: !drin ? FARBE.ausserhalb : ft ? FARBE.feiertag : e.farbigeTage ? WOCHENTAG_FARBEN[wochentagNr(d)] : zellFarbe(d)
      }))
    }
    return grid(seite, alle((l) => `${K('kalender')[l]} ${isoText(m).slice(0, 7)} ${monatName(m)[l]}`), spalten, 8, felder)
  }

  function uebersichtsSeite(seite) {
    const spalten = 4
    const monate = []
    for (let m = monatsAnfang(von); m <= bis; m = plusMonate(m, 1)) monate.push(m)
    const felder = [
      feld({ x: 0, y: 0, breite: spalten, text: K('kalender'), symbol: 'overview', farbe: FARBE.titel }),
      {
        // Live-Element: Asterics setzt selbst das heutige Datum in {0} ein, in der eingestellten Sprache
        id: neueId('element'), modelName: 'GridElement', modelVersion: VERSION,
        x: 0, y: 1, width: spalten, height: 1, label: K('heuteIst'), wordForms: [], image: {},
        actions: [{ id: neueId('speak'), modelName: 'GridActionSpeak', modelVersion: VERSION }],
        type: 'ELEMENT_TYPE_LIVE', mode: 'MODE_DATETIME', dateTimeFormat: 'DT_FORMAT_DATE_LONG',
        additionalProps: {}, backgroundColor: FARBE.heute
      }
    ]
    monate.forEach((m, i) => {
      const start = m < ersterMontag ? ersterMontag : m
      const tag = e.ansichten.tag ? ersterTagAb(start) : null
      felder.push(feld({
        x: i % spalten, y: 2 + Math.floor(i / spalten), text: monatTitel(m), farbe: FARBE.monat,
        ziel: zielMonat(m) || zielWoche(start) || (tag && zielTag(tag))
      }))
    })
    return grid(seite, alle((l) => `${K('kalender')[l]} · ${K('uebersicht')[l]}`), spalten, 2 + Math.ceil(monate.length / spalten), felder)
  }

  const grids = seiten.map((s) => {
    if (s.art === 'uebersicht') return uebersichtsSeite(s)
    if (s.art === 'monat') return monatsSeite(s)
    if (s.art === 'woche') return wochenSeite(s)
    return e.tagLayout === 'dreiTage' ? tagSeiteDrei(s) : tagSeiteGenauer(s)
  })

  return { backup: { grids, dictionaries: [] }, felderInfo, seiten }
}
