# Medical glossary (uz / ru / en)

Every medical word the UI uses, with the source we checked. Owner decision (2026-11-08): Claude checks translations.
**Confidence**: high = standard term in clinical texts; medium = seen in Uzbek sources but usage varies; low = Claude's
choice, ask a doctor before the demo. Change a term here first, then in `frontend/src/i18n/locales/*.json`.

| English | Русский | Oʻzbekcha | Conf. (uz) | Where | Source / note |
| --- | --- | --- | --- | --- | --- |
| heart murmur | шум в сердце | yurak shovqini | high | AI result, tagline | Uzbek auscultation texts use *shovqin* for murmur [3] |
| heart sounds | тоны сердца | yurak tonlari / yurak tovushlari | medium | tagline ("tovushlari" chosen as plainer for patients) | *ton* in [3]; *tovush* = everyday word |
| auscultation | аускультация | auskultatsiya | high | help texts | [3] |
| screening | скрининг | skrining | high | tagline, disclaimer | loanword used in Uzbek health texts |
| aortic valve (AV) | аортальный клапан | aorta qopqogʻi | high | chest point | [1] "Aorta qopqogʻi: aorta va chap qorincha orasida" — was "aortal qopqoq", corrected |
| pulmonary valve (PV) | клапан лёгочной артерии | oʻpka arteriyasi qopqogʻi | high | chest point | [1] "Oʻpka qopqogʻi: oʻpka arteriyasi va oʻng qorincha oʻrtasida" |
| tricuspid valve (TV) | трикуспидальный клапан | uch tavaqali qopqoq | high | chest point | [1] "uch tavaqali (trikuspid) qopqoq" |
| mitral valve (MV) | митральный клапан | mitral qopqoq | high | chest point | [1][2] (also "ikki tavaqali") |
| exam (one recording session) | обследование | tekshiruv | high | everywhere | everyday clinical word |
| conclusion (doctor's) | заключение | xulosa | high | review | standard |
| consent (signed) | согласие (подписанное) | rozilik (imzolangan) | high | patient page | standard |
| one-time password | одноразовый пароль | bir martalik parol | high | logins | standard UI term |
| research prototype, not a medical device | исследовательский прототип, не медицинское изделие | tadqiqot prototipi, tibbiy buyum emas | medium | disclaimer | ru: *медицинское изделие* is the legal term; uz: *tibbiy buyum* — ask a doctor whether *tibbiy asbob* reads better |
| re-record | перезаписать | qayta yozish | high | failed exam | plain wording |
| murmur detected / no murmur detected | обнаружен шум / шум не обнаружен | shovqin aniqlandi / shovqin aniqlanmadi | high | AI card | follows *yurak shovqini* [3] |
| spectrogram | спектрограмма | spektrogramma | high | recording | loanword, same in all three |
| murmur probability (AI score) | вероятность шума | shovqin ehtimoli | high | AI card | always P(murmur); replaced "confidence" (1.1.0 flags from a low probability) |
| listening (auscultation) point | точка аускультации (врачу) / точка выслушивания (пациенту) | tinglash nuqtasi | high | new exam, patient result | plain word *tinglash*; "eshitish" (hearing) was replaced |
| intercostal space | межреберье | qovurgʻalararo oraliq | high | chest point notes (doctor) | standard anatomy term in Uzbek texts [4] |
| sternum (doctor) / breastbone (patient) | грудина | toʻsh suyagi | high | chest point notes | everyday and anatomical word [4] |
| mid-clavicular line | срединно-ключичная линия | oʻrta oʻmrov chizigʻi | medium | MV point note | seen as "qovurgʻaning oʻrta oʻmrov chizigʻi" in an Uzbek anatomy note [4] |
| (cardiac) apex | верхушка сердца | yurak uchi | medium | MV point note | [4] uses *yurak uchi*; *yurak choʻqqisi* also occurs — was "choʻqqi", changed |
| ECG (electrocardiogram) | ЭКГ (электрокардиограмма) | EKG (elektrokardiogramma) | high | exam page | loanword, standard abbreviation in Uzbek clinics |
| single lead | одно отведение | bitta tarmoq | medium | ECG card | *tarmoq* is the Uzbek term for an ECG lead in clinical texts; ask a doctor |
| heart rate | ЧСС (частота сердечных сокращений) | yurak urish tezligi | high | ECG card | everyday clinical phrase; unit "/daq" (per minute) |
| atrial fibrillation (AF) | фибрилляция предсердий (ФП) | boʻlmachalar fibrillyatsiyasi (FP) | medium | ECG rhythm | *boʻlmacha* = atrium; also called *hilpillovchi aritmiya* — ask a doctor which reads better |
| 12-lead ECG | ЭКГ в 12 отведениях | 12 tarmoqli EKG | medium | AF confirmation | follows *tarmoq* above |
| electrode | электрод | elektrod | high | ECG problems | loanword |
| nipple | сосок | koʻkrak soʻrgʻichi | high | patient MV description | everyday word, patient-facing |
| almost silent (recording) | почти тишина | ovoz deyarli yoʻq | high | quality reasons | plain wording |
| AI (artificial intelligence) | ИИ (искусственный интеллект) | AI (sunʼiy intellekt) | medium | AI card, review | uz UI keeps the short "AI" as on Uzbek tech sites; the pitch spells *sunʼiy intellekt* once |
| online / offline (device) | в сети / не в сети | ulangan / ulanmagan | high | devices | one pair everywhere ("onlayn" removed) |
| screening aid, not a diagnosis | средство скрининга, не диагноз | skrining vositasi, tashxis emas | high | AI card | *tashxis* = diagnosis |
| clipped (too loud) | перегрузка (слишком громко) | haddan tashqari baland | medium | quality reasons | plain wording rather than a technical term |

Sources: [1] Apollo Hospitals, Uzbek page on MitraClip / valves — https://www.apollohospitals.com/uz/procedures/mitraclip-valve-repair ·
[2] medigence.com Uzbek blog on valve replacement — https://medigence.com/uz/blog/heart-valve-replacement-cost-india/ ·
[3] Uzbek-language auscultation material (Termiz/Bukhara university papers via uniwork.buxdu.uz, journals.nuu.uz). ·
[4] Uzbek anatomy note on the heart's position (oefen.uz, "yurak tuzilishi va joylashuvi") — https://oefen.uz/uz/documents/referatlar/umumiy/yurak-tuzilishi-va-joylashuvi.
Uzbek medical terminology is less standardized than Russian: before the demo, one doctor should read the uz column once —
first the **medium** rows. Full string pass done 2026-11-08 (task 8): 414 keys × 3 languages read; automated checks in
`frontend/src/i18n/i18n.test.ts` (same keys, plural forms, placeholders, Uzbek Latin script with ʻ/ʼ, no Latin
look-alikes in Russian, nothing left in English).
