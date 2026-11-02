// Kleine, selbst gezeichnete Symbole (keine fremde Lizenz nötig).
// Sie werden als "data:"-Bild direkt in die Datei geschrieben, damit Asterics sie ohne Internet anzeigt.

const svg = (inhalt) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inhalt}</svg>`

// Name -> SVG. Pfeile, Haus, Ansicht-Buttons und Tagesabschnitte.
const SVGS = {
    prev: svg('<path d="M62 14 L26 50 L62 86" fill="none" stroke="#1f4e79" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>'),
    next: svg('<path d="M38 14 L74 50 L38 86" fill="none" stroke="#1f4e79" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>'),
    overview: svg('<rect x="12" y="18" width="76" height="68" rx="8" fill="#ffffff" stroke="#1f4e79" stroke-width="7"/><rect x="12" y="18" width="76" height="18" rx="6" fill="#1f4e79"/><g fill="#1f4e79"><rect x="22" y="46" width="12" height="10"/><rect x="44" y="46" width="12" height="10"/><rect x="66" y="46" width="12" height="10"/><rect x="22" y="66" width="12" height="10"/><rect x="44" y="66" width="12" height="10"/><rect x="66" y="66" width="12" height="10"/></g>'),
    ansichtTag: svg('<rect x="18" y="14" width="64" height="72" rx="8" fill="#ffffff" stroke="#1f4e79" stroke-width="7"/><rect x="18" y="14" width="64" height="18" rx="6" fill="#1f4e79"/><rect x="32" y="44" width="36" height="30" rx="3" fill="#f6a03c"/>'),
    ansichtWoche: svg('<rect x="8" y="22" width="84" height="56" rx="8" fill="#ffffff" stroke="#1f4e79" stroke-width="7"/><g fill="#1f4e79"><rect x="18" y="34" width="8" height="34"/><rect x="31" y="34" width="8" height="34"/><rect x="44" y="34" width="8" height="34"/><rect x="57" y="34" width="8" height="34"/><rect x="70" y="34" width="8" height="34" fill="#f6a03c"/></g>'),
    ansichtMonat: svg('<rect x="10" y="14" width="80" height="74" rx="8" fill="#ffffff" stroke="#1f4e79" stroke-width="7"/><g fill="#1f4e79"><rect x="20" y="28" width="10" height="9"/><rect x="36" y="28" width="10" height="9"/><rect x="52" y="28" width="10" height="9"/><rect x="68" y="28" width="10" height="9"/><rect x="20" y="44" width="10" height="9"/><rect x="36" y="44" width="10" height="9"/><rect x="52" y="44" width="10" height="9" fill="#f6a03c"/><rect x="68" y="44" width="10" height="9"/><rect x="20" y="60" width="10" height="9"/><rect x="36" y="60" width="10" height="9"/><rect x="52" y="60" width="10" height="9"/><rect x="68" y="60" width="10" height="9"/></g>'),
    morning: svg('<path d="M10 72 H90" stroke="#8a6d3b" stroke-width="6" stroke-linecap="round"/><path d="M24 72 A26 26 0 0 1 76 72 Z" fill="#f6b73c"/><g stroke="#f6b73c" stroke-width="6" stroke-linecap="round"><path d="M50 20 V32"/><path d="M18 36 L26 44"/><path d="M82 36 L74 44"/></g>'),
    midday: svg('<circle cx="50" cy="50" r="20" fill="#f9c80e"/><g stroke="#f9c80e" stroke-width="7" stroke-linecap="round"><path d="M50 8 V20"/><path d="M50 80 V92"/><path d="M8 50 H20"/><path d="M80 50 H92"/><path d="M20 20 L28 28"/><path d="M72 72 L80 80"/><path d="M80 20 L72 28"/><path d="M28 72 L20 80"/></g>'),
    afternoon: svg('<circle cx="40" cy="42" r="20" fill="#f6a03c"/><path d="M30 78 Q30 58 50 58 Q56 46 70 50 Q86 52 86 66 Q92 78 80 80 H36 Q28 80 30 78 Z" fill="#dfe7ee" stroke="#9aaab8" stroke-width="3"/>'),
    evening: svg('<path d="M64 14 A36 36 0 1 0 86 66 A28 28 0 1 1 64 14 Z" fill="#5b6fb3"/><g fill="#f9c80e"><circle cx="76" cy="26" r="4"/><circle cx="84" cy="44" r="3"/></g>'),
    night: svg('<rect x="8" y="8" width="84" height="84" rx="14" fill="#1f2a4d"/><path d="M58 22 A28 28 0 1 0 78 64 A22 22 0 1 1 58 22 Z" fill="#f4e6a1"/>'),
    meal: svg('<circle cx="50" cy="54" r="30" fill="#ffffff" stroke="#8a8a8a" stroke-width="6"/><circle cx="50" cy="54" r="16" fill="none" stroke="#c9c9c9" stroke-width="4"/><path d="M12 18 V44 M6 18 V34 Q6 44 12 44 Q18 44 18 34 V18" stroke="#8a8a8a" stroke-width="4" fill="none"/><path d="M88 18 Q78 26 80 44 H88 Z" fill="#8a8a8a"/>'),
    school: svg('<path d="M10 40 L50 20 L90 40 L50 60 Z" fill="#3c78b4"/><path d="M28 50 V70 Q50 82 72 70 V50 L50 61 Z" fill="#5d93c9"/><path d="M84 43 V68" stroke="#3c78b4" stroke-width="5"/>')
}

// Symbole, die man für Tagesabschnitte auswählen kann (in dieser Reihenfolge durchklicken)
export const ABSCHNITT_SYMBOLE = ['morning', 'midday', 'afternoon', 'evening', 'night', 'meal', 'school']

// Name -> Bild-Adresse, die Asterics und der Browser direkt anzeigen können
export function symbolBild(name) {
  if (!name || !SVGS[name]) return null
  return 'data:image/svg+xml;base64,' + btoa(SVGS[name])
}
