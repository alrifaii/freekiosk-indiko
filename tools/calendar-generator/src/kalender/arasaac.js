// ============================================================
// ARASAAC-Symbole, genau so wie Asterics AAC sie verwendet
// (nachgebaut nach Asterics-AAC/src/js/service/pictograms/arasaacService.js).
// Lizenz der Symbole: CC BY-NC-SA, https://arasaac.org/terms-of-use
// ============================================================

const API = 'https://api.arasaac.org'

const grossAnfang = (t) => t.charAt(0).toUpperCase() + t.slice(1)

// Dieselbe Bild-Adresse, die Asterics beim Einfügen eines ARASAAC-Bildes speichert
export const bildAdresse = (id) => `${API}/api/pictograms/${id}?download=false&plural=false&color=true`

// Das Bild-Objekt für ein Feld in der .grd-Datei, identisch zu Asterics (arasaacService.getGridImageById)
export function bildFuerAsterics(id) {
  return {
    url: bildAdresse(id),
    author: 'ARASAAC - CC (BY-NC-SA)',
    authorURL: 'https://arasaac.org/terms-of-use',
    searchProviderName: 'ARASAAC'
  }
}

// Suche, z. B. sucheSymbole('Schule', 'de') -> [{ id, text, url }, …]
export async function sucheSymbole(wort, sprache) {
  const suche = String(wort || '').trim()
  if (!suche) return []
  const antwort = await fetch(`${API}/api/pictograms/${sprache}/search/${encodeURIComponent(suche)}`)
  if (antwort.status === 404) return [] // so meldet ARASAAC "nichts gefunden"
  if (!antwort.ok) throw new Error('ARASAAC nicht erreichbar')
  const liste = await antwort.json()
  return liste.map((p) => ({ id: p._id, text: grossAnfang(p.keywords?.[0]?.keyword || suche), url: bildAdresse(p._id) }))
}

// Name eines Symbols in anderen Sprachen, z. B. -> { en: 'School', cs: 'Škola' }
// Was ARASAAC nicht liefert, fehlt einfach (Asterics zeigt dann eine andere vorhandene Sprache).
export async function uebersetzungen(id, sprachen) {
  const ergebnis = {}
  await Promise.all(
    sprachen.map(async (l) => {
      try {
        const antwort = await fetch(`${API}/api/pictograms/${l}/${id}`)
        if (!antwort.ok) return
        const wort = (await antwort.json()).keywords?.[0]?.keyword
        if (wort) ergebnis[l] = grossAnfang(wort)
      } catch {
        // ohne Internet keine Übersetzung, das ist in Ordnung
      }
    })
  )
  return ergebnis
}
