// inDiKo Kit: navigation, shared helpers and the "Einrichten" (QR) view.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const STORE = "fkkit.v3";
  const OLD_STORE = "fkkit.v2";

  // ---------------------------------------------------------------- helpers
  const ICONS = {
    refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
    power: "M12 3v8M6.3 6.6a8 8 0 1 0 11.4 0",
    sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
    volume: "M4 9v6h4l5 4V5L8 9H4zM16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11",
    bluetooth: "M7 7l10 10-5 4V3l5 4L7 17",
    wifi: "M2.5 8.8a14 14 0 0 1 19 0M5.5 12.2a9.5 9.5 0 0 1 13 0M8.7 15.5a5 5 0 0 1 6.6 0M12 19h.01",
    bell: "M18 16v-5a6 6 0 0 0-12 0v5l-2 2h16zM10 20.5a2 2 0 0 0 4 0",
    message: "M4 5h16v11H9l-5 4z",
    eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    moon: "M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z",
    check: "M5 12l5 5L20 7",
    x: "M6 6l12 12M18 6L6 18",
    search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
    trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
    plus: "M12 5v14M5 12h14",
    keyboard: "M3 7h18v10H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
    key: "M7.5 15.5a4 4 0 1 1 3.9-5H21v3h-2v3h-3v-3h-4.6a4 4 0 0 1-3.9 2z",
    grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    download: "M12 3v12M7 10l5 5 5-5M5 21h14",
    shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-4.5",
    tablet: "M6 2.5h12a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2zM11 18.5h2",
    plug: "M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5",
    home: "M4 11l8-7 8 7M6 9.5V20h12V9.5",
    speak: "M4 9v6h4l5 4V5L8 9H4zM17 8l4-2M17 12h4M17 16l4 2",
    chev: "M9 6l6 6-6 6",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
    lock: "M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
    scan: "M4 8V4h4M16 4h4v4M4 16v4h4M20 16v4h-4M8 12h8",
    sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
    globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 9h17M3.5 15h17M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3z",
    cloudOff: "M3 3l18 18M8.5 6.2A6 6 0 0 1 17.6 10 4.5 4.5 0 0 1 20 18M16 19H7a5 5 0 0 1-2.4-9.4",
    camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 10.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
    play: "M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5zM10 9.5v5l4.5-2.5z",
    board: "M3 4h18v12H3zM8 20l4-4 4 4M7 9h6M7 12h4",
    school: "M2 9l10-5 10 5-10 5zM6 11v5c3 2.5 9 2.5 12 0v-5M22 9v6",
    star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3l-5.5 2.9 1-6.2L3 9.6l6.2-.9z",
    book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7",
    image: "M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 8.5h.01",
    code: "M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16",
    upload: "M12 21V9M7 14l5-5 5 5M5 3h14",
    file: "M6 3h8l4 4v14H6zM14 3v4h4",
    external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
    wand: "M4 20L15 9M14 4v2M19 9h2M17.5 5.5L19 4M18 13l1.5 1.5M9 4l1 1",
    calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
    box: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
    pen: "M4 20l1-4L16 5l3 3L8 19zM14 7l3 3",
  };
  // AsTeRICS Grid's own menu symbols (Font Awesome Free 5.2.0, icons CC BY 4.0,
  // https://fontawesome.com/license), so the kit shows the same pictures as the app.
  const FA = {
    "home": [576, 512, "M488 312.7V456c0 13.3-10.7 24-24 24H348c-6.6 0-12-5.4-12-12V356c0-6.6-5.4-12-12-12h-72c-6.6 0-12 5.4-12 12v112c0 6.6-5.4 12-12 12H112c-13.3 0-24-10.7-24-24V312.7c0-3.6 1.6-7 4.4-9.3l188-154.8c4.4-3.6 10.8-3.6 15.3 0l188 154.8c2.7 2.3 4.3 5.7 4.3 9.3zm83.6-60.9L488 182.9V44.4c0-6.6-5.4-12-12-12h-56c-6.6 0-12 5.4-12 12V117l-89.5-73.7c-17.7-14.6-43.3-14.6-61 0L4.4 251.8c-5.1 4.2-5.8 11.8-1.6 16.9l25.5 31c4.2 5.1 11.8 5.8 16.9 1.6l235.2-193.7c4.4-3.6 10.8-3.6 15.3 0l235.2 193.7c5.1 4.2 12.7 3.5 16.9-1.6l25.5-31c4.2-5.2 3.4-12.7-1.7-16.9z"],
    "list-ul": [512, 512, "M96 96c0 26.51-21.49 48-48 48S0 122.51 0 96s21.49-48 48-48 48 21.49 48 48zM48 208c-26.51 0-48 21.49-48 48s21.49 48 48 48 48-21.49 48-48-21.49-48-48-48zm0 160c-26.51 0-48 21.49-48 48s21.49 48 48 48 48-21.49 48-48-21.49-48-48-48zm96-236h352c8.837 0 16-7.163 16-16V76c0-8.837-7.163-16-16-16H144c-8.837 0-16 7.163-16 16v40c0 8.837 7.163 16 16 16zm0 160h352c8.837 0 16-7.163 16-16v-40c0-8.837-7.163-16-16-16H144c-8.837 0-16 7.163-16 16v40c0 8.837 7.163 16 16 16zm0 160h352c8.837 0 16-7.163 16-16v-40c0-8.837-7.163-16-16-16H144c-8.837 0-16 7.163-16 16v40c0 8.837 7.163 16 16 16z"],
    "users": [640, 512, "M96 224c35.3 0 64-28.7 64-64s-28.7-64-64-64-64 28.7-64 64 28.7 64 64 64zm448 0c35.3 0 64-28.7 64-64s-28.7-64-64-64-64 28.7-64 64 28.7 64 64 64zm32 32h-64c-17.6 0-33.5 7.1-45.1 18.6 40.3 22.1 68.9 62 75.1 109.4h66c17.7 0 32-14.3 32-32v-32c0-35.3-28.7-64-64-64zm-256 0c61.9 0 112-50.1 112-112S381.9 32 320 32 208 82.1 208 144s50.1 112 112 112zm76.8 32h-8.3c-20.8 10-43.9 16-68.5 16s-47.6-6-68.5-16h-8.3C179.6 288 128 339.6 128 403.2V432c0 26.5 21.5 48 48 48h288c26.5 0 48-21.5 48-48v-28.8c0-63.6-51.6-115.2-115.2-115.2zm-223.7-13.4C161.5 263.1 145.6 256 128 256H64c-35.3 0-64 28.7-64 64v32c0 17.7 14.3 32 32 32h65.9c6.3-47.4 34.9-87.3 75.2-109.4z"],
    "user-plus": [640, 512, "M624 208h-64v-64c0-8.8-7.2-16-16-16h-32c-8.8 0-16 7.2-16 16v64h-64c-8.8 0-16 7.2-16 16v32c0 8.8 7.2 16 16 16h64v64c0 8.8 7.2 16 16 16h32c8.8 0 16-7.2 16-16v-64h64c8.8 0 16-7.2 16-16v-32c0-8.8-7.2-16-16-16zm-400 48c70.7 0 128-57.3 128-128S294.7 0 224 0 96 57.3 96 128s57.3 128 128 128zm89.6 32h-16.7c-22.2 10.2-46.9 16-72.9 16s-50.6-5.8-72.9-16h-16.7C60.2 288 0 348.2 0 422.4V464c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48v-41.6c0-74.2-60.2-134.4-134.4-134.4z"],
    "cog": [512, 512, "M444.788 291.1l42.616 24.599c4.867 2.809 7.126 8.618 5.459 13.985-11.07 35.642-29.97 67.842-54.689 94.586a12.016 12.016 0 0 1-14.832 2.254l-42.584-24.595a191.577 191.577 0 0 1-60.759 35.13v49.182a12.01 12.01 0 0 1-9.377 11.718c-34.956 7.85-72.499 8.256-109.219.007-5.49-1.233-9.403-6.096-9.403-11.723v-49.184a191.555 191.555 0 0 1-60.759-35.13l-42.584 24.595a12.016 12.016 0 0 1-14.832-2.254c-24.718-26.744-43.619-58.944-54.689-94.586-1.667-5.366.592-11.175 5.459-13.985L67.212 291.1a193.48 193.48 0 0 1 0-70.199l-42.616-24.599c-4.867-2.809-7.126-8.618-5.459-13.985 11.07-35.642 29.97-67.842 54.689-94.586a12.016 12.016 0 0 1 14.832-2.254l42.584 24.595a191.577 191.577 0 0 1 60.759-35.13V25.759a12.01 12.01 0 0 1 9.377-11.718c34.956-7.85 72.499-8.256 109.219-.007 5.49 1.233 9.403 6.096 9.403 11.723v49.184a191.555 191.555 0 0 1 60.759 35.13l42.584-24.595a12.016 12.016 0 0 1 14.832 2.254c24.718 26.744 43.619 58.944 54.689 94.586 1.667 5.366-.592 11.175-5.459 13.985L444.788 220.9a193.485 193.485 0 0 1 0 70.2zM336 256c0-44.112-35.888-80-80-80s-80 35.888-80 80 35.888 80 80 80 80-35.888 80-80z"],
    "lock": [448, 512, "M400 224h-24v-72C376 68.2 307.8 0 224 0S72 68.2 72 152v72H48c-26.5 0-48 21.5-48 48v192c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V272c0-26.5-21.5-48-48-48zm-104 0H152v-72c0-39.7 32.3-72 72-72s72 32.3 72 72v72z"],
    "unlock": [448, 512, "M400 256H152V152.9c0-39.6 31.7-72.5 71.3-72.9 40-.4 72.7 32.1 72.7 72v16c0 13.3 10.7 24 24 24h32c13.3 0 24-10.7 24-24v-16C376 68 307.5-.3 223.5 0 139.5.3 72 69.5 72 153.5V256H48c-26.5 0-48 21.5-48 48v160c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V304c0-26.5-21.5-48-48-48z"],
    "sort-amount-down": [512, 512, "M187.298 395.314l-79.984 80.002c-6.248 6.247-16.383 6.245-22.627 0L4.705 395.314C-5.365 385.244 1.807 368 16.019 368H64V48c0-8.837 7.163-16 16-16h32c8.837 0 16 7.163 16 16v320h47.984c14.241 0 21.363 17.264 11.314 27.314zM240 96h256c8.837 0 16-7.163 16-16V48c0-8.837-7.163-16-16-16H240c-8.837 0-16 7.163-16 16v32c0 8.837 7.163 16 16 16zm-16 112v-32c0-8.837 7.163-16 16-16h192c8.837 0 16 7.163 16 16v32c0 8.837-7.163 16-16 16H240c-8.837 0-16-7.163-16-16zm0 256v-32c0-8.837 7.163-16 16-16h64c8.837 0 16 7.163 16 16v32c0 8.837-7.163 16-16 16h-64c-8.837 0-16-7.163-16-16zm0-128v-32c0-8.837 7.163-16 16-16h128c8.837 0 16 7.163 16 16v32c0 8.837-7.163 16-16 16H240c-8.837 0-16-7.163-16-16z"],
    "file-import": [512, 512, "M16 288c-8.84 0-16 7.16-16 16v32c0 8.84 7.16 16 16 16h112v-64H16zm336-152V0H152c-13.3 0-24 10.7-24 24v264h127.99v-65.18c0-14.28 17.29-21.41 27.36-11.27l95.7 96.43c6.6 6.65 6.6 17.39 0 24.04l-95.7 96.42c-10.06 10.14-27.36 3.01-27.36-11.27V352H128v136c0 13.3 10.7 24 24 24h336c13.3 0 24-10.7 24-24V160H376c-13.2 0-24-10.8-24-24zm153-31L407.1 7c-4.5-4.5-10.6-7-17-7H384v128h128v-6.1c0-6.3-2.5-12.4-7-16.9z"],
    "download": [512, 512, "M216 0h80c13.3 0 24 10.7 24 24v168h87.7c17.8 0 26.7 21.5 14.1 34.1L269.7 378.3c-7.5 7.5-19.8 7.5-27.3 0L90.1 226.1c-12.6-12.6-3.7-34.1 14.1-34.1H192V24c0-13.3 10.7-24 24-24zm296 376v112c0 13.3-10.7 24-24 24H24c-13.3 0-24-10.7-24-24V376c0-13.3 10.7-24 24-24h146.7l49 49c20.1 20.1 52.5 20.1 72.6 0l49-49H488c13.3 0 24 10.7 24 24zm-124 88c0-11-9-20-20-20s-20 9-20 20 9 20 20 20 20-9 20-20zm64 0c0-11-9-20-20-20s-20 9-20 20 9 20 20 20 20-9 20-20z"],
    "globe": [496, 512, "M336.5 160C322 70.7 287.8 8 248 8s-74 62.7-88.5 152h177zM152 256c0 22.2 1.2 43.5 3.3 64h185.3c2.1-20.5 3.3-41.8 3.3-64s-1.2-43.5-3.3-64H155.3c-2.1 20.5-3.3 41.8-3.3 64zm324.7-96c-28.6-67.9-86.5-120.4-158-141.6 24.4 33.8 41.2 84.7 50 141.6h108zM177.2 18.4C105.8 39.6 47.8 92.1 19.3 160h108c8.7-56.9 25.5-107.8 49.9-141.6zM487.4 192H372.7c2.1 21 3.3 42.5 3.3 64s-1.2 43-3.3 64h114.6c5.5-20.5 8.6-41.8 8.6-64s-3.1-43.5-8.5-64zM120 256c0-21.5 1.2-43 3.3-64H8.6C3.2 212.5 0 233.8 0 256s3.2 43.5 8.6 64h114.6c-2-21-3.2-42.5-3.2-64zm39.5 96c14.5 89.3 48.7 152 88.5 152s74-62.7 88.5-152h-177zm159.3 141.6c71.4-21.2 129.4-73.7 158-141.6h-108c-8.8 56.9-25.6 107.8-50 141.6zM19.3 352c28.6 67.9 86.5 120.4 158 141.6-24.4-33.8-41.2-84.7-50-141.6h-108z"],
    "microphone": [352, 512, "M176 352c53.02 0 96-42.98 96-96V96c0-53.02-42.98-96-96-96S80 42.98 80 96v160c0 53.02 42.98 96 96 96zm160-160h-16c-8.84 0-16 7.16-16 16v48c0 74.8-64.49 134.82-140.79 127.38C96.71 376.89 48 317.11 48 250.3V208c0-8.84-7.16-16-16-16H16c-8.84 0-16 7.16-16 16v40.16c0 89.64 63.97 169.55 152 181.69V464H96c-8.84 0-16 7.16-16 16v16c0 8.84 7.16 16 16 16h160c8.84 0 16-7.16 16-16v-16c0-8.84-7.16-16-16-16h-56v-33.77C285.71 418.47 352 344.9 352 256v-48c0-8.84-7.16-16-16-16z"],
    "th-large": [512, 512, "M296 32h192c13.255 0 24 10.745 24 24v160c0 13.255-10.745 24-24 24H296c-13.255 0-24-10.745-24-24V56c0-13.255 10.745-24 24-24zm-80 0H24C10.745 32 0 42.745 0 56v160c0 13.255 10.745 24 24 24h192c13.255 0 24-10.745 24-24V56c0-13.255-10.745-24-24-24zM0 296v160c0 13.255 10.745 24 24 24h192c13.255 0 24-10.745 24-24V296c0-13.255-10.745-24-24-24H24c-13.255 0-24 10.745-24 24zm296 184h192c13.255 0 24-10.745 24-24V296c0-13.255-10.745-24-24-24H296c-13.255 0-24 10.745-24 24v160c0 13.255 10.745 24 24 24z"],
    "volume-up": [576, 512, "M256 88.017v335.964c0 21.438-25.943 31.998-40.971 16.971L126.059 352H24c-13.255 0-24-10.745-24-24V184c0-13.255 10.745-24 24-24h102.059l88.971-88.954c15.01-15.01 40.97-4.49 40.97 16.971zm182.056-77.876C422.982.92 403.283 5.668 394.061 20.745c-9.221 15.077-4.473 34.774 10.604 43.995C468.967 104.063 512 174.983 512 256c0 73.431-36.077 142.292-96.507 184.206-14.522 10.072-18.129 30.01-8.057 44.532 10.076 14.528 30.016 18.126 44.531 8.057C529.633 438.927 576 350.406 576 256c0-103.244-54.579-194.877-137.944-245.859zM480 256c0-68.547-36.15-129.777-91.957-163.901-15.076-9.22-34.774-4.471-43.994 10.607-9.22 15.078-4.471 34.774 10.607 43.994C393.067 170.188 416 211.048 416 256c0 41.964-20.62 81.319-55.158 105.276-14.521 10.073-18.128 30.01-8.056 44.532 6.216 8.96 16.185 13.765 26.322 13.765a31.862 31.862 0 0 0 18.21-5.709C449.091 377.953 480 318.938 480 256zm-96 0c0-33.717-17.186-64.35-45.972-81.944-15.079-9.214-34.775-4.463-43.992 10.616s-4.464 34.775 10.615 43.992C314.263 234.538 320 244.757 320 256a32.056 32.056 0 0 1-13.802 26.332c-14.524 10.069-18.136 30.006-8.067 44.53 10.07 14.525 30.008 18.136 44.53 8.067C368.546 316.983 384 287.478 384 256z"],
    "calendar-alt": [448, 512, "M148 288h-40c-6.6 0-12-5.4-12-12v-40c0-6.6 5.4-12 12-12h40c6.6 0 12 5.4 12 12v40c0 6.6-5.4 12-12 12zm108-12v-40c0-6.6-5.4-12-12-12h-40c-6.6 0-12 5.4-12 12v40c0 6.6 5.4 12 12 12h40c6.6 0 12-5.4 12-12zm96 0v-40c0-6.6-5.4-12-12-12h-40c-6.6 0-12 5.4-12 12v40c0 6.6 5.4 12 12 12h40c6.6 0 12-5.4 12-12zm-96 96v-40c0-6.6-5.4-12-12-12h-40c-6.6 0-12 5.4-12 12v40c0 6.6 5.4 12 12 12h40c6.6 0 12-5.4 12-12zm-96 0v-40c0-6.6-5.4-12-12-12h-40c-6.6 0-12 5.4-12 12v40c0 6.6 5.4 12 12 12h40c6.6 0 12-5.4 12-12zm192 0v-40c0-6.6-5.4-12-12-12h-40c-6.6 0-12 5.4-12 12v40c0 6.6 5.4 12 12 12h40c6.6 0 12-5.4 12-12zm96-260v352c0 26.5-21.5 48-48 48H48c-26.5 0-48-21.5-48-48V112c0-26.5 21.5-48 48-48h48V12c0-6.6 5.4-12 12-12h40c6.6 0 12 5.4 12 12v52h128V12c0-6.6 5.4-12 12-12h40c6.6 0 12 5.4 12 12v52h48c26.5 0 48 21.5 48 48zm-48 346V160H48v298c0 3.3 2.7 6 6 6h340c3.3 0 6-2.7 6-6z"],
    "mouse-pointer": [320, 512, "M302.189 329.126H196.105l55.831 135.993c3.889 9.428-.555 19.999-9.444 23.999l-49.165 21.427c-9.165 4-19.443-.571-23.332-9.714l-53.053-129.136-86.664 89.138C18.729 472.71 0 463.554 0 447.977V18.299C0 1.899 19.921-6.096 30.277 5.443l284.412 292.542c11.472 11.179 3.007 31.141-12.5 31.141z"],
  };
  // icon("refresh") draws a line icon; icon("ag:users") the AsTeRICS symbol "users".
  function icon(name, cls) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    const p = document.createElementNS(ns, "path");
    if (name && name.startsWith("ag:") && FA[name.slice(3)]) {
      const [w, hgt, d] = FA[name.slice(3)];
      svg.setAttribute("class", "i fa" + (cls ? " " + cls : ""));
      svg.setAttribute("viewBox", `0 0 ${w} ${hgt}`);
      p.setAttribute("d", d);
    } else {
      svg.setAttribute("class", "i" + (cls ? " " + cls : ""));
      svg.setAttribute("viewBox", "0 0 24 24");
      p.setAttribute("d", ICONS[name] || "");
    }
    svg.setAttribute("aria-hidden", "true");
    svg.appendChild(p);
    return svg;
  }
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "style") el.setAttribute("style", v);
      else if (k in el && typeof v !== "string") el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === "string" || typeof kid === "number" ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  }
  // replaceChildren() would print "null" for skipped optional parts
  function fill(el, ...kids) {
    el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  }
  // Toggle tile, same look as the ones in index.html
  function toggle(label, iconName, checked, onChange, wide) {
    const input = h("input", { type: "checkbox", checked: !!checked, "aria-label": label });
    input.addEventListener("change", () => onChange(input.checked));
    return h("label", { class: "tg" + (wide ? " wide" : "") }, input,
      h("span", { class: "tg-in" }, h("span", { class: "tg-ic" }, icon(iconName)),
        h("span", { class: "tg-t" }, h("b", {}, label), h("small", { class: "tg-on" }, "An"), h("small", { class: "tg-off" }, "Aus"))));
  }
  let hudTimer = null;
  function hud(text, kind) {
    const el = $("hud");
    fill(el, icon(kind === "bad" ? "x" : "check"), text);
    el.classList.add("show");
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => el.classList.remove("show"), 1800);
  }
  function ago(ts) {
    if (!ts) return "nie";
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 10) return "gerade eben";
    if (s < 60) return `vor ${s} s`;
    if (s < 3600) return `vor ${Math.round(s / 60)} min`;
    if (s < 86400) return `vor ${Math.round(s / 3600)} h`;
    return new Date(ts).toLocaleDateString("de-AT");
  }
  function lsGet(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } }
  function lsSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }
  async function api(path, opts) {
    const o = Object.assign({ cache: "no-store" }, opts || {});
    if (o.json !== undefined) {
      o.method = o.method || "POST";
      o.headers = Object.assign({ "Content-Type": "application/json", "X-Kit": "1" }, o.headers || {});
      o.body = JSON.stringify(o.json);
      delete o.json;
    }
    const r = await fetch(path, o);
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { data = { error: text }; }
    if (!r.ok) throw new Error((data && data.error) || `Fehler ${r.status}`);
    return data;
  }

  // ---------------------------------------------------------------- navigation
  const views = ["tablets", "setup", "grids"];
  const listeners = {};
  function show(view) {
    if (!views.includes(view)) view = "tablets";
    for (const v of views) $("v-" + v).hidden = v !== view;
    document.querySelectorAll(".bar .seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === view)));
    if (location.hash.slice(1) !== view) history.replaceState(null, "", view === "tablets" ? location.pathname : "#" + view);
    current = view;
    (listeners[view] || []).forEach((fn) => fn());
  }
  let current = "tablets";
  document.querySelectorAll(".bar .seg button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));

  // ---------------------------------------------------------------- setup state
  const persistIds = ["ssid", "sec-wpa", "sec-wep", "sec-none", "mq-name", "fk-url",
    "fk-filter", "fk-zoom", "fk-screen", "fk-statusbar", "fk-power", "fk-lockbt", "fk-corner", "fk-reset",
    "fk-mqtt", "mq-broker", "mq-port", "mq-topic", "mq-user",
    "src-laptop", "src-net", "ip", "net-url", "locale", "tz", "hidden-net", "keep-apps", "skip-edu", "cs-sig", "cs-pkg", "fk-extra"];
  const state = { info: null, sig: null, pkg: null, scheme: 0, apkName: "", apkSize: 0, loading: true };
  const changeHooks = [];

  function randomChannel() {
    const a = new Uint8Array(4);
    crypto.getRandomValues(a);
    return "indiko-" + Array.from(a, (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 6) + "/kiosk";
  }

  function load() {
    let saved = lsGet(STORE);
    if (!saved) {
      // Carry over the previous kit's values (different ids for a few fields).
      const old = lsGet(OLD_STORE);
      if (old) {
        saved = {};
        for (const k of ["ssid", "mq-name", "fk-url", "fk-screen", "fk-statusbar", "fk-corner", "fk-lockbt", "fk-reset", "fk-mqtt",
          "mq-broker", "mq-port", "mq-user", "mq-topic", "src-laptop", "src-net", "ip", "net-url", "locale", "tz", "hidden-net",
          "keep-apps", "skip-edu", "cs-sig", "cs-pkg", "fk-extra"]) if (k in old) saved[k] = old[k];
        if (old.sec) { saved["sec-wpa"] = old.sec === "WPA"; saved["sec-wep"] = old.sec === "WEP"; saved["sec-none"] = old.sec === "NONE"; }
        if (saved["mq-topic"] === "freekiosk") delete saved["mq-topic"];
      } else saved = {};
    }
    for (const id of persistIds) {
      if (!(id in saved)) continue;
      const el = $(id);
      if (!el) continue;
      if (el.type === "checkbox" || el.type === "radio") el.checked = !!saved[id]; else el.value = saved[id];
    }
    if (!$("mq-topic").value.trim()) $("mq-topic").value = randomChannel();
    return saved;
  }
  function save() {
    const out = {};
    for (const id of persistIds) {
      const el = $(id);
      out[id] = (el.type === "checkbox" || el.type === "radio") ? el.checked : el.value;
    }
    lsSet(STORE, out);
  }

  const radio = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
  function apkUrl() {
    if (radio("src") === "laptop") {
      if (!state.info || !$("ip").value) return "";
      return `http://${$("ip").value}:${state.info.port}/freekiosk.apk`;
    }
    return $("net-url").value.trim();
  }

  // Shared secret for commands that change apps on the tablets (installing voices).
  // Created once per kit, written into every QR; FreeKiosk accepts such commands
  // only when they are signed with it.
  function adminKey() {
    let k = lsGet("fkkit.admin");
    if (!k || !/^[0-9a-f]{32,}$/.test(k)) {
      const a = new Uint8Array(16);
      crypto.getRandomValues(a);
      k = Array.from(a, (x) => x.toString(16).padStart(2, "0")).join("");
      lsSet("fkkit.admin", k);
    }
    return k;
  }
  function setAdminKey(k) { if (/^[0-9a-f]{32,}$/.test(k)) { lsSet("fkkit.admin", k); render(); return true; } return false; }

  function mqttSettings() {
    return {
      enabled: $("fk-mqtt").checked,
      broker: $("mq-broker").value.trim(),
      base: $("mq-topic").value.trim().replace(/\/+$/, ""),
      user: $("mq-user").value.trim(),
      pass: $("mq-pass").value,
    };
  }

  function opts() {
    return {
      url: apkUrl(), localSource: radio("src") === "laptop", checksumType: radio("cs"),
      sigChecksum: state.sig, pkgChecksum: state.pkg,
      ssid: $("ssid").value, password: $("pw").value, security: radio("sec"), hidden: $("hidden-net").checked,
      keepApps: $("keep-apps").checked, skipEdu: $("skip-edu").checked, locale: $("locale").value, tz: $("tz").value,
      fk: {
        pin: $("fk-pin").value, url: $("fk-url").value, keepScreenOn: $("fk-screen").checked,
        statusBar: $("fk-statusbar").checked, blockReset: $("fk-reset").checked, urlFilter: $("fk-filter").checked,
        noZoom: $("fk-zoom").checked, lockPower: $("fk-power").checked,
        cornerReturn: $("fk-corner").checked, lockBluetooth: $("fk-lockbt").checked,
        mqtt: $("fk-mqtt").checked, broker: $("mq-broker").value, port: $("mq-port").value,
        user: $("mq-user").value, pass: $("mq-pass").value, topic: $("mq-topic").value, name: $("mq-name").value,
        extra: $("fk-extra").value, adminKey: adminKey(),
      },
    };
  }

  // Every module gets the same whole number of device pixels. A QR scaled by a
  // fractional factor has uneven modules, which scanners struggle with once it is dense.
  function drawQR(canvas, text, cssMax) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
    const qr = qrcode(0, "L");
    qr.addData(text, "Byte");
    qr.make();
    const count = qr.getModuleCount();
    const quiet = 4;
    const dpr = window.devicePixelRatio || 1;
    const modules = count + quiet * 2;
    const cell = Math.max(1, Math.floor((cssMax * dpr) / modules));
    const size = modules * cell;
    canvas.width = size; canvas.height = size;
    canvas.style.width = canvas.style.height = size / dpr + "px";
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000";
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
    }
    return count;
  }
  const cardSize = () => Math.min(300, $("frame").clientWidth || 300);
  const fullSize = () => Math.max(200, Math.min(window.innerWidth - 48, window.innerHeight - 130));

  let lastText = "";
  function render() {
    const laptop = radio("src") === "laptop";
    $("row-ip").hidden = !laptop;
    $("row-net").hidden = laptop;
    $("mqtt-group").hidden = !$("fk-mqtt").checked;

    const res = buildProvisioning(opts());
    if (laptop && !state.info) res.problems.unshift("Start.bat läuft nicht. Oder Quelle „Internet“.");
    if (laptop && state.info && state.loading) res.problems.unshift("App wird gelesen …");
    lastText = JSON.stringify(res.json);
    $("json").textContent = JSON.stringify(res.json, null, 2);

    const msgs = $("msgs");
    msgs.textContent = "";
    const add = (cls, t) => msgs.appendChild(h("li", {}, h("span", { class: "dot " + cls }), h("span", {}, t)));
    res.problems.forEach((t) => add("bad", t));
    res.warnings.forEach((t) => add("warn", t));

    let modules = 0;
    try { modules = drawQR($("qr"), lastText, cardSize()); } catch (e) { add("bad", "QR zu groß: " + e.message); }
    const ready = !res.demo && res.problems.length === 0 && modules > 0;
    const pill = $("pill");
    pill.className = "pill " + (ready ? "ok" : "bad");
    fill(pill, h("span", { class: "dot " + (ready ? "ok" : "bad") }), ready ? "Bereit zum Scannen" : res.problems.length + (res.problems.length === 1 ? " Punkt offen" : " Punkte offen"));
    $("frame").classList.toggle("wait", !ready);
    $("qr-wait").hidden = ready;
    $("qr-wait-text").textContent = res.problems[0] || "Noch nicht scannen";

    const name = $("mq-name").value.trim();
    $("qr-name").textContent = name;

    const pi = $("print-info");
    fill(pi,
      name ? h("p", {}, h("b", {}, name)) : null,
      h("p", {}, `WLAN: ${$("ssid").value.trim() || "–"}`),
      h("p", {}, "Zurücksetzen · am Willkommen-Bildschirm 6× tippen · scannen · Weiter")
    );
    if (!$("full").hidden) renderFull();
    save();
    changeHooks.forEach((fn) => fn());
  }

  function renderFull() {
    drawQR($("qr-full"), lastText, fullSize());
    $("full-name").textContent = $("mq-name").value.trim();
  }

  function showApk(name, size, r) {
    state.sig = r.signatureChecksum; state.pkg = r.packageChecksum; state.scheme = r.scheme;
    state.apkName = name; state.apkSize = size;
    const ver = state.info && state.info.version && name === state.info.apkName ? state.info.version + " · " : "";
    $("apk-line").textContent = `${ver}${(size / 1048576).toFixed(1)} MB${r.scheme ? "" : " · v1"}`;
    $("apk-line").title = name + "\n" + (r.signatureChecksum || r.packageChecksum);
    if (!r.signatureChecksum) $("cs-pkg").checked = true;
  }

  async function handleFile(file) {
    if (!file) return;
    $("drop-title").textContent = file.name + " …";
    try {
      showApk(file.name, file.size, await apkChecksums(await file.arrayBuffer()));
      $("drop-title").textContent = file.name;
      state.loading = false;
      if (state.info) $("src-net").checked = true;
    } catch (e) {
      $("drop-title").textContent = e.message;
    }
    render();
  }

  function nextTablet() {
    const el = $("mq-name");
    const m = el.value.match(/^(.*?)(\d+)\s*$/);
    el.value = m ? m[1] + String(parseInt(m[2], 10) + 1).padStart(m[2].length, "0") : (el.value.trim() || "tablet") + "-02";
    render();
    hud(el.value);
  }

  function serverBadge() {
    const box = $("server-state");
    if (state.info) fill(box, h("span", { class: "dot ok" }), "Start.bat läuft");
    else fill(box, h("span", { class: "dot" }), "Ohne Start.bat");
  }

  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });

  async function boot() {
    const saved = load();
    try { state.info = await api("/api/info"); } catch (e) { state.info = null; }
    serverBadge();
    readyResolve(state.info);

    const ipSel = $("ip");
    ipSel.textContent = "";
    if (state.info) {
      const ips = Array.isArray(state.info.ips) ? state.info.ips : (state.info.ips ? [state.info.ips] : []);
      for (const a of ips) ipSel.appendChild(h("option", { value: a.address }, a.name ? `${a.address} · ${a.name}` : a.address));
      if (saved.ip && ips.some((a) => a.address === saved.ip)) ipSel.value = saved.ip;
      if (!ips.length) ipSel.appendChild(h("option", { value: "" }, "Kein Netzwerk"));
      if (state.info.releaseUrl && !$("net-url").value) $("net-url").value = state.info.releaseUrl;
      render();
      try {
        const buf = await (await fetch("/freekiosk.apk", { cache: "no-store" })).arrayBuffer();
        showApk(state.info.apkName, buf.byteLength, await apkChecksums(buf));
      } catch (e) {
        $("apk-line").textContent = "konnte nicht gelesen werden";
      }
    } else {
      ipSel.appendChild(h("option", { value: "" }, "nur mit Start.bat"));
      $("src-net").checked = true;
      $("apk-line").textContent = "unter Mehr auswählen";
    }
    state.loading = false;
    render();
  }

  $("apk").addEventListener("change", (e) => handleFile(e.target.files[0]));
  const drop = $("drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("is-over"); }));
  drop.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));
  $("form").addEventListener("input", render);
  $("form").addEventListener("change", render);
  $("form").addEventListener("submit", (e) => e.preventDefault());
  $("fk-pin").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); });
  $("btn-next").addEventListener("click", nextTablet);
  $("btn-print").addEventListener("click", () => window.print());
  // Print from a large drawing; the print stylesheet sets the physical size.
  window.addEventListener("beforeprint", () => { if (lastText) drawQR($("qr"), lastText, 1400); });
  window.addEventListener("afterprint", () => { if (lastText) drawQR($("qr"), lastText, cardSize()); });
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!lastText) return;
      drawQR($("qr"), lastText, cardSize());
      if (!$("full").hidden) renderFull();
    }, 150);
  });
  $("btn-large").addEventListener("click", () => { $("full").hidden = false; renderFull(); $("full-close").focus(); });
  $("full-close").addEventListener("click", () => { $("full").hidden = true; });
  $("full").addEventListener("click", (e) => { if (e.target === $("full") || e.target === $("qr-full")) $("full").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("full").hidden = true; });
  $("btn-copy").addEventListener("click", () => {
    const done = () => hud("Kopiert");
    const fallback = () => {
      const range = document.createRange(); range.selectNodeContents($("json"));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    };
    try { navigator.clipboard.writeText($("json").textContent).then(done, fallback); } catch (e) { fallback(); }
  });

  window.Kit = {
    $, h, fill, icon, toggle, hud, ago, api, lsGet, lsSet, mqttSettings, adminKey, setAdminKey, show,
    onShow(view, fn) { (listeners[view] = listeners[view] || []).push(fn); },
    onChange(fn) { changeHooks.push(fn); },
    ready,
    get info() { return state.info; },
    get view() { return current; },
  };

  document.addEventListener("DOMContentLoaded", () => {
    boot();
    show(location.hash.slice(1) || "tablets");
  });
})();
