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
| confidence (of the AI) | уверенность | ishonch | medium | AI card | plain word; a doctor may prefer *ehtimollik* |
| screening aid, not a diagnosis | средство скрининга, не диагноз | skrining vositasi, tashxis emas | high | AI card | *tashxis* = diagnosis |
| clipped (too loud) | перегрузка (слишком громко) | haddan tashqari baland | medium | quality reasons | plain wording rather than a technical term |

Sources: [1] Apollo Hospitals, Uzbek page on MitraClip / valves — https://www.apollohospitals.com/uz/procedures/mitraclip-valve-repair ·
[2] medigence.com Uzbek blog on valve replacement — https://medigence.com/uz/blog/heart-valve-replacement-cost-india/ ·
[3] Uzbek-language auscultation material (Termiz/Bukhara university papers via uniwork.buxdu.uz, journals.nuu.uz).
Uzbek medical terminology is less standardized than Russian: before the demo, one doctor should read the uz column once.
