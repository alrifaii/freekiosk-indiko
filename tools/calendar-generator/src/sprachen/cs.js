// Čeština
// "oberflaeche" = texty webové stránky, "kalender" = texty, které se zapisují do tabulek Asterics.
// Zástupné znaky ve {složených závorkách} se při zobrazení nahradí.

export default {
  code: 'cs',
  name: 'Čeština',
  locale: 'cs-CZ',

  oberflaeche: {
    titel: 'Generátor kalendáře pro Asterics AAC',
    untertitel: 'Vytvoří propojené kalendářové tabulky jako soubor, který naimportujete do Asterics AAC.',
    seitenSprache: 'Jazyk stránky',

    ansichtenTitel: 'Které tabulky chcete?',
    ansichten: {
      uebersicht: { name: 'Přehled', text: '„Dnes je …" a měsíce' },
      monat: { name: 'Měsíc', text: 'jedna tabulka na měsíc' },
      woche: { name: 'Týden', text: 'jedna tabulka na týden' },
      tag: { name: 'Den', text: 'jedna tabulka na den' }
    },
    tagGenauer: 'Jeden den podrobně',
    tagDrei: 'Včera · Dnes · Zítra',
    felderProAbschnitt: 'Políček na část dne',
    ansichtenHinweis: 'Zapnutá zobrazení jsou na každé tabulce propojena tlačítky.',

    artTitel: 'Druh',
    arten: {
      abschnitte: { name: 'Týdenní plán', text: 'Části dne se symboly.' },
      stundenplan: { name: 'Rozvrh', text: 'Hodiny s časem.' }
    },

    zeitraumTitel: 'Období',
    von: 'Od',
    bis: 'Do',
    dieserMonat: 'Tento měsíc',
    bisJahresende: 'Do konce roku',
    schuljahr: 'Školní rok',
    wochenende: 'Zobrazit víkend',

    abschnitteTitel: 'Části dne',
    abschnitteHinweis: 'Název se upravuje v jazyce tabulky ({sprache}).',
    abschnittName: 'Název',
    abschnittHinzufuegen: '+ Část dne',
    symbolWechseln: 'Změnit symbol',
    entfernen: 'Odebrat',

    einheitenTitel: 'Hodiny',
    anzahl: 'Počet',
    beginn: 'Začátek',
    dauer: 'Délka (min)',
    pause: 'Přestávka (min)',
    anordnung: 'Uspořádání týdne',
    tageZeilen: 'Dny pod sebou, časy vedle sebe',
    tageSpalten: 'Dny vedle sebe, časy pod sebou',

    symboleTitel: 'Symboly (ARASAAC)',
    suchePlatzhalter: 'Hledat symbol, např. škola',
    suchen: 'Hledat',
    vorschlaege: ['Škola', 'Jíst', 'Plavat', 'Lékař', 'Terapie', 'Autobus', 'Hrát', 'Nakupovat', 'Babička', 'Spát'],
    sucheLaeuft: 'Hledám …',
    nichtsGefunden: 'Nic nenalezeno, zkuste jiné slovo.',
    arasaacFehler: 'ARASAAC není dostupný. Jste online?',
    neueWiederholen: 'Opakovat nové symboly',
    lizenz: 'Symboly ARASAAC, licence CC BY-NC-SA, arasaac.org',
    wiederholungen: {
      einmal: 'Jen jednou',
      woche: 'Každý týden',
      zweiWochen: 'Každé 2 týdny',
      werktag: 'Každý pracovní den (po–pá)'
    },

    feiertageTitel: 'Svátky',
    feiertageFuer: 'Zobrazit svátky pro',
    feiertagLaender: { '': 'Žádné', at: 'Rakousko', cz: 'Česko' },
    feiertageAuslassen: 'Opakované události o svátcích vynechat',

    aussehenTitel: 'Vzhled',
    farbigeTage: 'Barevné dny v týdnu',
    eigeneSymbole: 'Vlastní symboly pro šipky a části dne',

    vorschau: 'Náhled',
    vorherigeSeite: 'Předchozí stránka',
    naechsteSeite: 'Další stránka',
    gridSprache: 'Jazyk tabulky',
    gridSpracheHinweis: 'Soubor obsahuje všechny jazyky. Asterics zobrazí jazyk nastavený v jeho nastavení.',

    rueckgaengig: '↶ Zpět',
    wiederholen: '↷ Znovu',
    seiteLeeren: 'Vyprázdnit tuto stránku',
    seiteLeerenHinweis: 'Odebrat události na této stránce, série zůstanou v ostatních týdnech',
    alleLoeschen: 'Smazat všechny události',
    wirklichLoeschen: 'Opravdu smazat všech {anzahl}?',
    ja: 'Ano, smazat',
    nein: 'Ne',

    nurHierEntfernen: 'Odebrat jen v tento den',
    nurAmEntfernen: 'Odebrat jen {datum}',
    terminLoeschen: 'Smazat událost',
    serieLoeschen: 'Smazat celou sérii',
    fertig: 'Hotovo',
    textIn: 'Text {sprache}',
    wiederholung: 'Opakování',
    ab: 'od {datum}',
    ausnahmen: '{anzahl} výjimka/y',
    zuruecksetzen: 'obnovit',
    gewaehlt: '„{name}" vybráno ({wiederholung}). Teď klepněte na políčko.',
    tipps: [
      'Přetáhněte symbol na políčko, nebo na něj klepněte a pak klepněte na políčko',
      'Klepnutím na událost ji upravíte · ✕ ji odebere jen v tento den',
      'Přetažením události na jiné políčko ji přesunete · modrá políčka listují'
    ],

    herunterladen: '⬇ Vytvořit a stáhnout soubor',

    anTablets: '➜ Odeslat do tabletů',
    statistik: '{grids} tabulek · cca {kb} KB · {termine} událostí · stránka {seite} z {seiten}',
    importTitel: 'Jak soubor naimportovat do Asterics AAC',
    importSchritte: [
      'Otevřete „Spravovat tabulky" a vpravo nahoře klepněte na „více".',
      'Zvolte „Importovat vlastní data ze souboru" a vyberte soubor .grd.',
      'Ve své domovské tabulce vytvořte prvek s akcí „Přejít na tabulku" na kalendář.'
    ],
    importWarnung: 'Nepoužívejte „Obnovit zálohu ze souboru", smaže všechny stávající tabulky.',

    fehlerKeineAnsicht: 'Vyberte prosím alespoň měsíc, týden nebo den.',
    fehlerZuViele: 'To by bylo {anzahl} tabulek. Zvolte prosím kratší období nebo méně zobrazení (max. {max}).'
  },

  kalender: {
    kalender: 'Kalendář',
    kw: 'Týd.',
    kwSprechen: 'Týden',
    uebersicht: 'Přehled',
    monat: 'Měsíc',
    woche: 'Týden',
    tag: 'Den',
    gestern: 'Včera',
    heute: 'Dnes',
    morgen: 'Zítra',
    heuteIst: 'Dnes je {0}',
    wocheVonBis: 'Týden od {von} do {bis}',
    abschnitte: { morgen: 'Ráno', vormittag: 'Dopoledne', mittag: 'Poledne', nachmittag: 'Odpoledne', abend: 'Večer', nacht: 'Noc' }
  }
}
