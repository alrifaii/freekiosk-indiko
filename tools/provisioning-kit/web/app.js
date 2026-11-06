// inDiKo Kit: navigation, shared helpers and the "Einrichten" (QR) view.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const STORE = "fkkit.v3";
  const OLD_STORE = "fkkit.v2";

  // ---------------------------------------------------------------- helpers
  // Material Symbols (Google, Apache License 2.0), the icon set of the FH Technikum Wien
  // website and the inDiKo project page: outlined, weight 400.
  const ICONS = {
    refresh: "M480-160q-133 0-226.5-93.5T160-480q0-133 93.5-226.5T480-800q85 0 149 34.5T740-671v-129h60v254H546v-60h168q-38-60-97-97t-137-37q-109 0-184.5 75.5T220-480q0 109 75.5 184.5T480-220q83 0 152-47.5T728-393h62q-29 105-115 169t-195 64Z",
    power: "M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-84 32-156.5T198-763l42 42q-47 46-73.5 108T140-480q0 141 99.5 240.5T480-140q142 0 241-99.5T820-480q0-71-26-133t-73-108l42-42q54 54 85.5 126.5T880-480q0 82-31.5 155T763-197.5q-54 54.5-127 86T480-80Zm-30-360v-440h60v440h-60Z",
    sun: "M579-381q41-41 41-99t-41-99q-41-41-99-41t-99 41q-41 41-41 99t41 99q41 41 99 41t99-41Zm-240.5 42.5Q280-397 280-480t58.5-141.5Q397-680 480-680t141.5 58.5Q680-563 680-480t-58.5 141.5Q563-280 480-280t-141.5-58.5ZM200-450H40v-60h160v60Zm720 0H760v-60h160v60ZM450-760v-160h60v160h-60Zm0 720v-160h60v160h-60ZM262-658l-100-97 43-44 96 100-39 41Zm494 496-98-100 41-41 99 98-42 43Zm-99-537 98-99 44 42-99 98-43-41ZM162-205l99-98 42 42-98 99-43-43Zm318-275Z",
    volume: "M560-131v-62q97-28 158.5-107.5T780-481q0-101-61-181T560-769v-62q124 28 202 125.5T840-481q0 127-78 224.5T560-131ZM120-360v-240h160l200-200v640L280-360H120Zm420 48v-337q55 17 87.5 64T660-480q0 57-33 104t-87 64ZM420-648 307-540H180v120h127l113 109v-337Zm-94 168Z",
    bluetooth: "M450-94v-314L256-214l-42-42 224-224-224-224 42-42 194 194v-314h30l214 214-172 172 172 172L480-94h-30Zm60-458 100-100-100-98v198Zm0 342 100-98-100-100v198Z",
    wifi: "M417-154q-27-27-27-63t27-63q27-27 63-27t63 27q27 27 27 63t-27 63q-27 27-63 27t-63-27ZM232-357l-63-63q70-70 146.5-105T480-560q88 0 164.5 35T791-420l-63 63q-61-61-123-87t-125-26q-63 0-125 26t-123 87ZM63-526 0-589q93-95 216.5-153T480-800q140 0 263.5 58T960-589l-63 63q-88-84-192.5-134T480-710q-120 0-224.5 50T63-526Z",
    bell: "M160-200v-60h80v-304q0-84 49.5-150.5T420-798v-22q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v22q81 17 130.5 83.5T720-564v304h80v60H160Zm320-302Zm0 422q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80ZM300-260h360v-304q0-75-52.5-127.5T480-744q-75 0-127.5 52.5T300-564v304Z",
    message: "M80-80v-740q0-24 18-42t42-18h680q24 0 42 18t18 42v520q0 24-18 42t-42 18H240L80-80Zm134-220h606v-520H140v600l74-80Zm-74 0v-520 520Z",
    eye: "M600.5-379.5Q650-429 650-500t-49.5-120.5Q551-670 480-670t-120.5 49.5Q310-571 310-500t49.5 120.5Q409-330 480-330t120.5-49.5Zm-200-41Q368-453 368-500t32.5-79.5Q433-612 480-612t79.5 32.5Q592-547 592-500t-32.5 79.5Q527-388 480-388t-79.5-32.5ZM216-283Q98-366 40-500q58-134 176-217t264-83q146 0 264 83t176 217q-58 134-176 217t-264 83q-146 0-264-83Zm264-217Zm222.5 174.5Q804-391 857-500q-53-109-154.5-174.5T480-740q-121 0-222.5 65.5T102-500q54 109 155.5 174.5T480-260q121 0 222.5-65.5Z",
    eyeOff: "m629-419-44-44q26-71-27-118t-115-24l-44-44q17-11 38-16t43-5q71 0 120.5 49.5T650-500q0 22-5.5 43.5T629-419Zm129 129-40-40q49-36 85.5-80.5T857-500q-50-111-150-175.5T490-740q-42 0-86 8t-69 19l-46-47q35-16 89.5-28T485-800q143 0 261.5 81.5T920-500q-26 64-67 117t-95 93Zm58 226L648-229q-35 14-79 21.5t-89 7.5q-146 0-265-81.5T40-500q20-52 55.5-101.5T182-696L56-822l42-43 757 757-39 44ZM223-654q-37 27-71.5 71T102-500q51 111 153.5 175.5T488-260q33 0 65-4t48-12l-64-64q-11 5-27 7.5t-30 2.5q-70 0-120-49t-50-121q0-15 2.5-30t7.5-27l-97-97Zm305 142Zm-116 58Z",
    moon: "M484-80q-84 0-157.5-32t-128-86.5Q144-253 112-326.5T80-484q0-146 93-257.5T410-880q-18 98 11 192.63 29 94.64 100 165.74 71 71.1 165.5 100.14Q781-392.45 880-410.47q-26 144.2-138 237.34Q630-80 484-80Zm0-60q100 0 182-57t132-145q-90-8-173-41.5T478.5-480Q415-543 382-625.5T341-797q-88 48-144.5 130.5T140-484q0 143.33 100.33 243.67Q340.67-140 484-140Zm-6-340Z",
    check: "M378-246 154-470l43-43 181 181 384-384 43 43-427 427Z",
    x: "m249-207-42-42 231-231-231-231 42-42 231 231 231-231 42 42-231 231 231 231-42 42-231-231-231 231Z",
    search: "M796-121 533-384q-30 26-70 40.5T378-329q-108 0-183-75t-75-181q0-106 75-181t182-75q106 0 180.5 75T632-585q0 43-14 83t-42 75l264 262-44 44ZM377-389q81 0 138-57.5T572-585q0-81-57-138.5T377-781q-82 0-139.5 57.5T180-585q0 81 57.5 138.5T377-389Z",
    trash: "M261-120q-24.75 0-42.37-17.63Q201-155.25 201-180v-570h-41v-60h188v-30h264v30h188v60h-41v570q0 24-18 42t-42 18H261Zm438-630H261v570h438v-570ZM367-266h60v-399h-60v399Zm166 0h60v-399h-60v399ZM261-750v570-570Z",
    plus: "M450-450H200v-60h250v-250h60v250h250v60H510v250h-60v-250Z",
    keyboard: "M140-200q-24 0-42-18.5T80-260v-440q0-24 18-42t42-18h680q24 0 42 18t18 42v440q0 23-18 41.5T820-200H140Zm0-60h680v-440H140v440Zm160-65h360v-60H300v60Zm-97-125h60v-60h-60v60Zm124 0h60v-60h-60v60Zm123 0h60v-60h-60v60Zm124 0h60v-60h-60v60Zm123 0h60v-60h-60v60ZM203-575h60v-60h-60v60Zm124 0h60v-60h-60v60Zm123 0h60v-60h-60v60Zm124 0h60v-60h-60v60Zm123 0h60v-60h-60v60ZM140-260v-440 440Z",
    key: "M232-432q-20-20-20-48t20-48q20-20 48-20t48 20q20 20 20 48t-20 48q-20 20-48 20t-48-20Zm48 192q-100 0-170-70T40-480q0-100 70-170t170-70q72 0 126 34t85 103h356l113 113-167 153-88-64-88 64-75-60h-51q-25 60-78.5 98.5T280-240Zm0-60q58 0 107-38.5t63-98.5h114l54 45 88-63 82 62 85-79-51-51H450q-12-56-60-96.5T280-660q-75 0-127.5 52.5T100-480q0 75 52.5 127.5T280-300Z",
    grid: "M120-510v-330h330v330H120Zm0 390v-330h330v330H120Zm390-390v-330h330v330H510Zm0 390v-330h330v330H510ZM180-570h210v-210H180v210Zm390 0h210v-210H570v210Zm0 390h210v-210H570v210Zm-390 0h210v-210H180v210Zm390-390Zm0 180Zm-180 0Zm0-180Z",
    download: "M480-313 287-506l43-43 120 120v-371h60v371l120-120 43 43-193 193ZM220-160q-24 0-42-18t-18-42v-143h60v143h520v-143h60v143q0 24-18 42t-42 18H220Z",
    shield: "M480-81q-140-35-230-162.5T160-523v-238l320-120 320 120v238q0 152-90 279.5T480-81Zm0-62q115-38 187.5-143.5T740-523v-196l-260-98-260 98v196q0 131 72.5 236.5T480-143Zm0-337Z",
    shieldLock: "M480-81q-140-35-230-162.5T160-523v-238l320-120 320 120v238q0 152-90 279.5T480-81Zm0-62q115-38 187.5-143.5T740-523v-196l-260-98-260 98v196q0 131 72.5 236.5T480-143Zm0-337Zm-90 160h180q13 0 21.5-8.5T600-350v-140q0-13-8.5-21.5T570-520h-10v-40q0-33-23.5-56.5T480-640q-33 0-56.5 23.5T400-560v40h-10q-13 0-21.5 8.5T360-490v140q0 13 8.5 21.5T390-320Zm40-200v-40q0-20 15-33.5t35-13.5q20 0 35 13.5t15 33.5v40H430Z",
    tablet: "M180-40q-24.75 0-42.37-17.63Q120-75.25 120-100v-760q0-24.75 17.63-42.38Q155.25-920 180-920h600q24.75 0 42.38 17.62Q840-884.75 840-860v760q0 24.75-17.62 42.37Q804.75-40 780-40H180Zm0-150v90h600v-90H180Zm218 65h164v-40H398v40ZM180-250h600v-520H180v520Zm0-580h600v-30H180v30Zm0 0v-30 30Zm0 640v90-90Z",
    plug: "M442-180h76v-82l142-156v-191H300v191l142 155.7v82.3Zm-60 60v-118L240-394v-215q0-24.75 17.63-42.38Q275.25-669 300-669h72l-30 30v-201h60v171h156v-171h60v201l-30-30h72q24.75 0 42.38 17.62Q720-633.75 720-609v215L578-238v118H382Zm98-275Z",
    home: "M220-180h150v-250h220v250h150v-390L480-765 220-570v390Zm-60 60v-480l320-240 320 240v480H530v-250H430v250H160Zm320-353Z",
    speak: "m801-305-50-50q48-51 73.5-104.5T850-591q0-78-25.5-131.5T751-827l50-50q56 58 87.5 126.5T920-591q0 91-31.5 159.5T801-305ZM662-447l-50-50q18-20 28-42.5t10-51.5q0-29-10-51.5T612-685l50-50q26 28 42 65.5t16 78.5q0 41-16 78.5T662-447Zm-302 6q-66 0-108-42t-42-108q0-66 42-108t108-42q66 0 108 42t42 108q0 66-42 108t-108 42ZM40-120v-94q0-38 19-64.5t49-41.5q51-26 120.5-43T360-380q62 0 131 17t120 43q30 15 49.5 41.5T680-214v94H40Zm60-60h520v-34q0-16-8.5-29.5T587-266q-48-27-109-40.5T360-320q-57 0-118.5 14.5T132-266q-14 7-23 21.5t-9 30.5v34Zm324.5-346.5Q450-552 450-591t-25.5-64.5Q399-681 360-681t-64.5 25.5Q270-630 270-591t25.5 64.5Q321-501 360-501t64.5-25.5ZM360-591Zm0 411Z",
    chev: "M530-481 332-679l43-43 241 241-241 241-43-43 198-198Z",
    back: "M561-240 320-481l241-241 43 43-198 198 198 198-43 43Z",
    user: "M372-523q-42-42-42-108t42-108q42-42 108-42t108 42q42 42 42 108t-42 108q-42 42-108 42t-108-42ZM160-160v-94q0-38 19-65t49-41q67-30 128.5-45T480-420q62 0 123 15.5T731-360q31 14 50 41t19 65v94H160Zm60-60h520v-34q0-16-9.5-30.5T707-306q-64-31-117-42.5T480-360q-57 0-111 11.5T252-306q-14 7-23 21.5t-9 30.5v34Zm324.5-346.5Q570-592 570-631t-25.5-64.5Q519-721 480-721t-64.5 25.5Q390-670 390-631t25.5 64.5Q441-541 480-541t64.5-25.5ZM480-631Zm0 411Z",
    users: "M38-160v-94q0-35 18-63.5t50-42.5q73-32 131.5-46T358-420q62 0 120 14t131 46q32 14 50.5 42.5T678-254v94H38Zm700 0v-94q0-63-32-103.5T622-423q69 8 130 23.5t99 35.5q33 19 52 47t19 63v94H738ZM250-523q-42-42-42-108t42-108q42-42 108-42t108 42q42 42 42 108t-42 108q-42 42-108 42t-108-42Zm426 0q-42 42-108 42-11 0-24.5-1.5T519-488q24-25 36.5-61.5T568-631q0-45-12.5-79.5T519-774q11-3 24.5-5t24.5-2q66 0 108 42t42 108q0 66-42 108ZM98-220h520v-34q0-16-9.5-31T585-306q-72-32-121-43t-106-11q-57 0-106.5 11T130-306q-14 6-23 21t-9 31v34Zm324.5-346.5Q448-592 448-631t-25.5-64.5Q397-721 358-721t-64.5 25.5Q268-670 268-631t25.5 64.5Q319-541 358-541t64.5-25.5ZM358-220Zm0-411Z",
    userAdd: "M730-400v-130H600v-60h130v-130h60v130h130v60H790v130h-60ZM252-523q-42-42-42-108t42-108q42-42 108-42t108 42q42 42 42 108t-42 108q-42 42-108 42t-108-42ZM40-160v-94q0-35 17.5-63.5T108-360q75-33 133.5-46.5T360-420q60 0 118 13.5T611-360q33 15 51 43t18 63v94H40Zm60-60h520v-34q0-16-9-30.5T587-306q-71-33-120-43.5T360-360q-58 0-107.5 10.5T132-306q-15 7-23.5 21.5T100-254v34Zm324.5-346.5Q450-592 450-631t-25.5-64.5Q399-721 360-721t-64.5 25.5Q270-670 270-631t25.5 64.5Q321-541 360-541t64.5-25.5ZM360-631Zm0 411Z",
    lock: "M220-80q-24.75 0-42.37-17.63Q160-115.25 160-140v-434q0-24.75 17.63-42.38Q195.25-634 220-634h70v-96q0-78.85 55.61-134.42Q401.21-920 480.11-920q78.89 0 134.39 55.58Q670-808.85 670-730v96h70q24.75 0 42.38 17.62Q800-598.75 800-574v434q0 24.75-17.62 42.37Q764.75-80 740-80H220Zm0-60h520v-434H220v434Zm314.5-162.03Q557-324.06 557-355q0-30-22.67-54.5t-54.5-24.5q-31.83 0-54.33 24.5t-22.5 55q0 30.5 22.67 52.5t54.5 22q31.83 0 54.33-22.03ZM350-634h260v-96q0-54.17-37.88-92.08-37.88-37.92-92-37.92T388-822.08q-38 37.91-38 92.08v96ZM220-140v-434 434Z",
    unlock: "M220-634h390v-96q0-54.17-37.88-92.08-37.88-37.92-92-37.92T388-822.08q-38 37.91-38 92.08h-60q0-79 55.61-134.5 55.6-55.5 134.5-55.5 78.89 0 134.39 55.58Q670-808.85 670-730v96h70q24.75 0 42.38 17.62Q800-598.75 800-574v434q0 24.75-17.62 42.37Q764.75-80 740-80H220q-24.75 0-42.37-17.63Q160-115.25 160-140v-434q0-24.75 17.63-42.38Q195.25-634 220-634Zm0 494h520v-434H220v434Zm314.5-162.03Q557-324.06 557-355q0-30-22.67-54.5t-54.5-24.5q-31.83 0-54.33 24.5t-22.5 55q0 30.5 22.67 52.5t54.5 22q31.83 0 54.33-22.03ZM220-140v-434 434Z",
    scan: "M80-707v-173h173v60H140v113H80Zm0 627v-173h60v113h113v60H80Zm627 0v-60h113v-113h60v173H707Zm113-627v-113H707v-60h173v173h-60ZM708-251h63v63h-63v-63Zm0-126h63v63h-63v-63Zm-63 63h63v63h-63v-63Zm-63 63h63v63h-63v-63Zm-63-63h63v63h-63v-63Zm126-126h63v63h-63v-63Zm-63 63h63v63h-63v-63Zm-63-63h63v63h-63v-63Zm252-332v252H519v-252h252ZM440-440v252H188v-252h252Zm0-332v252H188v-252h252Zm-50 534v-152H238v152h152Zm0-332v-152H238v152h152Zm331 0v-152H569v152h152Z",
    sliders: "M427-120v-225h60v83h353v60H487v82h-60Zm-307-82v-60h247v60H120Zm187-166v-82H120v-60h187v-84h60v226h-60Zm120-82v-60h413v60H427Zm166-165v-225h60v82h187v60H653v83h-60Zm-473-83v-60h413v60H120Z",
    globe: "M323-111.5Q250-143 196-197t-85-127.5Q80-398 80-482t31-156.5Q142-711 196-765t127-84.5Q396-880 480-880t157 30.5Q710-819 764-765t85 126.5Q880-566 880-482t-31 157.5Q818-251 764-197t-127 85.5Q564-80 480-80t-157-31.5ZM480-138q35-36 58.5-82.5T577-331H384q14 60 37.5 108t58.5 85Zm-85-12q-25-38-43-82t-30-99H172q38 71 88 111.5T395-150Zm171-1q72-23 129.5-69T788-331H639q-13 54-30.5 98T566-151ZM152-391h159q-3-27-3.5-48.5T307-482q0-25 1-44.5t4-43.5H152q-7 24-9.5 43t-2.5 45q0 26 2.5 46.5T152-391Zm221 0h215q4-31 5-50.5t1-40.5q0-20-1-38.5t-5-49.5H373q-4 31-5 49.5t-1 38.5q0 21 1 40.5t5 50.5Zm275 0h160q7-24 9.5-44.5T820-482q0-26-2.5-45t-9.5-43H649q3 35 4 53.5t1 34.5q0 22-1.5 41.5T648-391Zm-10-239h150q-33-69-90.5-115T565-810q25 37 42.5 80T638-630Zm-254 0h194q-11-53-37-102.5T480-820q-32 27-54 71t-42 119Zm-212 0h151q11-54 28-96.5t43-82.5q-75 19-131 64t-91 115Z",
    cloudOff: "M818-56 703-171H248q-88 0-148-59T40-377q0-80 50.5-134T217-577q2-14 6.5-31.5T236-640L70-806l42-42L861-99l-43 43ZM248-231h397L285-591q-11 15-14.5 34t-3.5 37h-19q-62 0-105 39.5t-43 101q0 61.5 43 105T248-231Zm216-181Zm390 210-47-47q25-17 39-38t14-50q0-43-31-73.5T755-441h-67v-81q0-88-61-147.5T478.47-729q-28.47 0-60.97 9T358-691l-42-42q36-29 77.5-42.5T478-789q111 0 190.5 79T748-520v21q72-1 122 45t50 117q0 35-16.5 73.5T854-202ZM583-470Z",
    camera: "M479.5-267q72.5 0 121.5-49t49-121.5q0-72.5-49-121T479.5-607q-72.5 0-121 48.5t-48.5 121q0 72.5 48.5 121.5t121 49Zm0-60q-47.5 0-78.5-31.5t-31-79q0-47.5 31-78.5t78.5-31q47.5 0 79 31t31.5 78.5q0 47.5-31.5 79t-79 31.5ZM140-120q-24 0-42-18t-18-42v-513q0-23 18-41.5t42-18.5h147l73-87h240l73 87h147q23 0 41.5 18.5T880-693v513q0 24-18.5 42T820-120H140Zm0-60h680v-513H645l-73-87H388l-73 87H140v513Zm340-257Z",
    play: "m392-313 260-169-260-169v338ZM140-160q-24 0-42-18t-18-42v-520q0-24 18-42t42-18h680q24 0 42 18t18 42v520q0 24-18 42t-42 18H140Zm0-60h680v-520H140v520Zm0 0v-520 520Z",
    board: "M860-131v-649H100v320H40v-320q0-25 17.63-42.5Q75.25-840 100-840h760q24.75 0 42.38 17.62Q920-804.75 920-780v580q0 26-17 45.5T860-131ZM252-443q-42-42-42-108t42-108q42-42 108-42t108 42q42 42 42 108t-42 108q-42 42-108 42t-108-42Zm172.5-43.5Q450-512 450-551t-25.5-64.5Q399-641 360-641t-64.5 25.5Q270-590 270-551t25.5 64.5Q321-461 360-461t64.5-25.5ZM40-80v-94q0-38 19-65t49-41q67-30 128.5-45T360-340q62 0 123 15.5t127.92 44.69q31.3 14.13 50.19 40.97Q680-212 680-174v94H40Zm60-60h520v-34q0-16-9.5-30.5T587-226q-64-31-117-42.5T360-280q-57 0-111 11.5T132-226q-14 7-23 21.5t-9 30.5v34Zm260-411Zm0 411Z",
    school: "M479-120 189-279v-240L40-600l439-240 441 240v317h-60v-282l-91 46v240L479-120Zm0-308 315-172-315-169-313 169 313 172Zm0 240 230-127v-168L479-360 249-485v170l230 127Zm1-240Zm-1 74Zm0 0Z",
    star: "m323-245 157-94 157 95-42-178 138-120-182-16-71-168-71 167-182 16 138 120-42 178Zm-90 125 65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Zm247-355Z",
    book: "M560-574v-48q33-14 67.5-21t72.5-7q26 0 51 4t49 10v44q-24-9-48.5-13.5T700-610q-38 0-73 9.5T560-574Zm0 220v-49q33-13.5 67.5-20.25T700-430q26 0 51 4t49 10v44q-24-9-48.5-13.5T700-390q-38 0-73 9t-67 27Zm0-110v-48q33-14 67.5-21t72.5-7q26 0 51 4t49 10v44q-24-9-48.5-13.5T700-500q-38 0-73 9.5T560-464ZM248-300q53.57 0 104.28 12.5Q403-275 452-250v-427q-45-30-97.62-46.5Q301.76-740 248-740q-38 0-74.5 9.5T100-707v434q31-14 70.5-20.5T248-300Zm264 50q50-25 98-37.5T712-300q38 0 78.5 6t69.5 16v-429q-34-17-71.82-25-37.82-8-76.18-8-54 0-104.5 16.5T512-677v427Zm-30 90q-51-38-111-58.5T248-239q-36.54 0-71.77 9T106-208q-23.1 11-44.55-3Q40-225 40-251v-463q0-15 7-27.5T68-761q42-20 87.39-29.5 45.4-9.5 92.61-9.5 63 0 122.5 17T482-731q51-35 109.5-52T712-800q46.87 0 91.93 9.5Q849-781 891-761q14 7 21.5 19.5T920-714v463q0 27.89-22.5 42.45Q875-194 853-208q-34-14-69.23-22.5Q748.54-239 712-239q-63 0-121 21t-109 58ZM276-489Z",
    image: "M180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm0-60h600v-600H180v600Zm56-97h489L578-473 446-302l-93-127-117 152Zm-56 97v-600 600Z",
    code: "M320-242 80-482l242-242 43 43-199 199 197 197-43 43Zm318 2-43-43 199-199-197-197 43-43 240 240-242 242Z",
    upload: "M450-313v-371L330-564l-43-43 193-193 193 193-43 43-120-120v371h-60ZM220-160q-24 0-42-18t-18-42v-143h60v143h520v-143h60v143q0 24-18 42t-42 18H220Z",
    file: "M319-250h322v-60H319v60Zm0-170h322v-60H319v60ZM220-80q-24 0-42-18t-18-42v-680q0-24 18-42t42-18h361l219 219v521q0 24-18 42t-42 18H220Zm331-554v-186H220v680h520v-494H551ZM220-820v186-186 680-680Z",
    fileOpen: "M220-80q-24 0-42-18t-18-42v-680q0-24 18-42t42-18h340l240 240v270h-60v-230H520v-220H220v680h410v60H220Zm658 1L750-207v125h-60v-228h228v60H792l128 128-42 43Zm-658-61v-680 680Z",
    external: "M180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h279v60H180v600h600v-279h60v279q0 24-18 42t-42 18H180Zm202-219-42-43 398-398H519v-60h321v321h-60v-218L382-339Z",
    wand: "m162-121-42-42 326-326-185-46 192-120-16-225 173 145 209-84-85 209 146 173-226-17-119 192-46-185-327 326Zm25-544-67-67 68-68 67 67-68 68Zm372 251 63-102 120 9-78-92 45-111-111 45-92-78 9 120-102 64 117 29 29 116Zm174 294-67-68 67-67 67 68-67 67ZM578-579Z",
    calendar: "M180-80q-24 0-42-18t-18-42v-620q0-24 18-42t42-18h65v-60h65v60h340v-60h65v60h65q24 0 42 18t18 42v620q0 24-18 42t-42 18H180Zm0-60h600v-430H180v430Zm0-490h600v-130H180v130Zm0 0v-130 130Zm300 230q-17 0-28.5-11.5T440-440q0-17 11.5-28.5T480-480q17 0 28.5 11.5T520-440q0 17-11.5 28.5T480-400Zm-188.5-11.5Q280-423 280-440t11.5-28.5Q303-480 320-480t28.5 11.5Q360-457 360-440t-11.5 28.5Q337-400 320-400t-28.5-11.5ZM640-400q-17 0-28.5-11.5T600-440q0-17 11.5-28.5T640-480q17 0 28.5 11.5T680-440q0 17-11.5 28.5T640-400ZM480-240q-17 0-28.5-11.5T440-280q0-17 11.5-28.5T480-320q17 0 28.5 11.5T520-280q0 17-11.5 28.5T480-240Zm-188.5-11.5Q280-263 280-280t11.5-28.5Q303-320 320-320t28.5 11.5Q360-297 360-280t-11.5 28.5Q337-240 320-240t-28.5-11.5ZM640-240q-17 0-28.5-11.5T600-280q0-17 11.5-28.5T640-320q17 0 28.5 11.5T680-280q0 17-11.5 28.5T640-240Z",
    box: "M450-154v-309L180-619v309l270 156Zm60 0 270-156v-310L510-463v309Zm-60 69L150-258q-14-8-22-22t-8-30v-340q0-16 8-30t22-22l300-173q14-8 30-8t30 8l300 173q14 8 22 22t8 30v340q0 16-8 30t-22 22L510-85q-14 8-30 8t-30-8Zm194-525 102-59-266-154-102 59 266 154Zm-164 96 104-61-267-154-104 60 267 155Z",
    pen: "M180-180h44l472-471-44-44-472 471v44Zm-60 60v-128l575-574q8-8 19-12.5t23-4.5q11 0 22 4.5t20 12.5l44 44q9 9 13 20t4 22q0 11-4.5 22.5T823-694L248-120H120Zm659-617-41-41 41 41Zm-105 64-22-22 44 44-22-22Z",
    print: "M658-648v-132H302v132h-60v-192h476v192h-60Zm-518 60h680-680Zm599 95q12 0 21-9t9-21q0-12-9-21t-21-9q-12 0-21 9t-9 21q0 12 9 21t21 9Zm-81 313v-192H302v192h356Zm60 60H242v-176H80v-246q0-45.05 30.5-75.53Q141-648 186-648h588q45.05 0 75.53 30.47Q880-587.05 880-542v246H718v176Zm102-236v-186.21Q820-562 806.78-575q-13.23-13-32.78-13H186q-19.55 0-32.77 13.22Q140-561.55 140-542v186h102v-76h476v76h102Z",
    fullscreen: "M120-120v-193h60v133h133v60H120Zm527 0v-60h133v-133h60v193H647ZM120-647v-193h193v60H180v133h-60Zm660 0v-133H647v-60h193v193h-60Z",
    next: "M686-450H160v-60h526L438-758l42-42 320 320-320 320-42-42 248-248Z",
    clock: "m627-287 45-45-159-160v-201h-60v225l174 181ZM480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-82 31.5-155t86-127.5Q252-817 325-848.5T480-880q82 0 155 31.5t127.5 86Q817-708 848.5-635T880-480q0 82-31.5 155t-86 127.5Q708-143 635-111.5T480-80Zm0-400Zm0 340q140 0 240-100t100-240q0-140-100-240T480-820q-140 0-240 100T140-480q0 140 100 240t240 100Z",
    apps: "M179-179q-19-19-19-47t19-47q19-19 47-19t47 19q19 19 19 47t-19 47q-19 19-47 19t-47-19Zm254 0q-19-19-19-47t19-47q19-19 47-19t47 19q19 19 19 47t-19 47q-19 19-47 19t-47-19Zm254 0q-19-19-19-47t19-47q19-19 47-19t47 19q19 19 19 47t-19 47q-19 19-47 19t-47-19ZM179-433q-19-19-19-47t19-47q19-19 47-19t47 19q19 19 19 47t-19 47q-19 19-47 19t-47-19Zm254 0q-19-19-19-47t19-47q19-19 47-19t47 19q19 19 19 47t-19 47q-19 19-47 19t-47-19Zm254 0q-19-19-19-47t19-47q19-19 47-19t47 19q19 19 19 47t-19 47q-19 19-47 19t-47-19ZM179-687q-19-19-19-47t19-47q19-19 47-19t47 19q19 19 19 47t-19 47q-19 19-47 19t-47-19Zm254 0q-19-19-19-47t19-47q19-19 47-19t47 19q19 19 19 47t-19 47q-19 19-47 19t-47-19Zm254 0q-19-19-19-47t19-47q19-19 47-19t47 19q19 19 19 47t-19 47q-19 19-47 19t-47-19Z",
    skip: "M104-240v-480l346 240-346 240Zm407 0v-480l346 240-346 240ZM164-480Zm407 0ZM164-355l181-125-181-125v250Zm407 0 181-125-181-125v250Z",
    reset: "M451-122q-123-10-207-101t-84-216q0-77 35.5-145T295-695l43 43q-56 33-87 90.5T220-439q0 100 66 173t165 84v60Zm60 0v-60q100-12 165-84.5T741-439q0-109-75.5-184.5T481-699h-20l60 60-43 43-133-133 133-133 43 43-60 60h20q134 0 227 93.5T801-439q0 125-83.5 216T511-122Z",
    touch: "M445-80q-29 0-56-12t-45-35L127-403l21-23q14-15 34.5-18.5T221-438l99 53v-365q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v465l-144-77 156 198q10 12 23.76 18 13.76 6 29.24 6h205q38 0 64-26t26-64v-170q0-25.5-17.25-42.75T680-460H460v-60h219.65q50.14 0 85.25 35 35.1 35 35.1 85v170q0 63-43.5 106.5T650-80H445ZM203-665q-11.07-18.75-17.04-40.49-5.96-21.74-5.96-44.76 0-70.75 49.5-120.25T350-920q71 0 120.5 49.74t49.5 120.3q0 22.96-5.96 44.62Q508.07-683.68 497-665l-52-30q7-12 11-26t4-29.48Q460-796 427.88-828q-32.12-32-78-32T272-827.92q-32 32.09-32 77.92 0 15 4 29t11 26l-52 30Zm285 335Z",
    zoom: "M40-490v-170h40v102l131-131 28 28-131 131h102v40H40Zm259-231-28-28 131-131H300v-40h170v170h-40v-102L299-721ZM590-40q-21.88 0-41.94-8T512-72L304-280l15-22q11-16 28.5-22.5T384-326l96 26v-340q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v420l-124-33 139.18 139.18Q562-107 571.13-103.5q9.13 3.5 18.87 3.5h170q42 0 71-29t29-71v-180q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v180q0 66-47 113T760-40H590Zm17-290v-170q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v170h-60Zm126 0v-130q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v130h-60Zm-46 105Z",
    statusbar: "M140-160q-24 0-42-18t-18-42v-520q0-24 18-42t42-18h680q24 0 42 18t18 42v520q0 24-18 42t-42 18H140Zm0-60h680v-436H140v436Z",
    antenna: "M197-197q-54-54-85.5-126.5T80-480q0-84 31.5-156.5T197-763l43 43q-46 46-73 107.5T140-480q0 71 26.5 132T240-240l-43 43Zm113-113q-32-32-51-75.5T240-480q0-51 19-94.5t51-75.5l43 43q-24 24-38.5 56.5T300-480q0 38 14 70t39 57l-43 43Zm113.5-113.5Q400-447 400-480t23.5-56.5Q447-560 480-560t56.5 23.5Q560-513 560-480t-23.5 56.5Q513-400 480-400t-56.5-23.5ZM650-310l-43-43q24-24 38.5-56.5T660-480q0-38-14-70t-39-57l43-43q32 32 51 75.5t19 94.5q0 50-19 93.5T650-310Zm113 113-43-43q46-46 73-107.5T820-480q0-71-26.5-132T720-720l43-43q54 55 85.5 127.5T880-480q0 83-31.5 155.5T763-197Z",
    settings: "m388-80-20-126q-19-7-40-19t-37-25l-118 54-93-164 108-79q-2-9-2.5-20.5T185-480q0-9 .5-20.5T188-521L80-600l93-164 118 54q16-13 37-25t40-18l20-127h184l20 126q19 7 40.5 18.5T669-710l118-54 93 164-108 77q2 10 2.5 21.5t.5 21.5q0 10-.5 21t-2.5 21l108 78-93 164-118-54q-16 13-36.5 25.5T592-206L572-80H388Zm48-60h88l14-112q33-8 62.5-25t53.5-41l106 46 40-72-94-69q4-17 6.5-33.5T715-480q0-17-2-33.5t-7-33.5l94-69-40-72-106 46q-23-26-52-43.5T538-708l-14-112h-88l-14 112q-34 7-63.5 24T306-642l-106-46-40 72 94 69q-4 17-6.5 33.5T245-480q0 17 2.5 33.5T254-413l-94 69 40 72 106-46q24 24 53.5 41t62.5 25l14 112Zm44-210q54 0 92-38t38-92q0-54-38-92t-92-38q-54 0-92 38t-38 92q0 54 38 92t92 38Zm0-130Z",
    switch: "M285-285v-390h390v390H285Zm60-60h270v-270H345v270Zm-225 60v-60h60v60h-60Zm0-330v-60h60v60h-60Zm165 495v-60h60v60h-60Zm0-660v-60h60v60h-60Zm330 660v-60h60v60h-60Zm0-660v-60h60v60h-60Zm165 495v-60h60v60h-60Zm0-330v-60h60v60h-60ZM480-480Z",
    library: "M510-378h60v-132h132v-60H570v-132h-60v132H378v60h132v132ZM260-200q-24 0-42-18t-18-42v-560q0-24 18-42t42-18h560q24 0 42 18t18 42v560q0 24-18 42t-42 18H260Zm0-60h560v-560H260v560ZM140-80q-24 0-42-18t-18-42v-620h60v620h620v60H140Zm120-740v560-560Z",
    mic: "M408-453.92q-29-30.91-29-75.08v-251q0-41.67 29.44-70.83Q437.88-880 479.94-880t71.56 29.17Q581-821.67 581-780v251q0 44.17-29 75.08Q523-423 480-423t-72-30.92ZM480-651Zm-30 531v-136q-106-11-178-89t-72-184h60q0 91 64.29 153t155.5 62q91.21 0 155.71-62Q700-438 700-529h60q0 106-72 184t-178 89v136h-60Zm59.5-376.5Q521-510 521-529v-251q0-17-11.79-28.5T480-820q-17.42 0-29.21 11.5T439-780v251q0 19 11.5 32.5T480-483q18 0 29.5-13.5Z",
    pointer: "M468-240q-96-5-162-74t-66-166q0-100 70-170t170-70q97 0 166 66t74 163l-63-20q-11-64-60-106.5T480-660q-75 0-127.5 52.5T300-480q0 67 42.5 116.5T449-303l19 63Zm48 158q-9 1-18 1.5t-18 .5q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 9-.5 18t-1.5 18l-58-18v-18q0-142-99-241t-241-99q-142 0-241 99t-99 241q0 142 99 241t241 99h18l18 58Zm305 22L650-231 600-80 480-480l400 120-151 50 171 171-79 79Z",
    list: "M290-620v-60h550v60H290Zm0 170v-60h550v60H290Zm0 170v-60h550v60H290ZM150-620q-12 0-21-9t-9-21.5q0-12.5 9-21t21.5-8.5q12.5 0 21 8.62 8.5 8.63 8.5 21.38 0 12-8.62 21-8.63 9-21.38 9Zm0 170q-12 0-21-9t-9-21.5q0-12.5 9-21t21.5-8.5q12.5 0 21 8.62 8.5 8.63 8.5 21.38 0 12-8.62 21-8.63 9-21.38 9Zm0 170q-12 0-21-9t-9-21.5q0-12.5 9-21t21.5-8.5q12.5 0 21 8.62 8.5 8.63 8.5 21.38 0 12-8.62 21-8.63 9-21.38 9Z",
    wifiAdd: "M740-120v-120H620v-60h120v-120h60v120h120v60H800v120h-60Zm-260 0L0-600q99-94 221-147t259-53q137 0 259 53t221 147L825-465l-20.5-20.5L784-506l88-88q-87-68-184.5-107T480-740q-110 0-207.5 39T88-594l392 392 60-60 20.5 20.5L581-221 480-120Zm0-351Z",
    bug: "M480-180q72 0 123-50.5T654-353v-167q0-72-51-122.5T480-693q-72 0-123 50.5T306-520v167q0 72 51 122.5T480-180Zm-80-140h160v-60H400v60Zm0-173h160v-60H400v60Zm80.5 57h-.5.5-.5.5-.5.5-.5.5Zm-.5 316q-65 0-121-31t-83-89H160v-60h92q-7-26-7-52.5V-406h-85v-60h85q0-29 .5-57.5T254-580h-94v-60h120q14-28 37-49t51-35l-77-76 40-40 94 94q28-10 56.5-10t56.5 10l94-94 40 40-76 76q28 14 49.5 35.5T683-640h117v60h-94q9 28 8.5 56.5T714-466h86v60h-86q0 27 .5 53.5T708-300h92v60H685q-26 59-82.5 89.5T480-120Z",
    screen: "M333-387h60v-90q0-23.8 16.1-39.9Q425.2-533 449-533h81v70l100-100-100-100v70h-81q-48.33 0-82.17 33.83Q333-525.33 333-477v90ZM140-240q-24 0-42-18t-18-42v-480q0-24 18-42t42-18h680q24 0 42 18t18 42v480q0 24-18 42t-42 18H140Zm0-60h680v-480H140v480Zm0 0v-480 480ZM40-120v-60h880v60H40Z",
    translate: "m475-80 185-480h79L924-80h-65l-45-117H584L539-80h-64ZM162-201l-42-42 201-201q-51-53-85.5-107.5T183-660h65q16 43 43.5 85t72.5 88q46-48 85-117.5T505-740H40v-60h290v-80h60v80h290v60H567q-17 78-61.5 159.5T406-443l102 104-24 63-121-125-201 200Zm443-51h188l-94-248-94 248Z",
    palette: "M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-85 32-158t87.5-127q55.5-54 130-84.5T489-880q79 0 150 26.5T763.5-780q53.5 47 85 111.5T880-527q0 108-63 170.5T650-294h-75q-18 0-31 14t-13 31q0 27 14.5 46t14.5 44q0 38-21 58.5T480-80Zm0-400Zm-198 11q15-15 15-35t-15-35q-15-15-35-15t-35 15q-15 15-15 35t15 35q15 15 35 15t35-15Zm126-170q15-15 15-35t-15-35q-15-15-35-15t-35 15q-15 15-15 35t15 35q15 15 35 15t35-15Zm214 0q15-15 15-35t-15-35q-15-15-35-15t-35 15q-15 15-15 35t15 35q15 15 35 15t35-15Zm131 170q15-15 15-35t-15-35q-15-15-35-15t-35 15q-15 15-15 35t15 35q15 15 35 15t35-15ZM480-140q11 0 15.5-4.5T500-159q0-14-14.5-26T471-238q0-46 30-81t76-35h73q76 0 123-44.5T820-527q0-132-100-212.5T489-820q-146 0-247.5 98.5T140-480q0 141 99.5 240.5T480-140Z",
  };
  // AsTeRICS meanings, drawn in the same set so nothing looks foreign
  const AG = {
    "users": "users", "user-plus": "userAdd", "th-large": "grid", "home": "home", "volume-up": "volume", "sort-amount-down": "switch",
    "download": "library", "cog": "settings", "lock": "lock", "unlock": "unlock", "calendar-alt": "calendar", "microphone": "mic",
    "mouse-pointer": "pointer", "file-import": "fileOpen", "globe": "globe", "list-ul": "list",
  };
  // icon("refresh"); icon("ag:users") is the symbol for what AsTeRICS Grid calls "users".
  function icon(name, cls) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    const p = document.createElementNS(ns, "path");
    const key = name && name.startsWith("ag:") ? AG[name.slice(3)] : name;
    svg.setAttribute("class", "i" + (cls ? " " + cls : ""));
    svg.setAttribute("viewBox", "0 -960 960 960");
    svg.setAttribute("aria-hidden", "true");
    p.setAttribute("d", ICONS[key] || "");
    svg.appendChild(p);
    return svg;
  }
  // Icons written into the page as <svg class="i" data-ic="name"></svg>
  document.querySelectorAll("svg[data-ic]").forEach((el) => {
    el.replaceWith(icon(el.getAttribute("data-ic"), el.getAttribute("class").replace(/^i\b ?/, "")));
  });

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
    "locale", "tz", "hidden-net", "keep-apps", "skip-edu", "fk-extra"];
  // The app the tablets download: from config.js (written by the build), or entered under Mehr
  const CFG = Object.assign({ version: "", apkUrl: "", signatureChecksum: "" }, window.KIT_CONFIG || {});
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
          "mq-broker", "mq-port", "mq-user", "mq-topic", "locale", "tz", "hidden-net",
          "keep-apps", "skip-edu", "fk-extra"]) if (k in old) saved[k] = old[k];
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
    // An own link counts only for the kit version it was entered in; a newer kit brings its own
    const own = lsGet("fkkit.apk");
    const useOwn = own && (own.version === CFG.version || !CFG.apkUrl);
    $("apk-url").value = useOwn ? own.url || "" : CFG.apkUrl;
    $("apk-sig").value = useOwn ? own.sig || "" : CFG.signatureChecksum;
    let pw = [];
    try { pw = JSON.parse(sessionStorage.getItem("fkkit.wifipw") || "[]"); } catch (e) { pw = []; }
    wifiMore = (Array.isArray(saved["wifi-more"]) ? saved["wifi-more"] : []).slice(0, MAX_WIFI)
      .map((s) => ({ s: String(s), p: ((pw.find((x) => x[0] === s) || [])[1]) || "" }));
    drawWifiMore();
    return saved;
  }
  function save() {
    const out = {};
    for (const id of persistIds) {
      const el = $(id);
      out[id] = (el.type === "checkbox" || el.type === "radio") ? el.checked : el.value;
    }
    // Spare networks: names are kept, passwords only for this browser tab (like the main one)
    out["wifi-more"] = wifiMore.map((w) => w.s).filter((s) => s.trim());
    lsSet(STORE, out);
    const url = $("apk-url").value.trim(), sig = $("apk-sig").value.trim();
    if (url !== CFG.apkUrl || sig !== CFG.signatureChecksum) lsSet("fkkit.apk", { version: CFG.version, url, sig });
    else { try { localStorage.removeItem("fkkit.apk"); } catch (e) { /* private mode */ } }
    try { sessionStorage.setItem("fkkit.wifipw", JSON.stringify(wifiMore.map((w) => [w.s, w.p]))); } catch (e) { /* private mode */ }
  }

  // ---------------------------------------------------------------- spare Wi-Fi networks
  let wifiMore = [];
  const MAX_WIFI = 5;
  function drawWifiMore() {
    const box = $("wifi-more");
    const rows = wifiMore.map((w, i) => {
      const name = h("input", { type: "text", value: w.s, placeholder: "WLAN-Name", spellcheck: "false", "aria-label": `Weiteres WLAN ${i + 1}, Name` });
      const pass = h("input", { type: "password", value: w.p, placeholder: "Passwort", spellcheck: "false", autocomplete: "new-password", "aria-label": `Weiteres WLAN ${i + 1}, Passwort` });
      name.addEventListener("input", () => { w.s = name.value; });
      pass.addEventListener("input", () => { w.p = pass.value; });
      return h("div", { class: "row wm" }, h("span", { class: "nav-ic" }, icon("wifi")), name, pass,
        h("button", { type: "button", class: "x", "aria-label": "Entfernen", onclick: () => { wifiMore.splice(i, 1); drawWifiMore(); render(); } }, icon("x")));
    });
    fill(box, rows,
      wifiMore.length < MAX_WIFI ? h("button", { type: "button", class: "row add", onclick: () => {
        wifiMore.push({ s: "", p: "" });
        drawWifiMore();
        const inputs = box.querySelectorAll("input[type=text]");
        if (inputs.length) inputs[inputs.length - 1].focus();
      } }, h("span", { class: "nav-ic" }, icon("plus")), "WLAN hinzufügen") : null);
  }

  const radio = (name) => document.querySelector(`input[name="${name}"]:checked`).value;

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
      url: $("apk-url").value, sigChecksum: $("apk-sig").value,
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
        wifiMore: wifiMore.map((w) => ({ s: w.s.trim(), p: w.p })).filter((w) => w.s),
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
    $("mqtt-group").hidden = !$("fk-mqtt").checked;
    const url = $("apk-url").value.trim();
    const tag = (url.match(/\/releases\/download\/([^/]+)\//) || [])[1];
    $("apk-line").textContent = !url ? "Link fehlt, unter Mehr eintragen"
      : url === CFG.apkUrl && CFG.version ? CFG.version : tag ? `${tag} (eigener Link)` : "eigener Link";

    const res = buildProvisioning(opts());
    lastText = JSON.stringify(res.json);
    $("json").textContent = JSON.stringify(res.json, null, 2);

    const msgs = $("msgs");
    msgs.textContent = "";
    const add = (cls, t) => msgs.appendChild(h("li", {}, h("span", { class: "dot " + cls }), h("span", {}, t)));
    res.problems.forEach((t) => add("bad", t));
    res.warnings.forEach((t) => add("warn", t));

    let modules = 0;
    try { modules = drawQR($("qr"), lastText, cardSize()); } catch (e) { add("bad", "QR zu groß: " + e.message); }
    const ready = res.problems.length === 0 && modules > 0;
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

  function nextTablet() {
    const el = $("mq-name");
    const m = el.value.match(/^(.*?)(\d+)\s*$/);
    el.value = m ? m[1] + String(parseInt(m[2], 10) + 1).padStart(m[2].length, "0") : (el.value.trim() || "tablet") + "-02";
    render();
    hud(el.value);
  }

  function boot() {
    load();
    if (CFG.version) fill($("kit-version"), "Kit ", CFG.version);
    render();
  }

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
    $, h, fill, icon, toggle, hud, ago, lsGet, lsSet, mqttSettings, adminKey, setAdminKey, show,
    onShow(view, fn) { (listeners[view] = listeners[view] || []).push(fn); },
    onChange(fn) { changeHooks.push(fn); },
    get view() { return current; },
  };

  document.addEventListener("DOMContentLoaded", () => {
    boot();
    show(location.hash.slice(1) || "tablets");
  });
})();
