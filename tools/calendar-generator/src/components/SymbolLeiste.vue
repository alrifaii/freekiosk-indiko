<!--
  Suche nach ARASAAC-Symbolen. Treffer kann man in die Vorschau ziehen
  oder antippen und danach ein Feld antippen. Gesucht wird in der Grid-Sprache.
-->
<script setup>
import { ref, watch } from 'vue'
import { ansicht, t } from '../zustand.js'
import { SPRACHEN } from '../sprachen/index.js'
import { sucheSymbole } from '../kalender/arasaac.js'
import { WIEDERHOLUNGEN } from '../kalender/termine.js'

const suchwort = ref('')
const treffer = ref([])
const status = ref('') // '', 'laedt', 'leer', 'fehler'

const vorschlaege = () => SPRACHEN[ansicht.gridSprache].oberflaeche.vorschlaege

async function suchen(wort) {
  if (wort) suchwort.value = wort
  status.value = 'laedt'
  try {
    treffer.value = (await sucheSymbole(suchwort.value, ansicht.gridSprache)).slice(0, 30)
    status.value = treffer.value.length ? '' : 'leer'
  } catch {
    treffer.value = []
    status.value = 'fehler'
  }
}
// beim Start und wenn die Grid-Sprache wechselt: mit dem ersten Vorschlag suchen
watch(() => ansicht.gridSprache, () => suchen(vorschlaege()[0]), { immediate: true })

function waehlen(symbol) {
  ansicht.gewaehlt = ansicht.gewaehlt?.id === symbol.id ? null : symbol
  ansicht.bearbeiteId = null
}
function ziehen(event, symbol) {
  event.dataTransfer.setData('application/x-symbol', JSON.stringify(symbol))
  event.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <fieldset>
    <legend>{{ t('symboleTitel') }}</legend>
    <form class="suche" @submit.prevent="suchen()">
      <input id="symbolSuche" v-model="suchwort" :placeholder="t('suchePlatzhalter')" />
      <button class="klein" type="submit">{{ t('suchen') }}</button>
    </form>
    <div class="chips">
      <button v-for="v in vorschlaege()" :key="v" class="chip" @click="suchen(v)">{{ v }}</button>
    </div>

    <p v-if="status === 'laedt'" class="hinweis">{{ t('sucheLaeuft') }}</p>
    <p v-else-if="status === 'leer'" class="hinweis">{{ t('nichtsGefunden') }}</p>
    <p v-else-if="status === 'fehler'" class="hinweis warnung">{{ t('arasaacFehler') }}</p>

    <div class="palette" :lang="ansicht.gridSprache">
      <button
        v-for="s in treffer" :key="s.id"
        class="symbol" :class="{ gewaehlt: ansicht.gewaehlt?.id === s.id }"
        draggable="true" :title="s.text"
        @dragstart="ziehen($event, s)" @click="waehlen(s)"
      >
        <img :src="s.url" :alt="s.text" loading="lazy" />
        <span>{{ s.text }}</span>
      </button>
    </div>

    <label class="eingabe">
      <span>{{ t('neueWiederholen') }}</span>
      <select v-model="ansicht.neueWiederholung">
        <option v-for="w in WIEDERHOLUNGEN" :key="w" :value="w">{{ t('wiederholungen')[w] }}</option>
      </select>
    </label>
    <p class="lizenz">{{ t('lizenz') }}</p>
  </fieldset>
</template>
