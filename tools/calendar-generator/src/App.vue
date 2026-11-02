<!--
  Grundgerüst der Seite: Kopfzeile mit Sprachwahl, links das Menü, rechts die Vorschau.
-->
<script setup>
import { watchEffect } from 'vue'
import EinstellungenMenue from './components/EinstellungenMenue.vue'
import Vorschau from './components/Vorschau.vue'
import { ansicht, t, sprachName, SPRACH_CODES } from './zustand.js'

// <html lang> und Titel folgen der Sprache der Seite
watchEffect(() => {
  document.documentElement.lang = ansicht.seitenSprache
  document.title = t('titel')
})
</script>

<template>
  <header class="kopf">
    <div>
      <h1>{{ t('titel') }}</h1>
      <p>{{ t('untertitel') }}</p>
    </div>
    <label class="sprachwahl">
      <span>{{ t('seitenSprache') }}</span>
      <select id="seitenSprache" v-model="ansicht.seitenSprache">
        <option v-for="l in SPRACH_CODES" :key="l" :value="l">{{ sprachName(l) }}</option>
      </select>
    </label>
  </header>

  <main class="layout">
    <EinstellungenMenue />
    <Vorschau />
  </main>
</template>
