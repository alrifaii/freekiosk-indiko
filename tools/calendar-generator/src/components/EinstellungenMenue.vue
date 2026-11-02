<!--
  Linke Spalte: alle Einstellungen, von oben nach unten.
  Ansichten · Art · Zeitraum · Tagesabschnitte/Einheiten · Symbole · Feiertage · Aussehen
-->
<script setup>
import { computed } from 'vue'
import SymbolLeiste from './SymbolLeiste.vue'
import { einstellungen, ansicht, t, sprachName, ansichtAn, ansichtUmschalten } from '../zustand.js'
import { isoText, zeitSlots } from '../kalender/datum.js'
import { FEIERTAG_LAENDER } from '../kalender/feiertage.js'
import { symbolBild, ABSCHNITT_SYMBOLE } from '../kalender/symbole.js'

const ANSICHTEN = ['uebersicht', 'monat', 'woche', 'tag']
const ARTEN = ['abschnitte', 'stundenplan']

const uhrzeiten = computed(() => zeitSlots(einstellungen.stunden).join(' · '))

function zeitraum(art) {
  const d = new Date()
  if (art === 'monat') [einstellungen.vonDatum, einstellungen.bisDatum] = [isoText(d), isoText(new Date(d.getFullYear(), d.getMonth() + 1, 0))]
  if (art === 'jahresende') [einstellungen.vonDatum, einstellungen.bisDatum] = [isoText(d), `${d.getFullYear()}-12-31`]
  if (art === 'schuljahr') {
    const j = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1
    ;[einstellungen.vonDatum, einstellungen.bisDatum] = [`${j}-09-01`, `${j + 1}-06-30`]
  }
}

// Tagesabschnitte: Name wird in der Grid-Sprache bearbeitet, Symbol per Klick durchgeschaltet
const symbolSrc = (s) => (s && typeof s === 'object' ? s.url : symbolBild(s))
function naechstesSymbol(a) {
  const liste = [...ABSCHNITT_SYMBOLE, null]
  a.symbol = liste[(liste.indexOf(typeof a.symbol === 'string' ? a.symbol : null) + 1) % liste.length]
}
const abschnittHinzufuegen = () => einstellungen.abschnitte.push({ name: {}, symbol: null })
</script>

<template>
  <section class="panel menue">
    <fieldset>
      <legend>{{ t('ansichtenTitel') }}</legend>
      <div class="ansicht-karten">
        <button v-for="a in ANSICHTEN" :key="a" class="ansicht" :class="{ an: ansichtAn(a) }" :aria-pressed="ansichtAn(a)" @click="ansichtUmschalten(a)">
          <span class="haekchen">{{ ansichtAn(a) ? '✓' : '' }}</span>
          <strong>{{ t(`ansichten.${a}.name`) }}</strong>
          <small>{{ t(`ansichten.${a}.text`) }}</small>
        </button>
      </div>
      <template v-if="einstellungen.ansichten.tag">
        <div class="schalter">
          <button :class="{ an: einstellungen.tagLayout === 'genauer' }" @click="einstellungen.tagLayout = 'genauer'">{{ t('tagGenauer') }}</button>
          <button :class="{ an: einstellungen.tagLayout === 'dreiTage' }" @click="einstellungen.tagLayout = 'dreiTage'">{{ t('tagDrei') }}</button>
        </div>
        <label v-if="einstellungen.tagLayout === 'genauer'" class="eingabe reihe">
          <span>{{ t('felderProAbschnitt') }}</span>
          <input id="felderProAbschnitt" type="number" min="1" max="8" v-model.number="einstellungen.felderProAbschnitt" />
        </label>
      </template>
      <p class="hinweis">{{ t('ansichtenHinweis') }}</p>
    </fieldset>

    <fieldset>
      <legend>{{ t('artTitel') }}</legend>
      <div class="arten">
        <label v-for="a in ARTEN" :key="a" class="art" :class="{ an: einstellungen.art === a }">
          <input type="radio" name="art" :value="a" v-model="einstellungen.art" />
          <span class="mini" :class="'mini-' + a" aria-hidden="true"><i v-for="n in 16" :key="n"></i></span>
          <strong>{{ t(`arten.${a}.name`) }}</strong>
          <small>{{ t(`arten.${a}.text`) }}</small>
        </label>
      </div>
    </fieldset>

    <fieldset>
      <legend>{{ t('zeitraumTitel') }}</legend>
      <div class="zwei">
        <label class="eingabe"><span>{{ t('von') }}</span><input id="vonDatum" type="date" v-model="einstellungen.vonDatum" /></label>
        <label class="eingabe"><span>{{ t('bis') }}</span><input id="bisDatum" type="date" v-model="einstellungen.bisDatum" :min="einstellungen.vonDatum" /></label>
      </div>
      <div class="chips">
        <button class="chip" @click="zeitraum('monat')">{{ t('dieserMonat') }}</button>
        <button class="chip" @click="zeitraum('jahresende')">{{ t('bisJahresende') }}</button>
        <button class="chip" @click="zeitraum('schuljahr')">{{ t('schuljahr') }}</button>
      </div>
      <label class="haken"><input type="checkbox" v-model="einstellungen.wochenende" /> {{ t('wochenende') }}</label>
    </fieldset>

    <fieldset v-if="einstellungen.art === 'abschnitte'">
      <legend>{{ t('abschnitteTitel') }}</legend>
      <p class="hinweis">{{ t('abschnitteHinweis', { sprache: sprachName(ansicht.gridSprache) }) }}</p>
      <ul class="abschnitte">
        <li v-for="(a, i) in einstellungen.abschnitte" :key="i">
          <button class="symbol-knopf" :title="t('symbolWechseln')" @click="naechstesSymbol(a)">
            <img v-if="a.symbol" :src="symbolSrc(a.symbol)" alt="" />
            <span v-else>–</span>
          </button>
          <input v-model="a.name[ansicht.gridSprache]" :placeholder="Object.values(a.name).find(Boolean) || t('abschnittName')" />
          <button class="weg" :title="t('entfernen')" @click="einstellungen.abschnitte.splice(i, 1)">✕</button>
        </li>
      </ul>
      <button class="klein" @click="abschnittHinzufuegen">{{ t('abschnittHinzufuegen') }}</button>
    </fieldset>

    <fieldset v-else>
      <legend>{{ t('einheitenTitel') }}</legend>
      <div class="zwei">
        <label class="eingabe"><span>{{ t('anzahl') }}</span><input type="number" min="1" max="12" v-model.number="einstellungen.stunden.anzahl" /></label>
        <label class="eingabe"><span>{{ t('beginn') }}</span><input type="time" v-model="einstellungen.stunden.beginn" /></label>
        <label class="eingabe"><span>{{ t('dauer') }}</span><input type="number" min="5" max="240" step="5" v-model.number="einstellungen.stunden.dauer" /></label>
        <label class="eingabe"><span>{{ t('pause') }}</span><input type="number" min="0" max="120" step="5" v-model.number="einstellungen.stunden.pause" /></label>
      </div>
      <p class="uhrzeiten">{{ uhrzeiten }}</p>
      <label class="eingabe">
        <span>{{ t('anordnung') }}</span>
        <select v-model="einstellungen.ausrichtung">
          <option value="tageZeilen">{{ t('tageZeilen') }}</option>
          <option value="tageSpalten">{{ t('tageSpalten') }}</option>
        </select>
      </label>
    </fieldset>

    <SymbolLeiste />

    <fieldset>
      <legend>{{ t('feiertageTitel') }}</legend>
      <label class="eingabe">
        <span>{{ t('feiertageFuer') }}</span>
        <select v-model="einstellungen.feiertagsLand">
          <option v-for="l in FEIERTAG_LAENDER" :key="l" :value="l">{{ t('feiertagLaender')[l] }}</option>
        </select>
      </label>
      <label v-if="einstellungen.feiertagsLand" class="haken">
        <input type="checkbox" v-model="einstellungen.feiertageAuslassen" /> {{ t('feiertageAuslassen') }}
      </label>
    </fieldset>

    <fieldset>
      <legend>{{ t('aussehenTitel') }}</legend>
      <label class="haken"><input type="checkbox" v-model="einstellungen.farbigeTage" /> {{ t('farbigeTage') }}</label>
      <label class="haken"><input type="checkbox" v-model="einstellungen.symbole" /> {{ t('eigeneSymbole') }}</label>
    </fieldset>
  </section>
</template>
