<!--
  Rechte Spalte: zeigt das aktuelle Grid so, wie es in Asterics aussieht (16:10 wie ein Tablet quer).
  Oben: Blättern und Grid-Sprache. Darüber Werkzeuge. Darunter Bearbeiten und Download.
-->
<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import TerminEditor from './TerminEditor.vue'
import {
  einstellungen, ansicht, t, sprachName, SPRACH_CODES,
  ergebnis, grids, felderInfo, aktuelleNr, aktuellesGrid, groesseKB,
  setzeSeite, blaettern, springeZuGrid, verlauf, rueckgaengig, wiederholen,
  symbolSetzen, nurHierEntfernen, verschieben, seiteLeeren, alleTermineLoeschen, herunterladen, imKit
} from '../zustand.js'
import { SPRACHEN, inSprache } from '../sprachen/index.js'
import { isoText } from '../kalender/datum.js'

const info = (f) => felderInfo.value[f.id]
const bild = (f) => f.image?.data || f.image?.url
const istSprung = (f) => f.actions.some((a) => a.modelName === 'GridActionNavigate')

// Text eines Feldes in der Grid-Sprache. Das Live-Element ("Heute ist {0}") füllt Asterics selbst, hier simuliert.
function feldText(f) {
  const text = inSprache(f.label, ansicht.gridSprache)
  if (f.type !== 'ELEMENT_TYPE_LIVE') return text
  const heute = new Date().toLocaleDateString(SPRACHEN[ansicht.gridSprache].locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return text.replace('{0}', heute)
}

// Position im CSS-Grid (Asterics zählt ab 0, CSS ab 1)
const feldStil = (f) => ({ gridColumn: `${f.x + 1} / span ${f.width}`, gridRow: `${f.y + 1} / span ${f.height}`, background: f.backgroundColor || '#fff' })

function geklickt(f) {
  const i = info(f)
  if (ansicht.gewaehlt && i) return symbolSetzen(i, ansicht.gewaehlt)
  if (i?.terminId) return Object.assign(ansicht, { bearbeiteId: i.terminId, bearbeitetAm: i.datum })
  const ziel = f.actions.find((a) => a.toGridId)?.toGridId
  if (ziel) springeZuGrid(ziel)
}

// Ziehen und Ablegen: neues Symbol aus der Leiste oder Termin von einem anderen Feld
const zielFeld = ref(null)
function ziehenAusFeld(event, f) {
  const i = info(f)
  if (!i?.terminId) return event.preventDefault()
  event.dataTransfer.setData('application/x-termin', JSON.stringify({ id: i.terminId, tag: isoText(i.datum) }))
}
function abgelegt(event, f) {
  zielFeld.value = null
  const symbol = event.dataTransfer.getData('application/x-symbol')
  const termin = event.dataTransfer.getData('application/x-termin')
  if (symbol) symbolSetzen(info(f), JSON.parse(symbol))
  else if (termin) {
    const { id, tag } = JSON.parse(termin)
    verschieben(id, tag, info(f))
  }
}

const loeschFrage = ref(false)
function allesLoeschen() {
  alleTermineLoeschen()
  loeschFrage.value = false
}

// Strg+Z / Strg+Y
function tasten(event) {
  if (!(event.ctrlKey || event.metaKey) || ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return
  const taste = event.key.toLowerCase()
  if (taste === 'z' && !event.shiftKey) { event.preventDefault(); rueckgaengig() }
  if (taste === 'y' || (taste === 'z' && event.shiftKey)) { event.preventDefault(); wiederholen() }
}
onMounted(() => window.addEventListener('keydown', tasten))
onBeforeUnmount(() => window.removeEventListener('keydown', tasten))
</script>

<template>
  <section class="panel vorschau">
    <div class="vorschau-kopf">
      <h2>{{ t('vorschau') }}</h2>
      <div class="blaettern">
        <button class="pfeil" :disabled="aktuelleNr === 0" :title="t('vorherigeSeite')" @click="blaettern(-1)">‹</button>
        <select id="seitenwahl" class="seitenwahl" :value="aktuelleNr" @change="setzeSeite(Number($event.target.value))">
          <option v-for="(g, i) in grids" :key="g.id" :value="i">{{ inSprache(g.label, ansicht.gridSprache) }}</option>
        </select>
        <button class="pfeil" :disabled="aktuelleNr >= grids.length - 1" :title="t('naechsteSeite')" @click="blaettern(1)">›</button>
      </div>
      <label class="gridsprache" :title="t('gridSpracheHinweis')">
        <span>{{ t('gridSprache') }}</span>
        <select id="gridSprache" v-model="ansicht.gridSprache">
          <option v-for="l in SPRACH_CODES" :key="l" :value="l">{{ sprachName(l) }}</option>
        </select>
      </label>
    </div>

    <div class="werkzeuge">
      <button :disabled="!verlauf.zurueck.length" title="Ctrl+Z" @click="rueckgaengig">{{ t('rueckgaengig') }}</button>
      <button :disabled="!verlauf.vor.length" title="Ctrl+Y" @click="wiederholen">{{ t('wiederholen') }}</button>
      <span class="trenner"></span>
      <button :disabled="!einstellungen.termine.length" :title="t('seiteLeerenHinweis')" @click="seiteLeeren">{{ t('seiteLeeren') }}</button>
      <button v-if="!loeschFrage" :disabled="!einstellungen.termine.length" @click="loeschFrage = true">{{ t('alleLoeschen') }}</button>
      <span v-else class="frage">
        {{ t('wirklichLoeschen', { anzahl: einstellungen.termine.length }) }}
        <button class="rot" @click="allesLoeschen">{{ t('ja') }}</button>
        <button @click="loeschFrage = false">{{ t('nein') }}</button>
      </span>
    </div>

    <!-- das "Tablet": immer 16:10, die Felder teilen sich den Platz -->
    <div class="geraet" :lang="ansicht.gridSprache">
      <p v-if="ergebnis.fehler" class="fehler">{{ ergebnis.fehler }}</p>
      <div
        v-else-if="aktuellesGrid" class="grid"
        :style="{ gridTemplateColumns: `repeat(${aktuellesGrid.minColumnCount}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${aktuellesGrid.rowCount}, minmax(0, 1fr))` }"
      >
        <div
          v-for="f in aktuellesGrid.gridElements" :key="f.id"
          class="zelle"
          :class="{
            sprung: istSprung(f),
            termin: info(f)?.art === 'termin',
            belegt: info(f)?.terminId,
            markiert: info(f)?.terminId && info(f).terminId === ansicht.bearbeiteId,
            ablage: info(f) && (ansicht.gewaehlt || zielFeld === f.id)
          }"
          :style="feldStil(f)"
          role="button" tabindex="0"
          :draggable="Boolean(info(f)?.terminId)"
          @click="geklickt(f)" @keydown.enter="geklickt(f)"
          @dragstart="ziehenAusFeld($event, f)"
          @dragover.prevent="info(f) && (zielFeld = f.id)"
          @dragleave="zielFeld = null"
          @drop.prevent="abgelegt($event, f)"
        >
          <img v-if="bild(f)" :src="bild(f)" alt="" draggable="false" />
          <span v-if="feldText(f)">{{ feldText(f) }}</span>
          <button v-if="info(f)?.terminId" class="entfernen" :title="t('nurHierEntfernen')" @click.stop="nurHierEntfernen(info(f).terminId, info(f).datum)">✕</button>
        </div>
      </div>
    </div>

    <!-- feste Höhe, damit unter dem Tablet nichts springt -->
    <div class="unten">
      <TerminEditor v-if="ansicht.bearbeiteId" />
      <p v-else-if="ansicht.gewaehlt" class="auswahl">
        <img :src="ansicht.gewaehlt.url" alt="" />
        {{ t('gewaehlt', { name: ansicht.gewaehlt.text, wiederholung: t('wiederholungen')[ansicht.neueWiederholung] }) }}
        <button class="weg" @click="ansicht.gewaehlt = null">✕</button>
      </p>
      <ul v-else class="tipps">
        <li v-for="tipp in t('tipps')" :key="tipp">{{ tipp }}</li>
      </ul>
    </div>

    <div class="download">
      <button class="haupt" :disabled="!ergebnis.backup" @click="herunterladen">{{ imKit ? t('anTablets') : t('herunterladen') }}</button>
      <span class="hinweis">{{ t('statistik', { grids: grids.length, kb: groesseKB, termine: einstellungen.termine.length, seite: aktuelleNr + 1, seiten: grids.length }) }}</span>
    </div>
    <details v-if="!imKit" class="import">
      <summary>{{ t('importTitel') }}</summary>
      <ol>
        <li v-for="schritt in t('importSchritte')" :key="schritt">{{ schritt }}</li>
      </ol>
      <p class="warnung">{{ t('importWarnung') }}</p>
    </details>
  </section>
</template>
