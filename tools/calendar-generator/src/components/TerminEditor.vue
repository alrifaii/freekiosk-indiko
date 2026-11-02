<!--
  Bearbeiten eines angeklickten Termins: Text in allen Sprachen, Wiederholung, Löschen.
-->
<script setup>
import { computed } from 'vue'
import {
  einstellungen, ansicht, t, sprachName, datumText, SPRACH_CODES,
  nurHierEntfernen, serieLoeschen, wiederholungAendern, ausnahmenZuruecksetzen
} from '../zustand.js'
import { textZuDatum } from '../kalender/datum.js'
import { WIEDERHOLUNGEN } from '../kalender/termine.js'

const termin = computed(() => einstellungen.termine.find((x) => x.id === ansicht.bearbeiteId))
// Grid-Sprache zuerst, dann die anderen
const sprachen = computed(() => [ansicht.gridSprache, ...SPRACH_CODES.filter((l) => l !== ansicht.gridSprache)])
</script>

<template>
  <div v-if="termin" class="editor">
    <img :src="termin.symbol.url" alt="" />
    <div class="editor-mitte">
      <div class="sprachen">
        <label v-for="l in sprachen" :key="l" class="eingabe" :class="{ aktiv: l === ansicht.gridSprache }">
          <span>{{ t('textIn', { sprache: sprachName(l) }) }}</span>
          <input v-model="termin.text[l]" :placeholder="Object.values(termin.text).find(Boolean)" />
        </label>
      </div>
      <div class="editor-zeile">
        <label class="eingabe">
          <span>{{ t('wiederholung') }}</span>
          <select :value="termin.wiederholung" @change="wiederholungAendern(termin, $event.target.value)">
            <option v-for="w in WIEDERHOLUNGEN" :key="w" :value="w">{{ t('wiederholungen')[w] }}</option>
          </select>
        </label>
        <span class="hinweis">
          {{ t('ab', { datum: datumText(textZuDatum(termin.datum)) }) }}
          <template v-if="termin.ausnahmen.length">
            · {{ t('ausnahmen', { anzahl: termin.ausnahmen.length }) }}
            <button class="link" @click="ausnahmenZuruecksetzen(termin)">{{ t('zuruecksetzen') }}</button>
          </template>
        </span>
      </div>
      <div class="editor-zeile">
        <button v-if="termin.wiederholung !== 'einmal'" @click="nurHierEntfernen(termin.id, ansicht.bearbeitetAm)">
          {{ t('nurAmEntfernen', { datum: datumText(ansicht.bearbeitetAm) }) }}
        </button>
        <button class="rot" @click="serieLoeschen(termin.id)">{{ termin.wiederholung === 'einmal' ? t('terminLoeschen') : t('serieLoeschen') }}</button>
        <button @click="ansicht.bearbeiteId = null">{{ t('fertig') }}</button>
      </div>
    </div>
  </div>
</template>
