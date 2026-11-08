# MurMur — MVP plani va tizim arxitekturasi

Nov 8, 2026 · @Bilol Kobilov

## Qisqa xulosa

MVP oddiy: qurilma 20 soniya yurak tovushini yozadi, serverdagi o'zimizning AI model uni tekshiradi, doktor natijani saytda ko'radi. Hech narsa noldan ixtiro qilinmaydi: faqat tayyor kutubxonalar va ochiq modellar ishlatiladi.

| Qism | Nima ishlatamiz | Izoh |
| --- | --- | --- |
| Qurilma | ESP32-S3 + ICS-43434 mikrofon + MPU6050 | ADS1292R (ECG) 2-bosqichda, faqat grafik uchun |
| Qurilma kodi | Arduino IDE (C++) | Hammasi uchun tayyor kutubxona bor |
| Backend | Python, FastAPI | Qurilma, sayt va AI shu yerda uchrashadi |
| Baza | PostgreSQL (boshidanoq, Docker'da) | WAV fayllar diskda, bazada faqat yo'li |
| Frontend | React (Vite), wavesurfer.js, Recharts | wavesurfer: tovush to'lqini va eshitish; Recharts: ECG grafigi |
| AI | Local, o'z serverimizda | Sifat tekshiruvi + murmur modeli (5-bo'lim) |
| Aloqa | Wi-Fi + oddiy HTTP | Qurilma serverdan "buyruq bormi?" deb o'zi so'raydi |
| Joylashtirish | 1-versiya: noutbuk + hotspot. 2-versiya: server + domen + HTTPS | Kod bir xil, faqat manzil o'zgaradi |

Asosiy qarorlar:

- Mobil ilova qilinmaydi, faqat web sayt. Telefondan ham sayt ochiladi.
- AI tashqi kompaniyaga (ChatGPT va h.k.) hech narsa yubormaydi.
- Natija tashxis emas, "screening": "shubhali, shifokorga ko'rining" darajasida.
- PPT'dagi murakkab qismlar (fusion, baseline, self-calibration) "future work" ga o'tadi.

## Tizim qanday ishlaydi

Tizim uch qismdan iborat: qurilma, server va sayt. Qurilma faqat server bilan gaplashadi, doktor va admin esa faqat sayt bilan ishlaydi.

&#91;embedded content: MurMur tizimi · 3 qism\]

Qurilma yozuvni serverga yuboradi va serverdan buyruq oladi. AI server ichida ishlaydi, sayt natijani API orqali oladi. ECG (punktir) 2-bosqichda qo'shiladi.

- **1-versiya (local):** noutbuk hotspot yoqadi, qurilma unga ulanadi. Server va sayt noutbukda ishlaydi, internet kerak emas.
- **2-versiya (server):** server internetda (domen + HTTPS). Qurilma istalgan internetli Wi-Fi'ga ulanadi, Wi-Fi nomi va paroli WiFiManager orqali kiritiladi. Kodda faqat server manzili o'zgaradi.

## Rollar: Admin, Doktor va Bemor

Uch rol bor. Saytda ochiq ro'yxatdan o'tish bo'lmaydi: doktor akkauntini admin, bemor akkauntini doktor yaratadi.

### Admin

- **Qurilmalar:** qo'shish (nomi, seriya raqami), doktorga biriktirish, holati (online/offline, oxirgi signal vaqti), Wi-Fi signal kuchi, dastur versiyasi.
- **Doktorlar:** akkaunt yaratish, bloklash, parolni tiklash.
- **Tizim holati:** bugungi tekshiruvlar soni, xatolar (yaroqsiz yozuvlar, yuklanmay qolgan fayllar), ishlayotgan AI model versiyasi.
- **Audit log:** kim, qaysi bemorning ma'lumotini, qachon ochgani.

Admin bemorlarning tibbiy natijalarini ko'rmaydi, faqat sonlarni ko'radi. Bu data xavfsizligi uchun plyus.

### Doktor

- **Bemorlar:** qo'shish (ism, tug'ilgan yil, jins, bo'y, vazn) va "rozilik olindi" belgisi. Bemorga login yaratiladi: vaqtinchalik parol doktorga bir marta ko'rsatiladi, bemor birinchi kirishda uni almashtiradi. Bo'y, vazn va yosh CardioPHON modeliga ham kerak bo'ladi.
- **Yangi tekshiruv:** pastdagi jarayon.
- **Natija sahifasi:** tovush to'lqini, eshitish tugmasi, AI natijasi va foizi, ogohlantirishlar.
- **Bemor tarixi:** oldingi tekshiruvlar ro'yxati.
- **Hisobot (ixtiyoriy):** natijani PDF qilib yuklab olish.

Doktor faqat o'z bemorlarini ko'radi.

### Bemor

- O'z profili va tekshiruvlari ro'yxatini ko'radi.
- Natijani faqat doktor ko'rib chiqib "tasdiqlangan" deb belgilagandan keyin, doktor izohi bilan birga ko'radi.
- Boshqa bemorlarning ma'lumotlarini ko'ra olmaydi.

Xom AI natijasi bemorga to'g'ridan-to'g'ri ko'rsatilmaydi: izohsiz "anormal" so'zi bemorni bekorga qo'rqitadi.

### Tekshiruv jarayoni

1. Doktor bemorni tanlaydi va "Yangi tekshiruv" ni bosadi.
2. Qurilmani va ko'krakdagi nuqtani tanlaydi: AV, PV, TV yoki MV (CirCor'dagi 4 nuqta).
3. "Yozishni boshlash" ni bosadi. Server shu qurilma uchun buyruq saqlab qo'yadi.
4. Qurilma har 1–2 soniyada serverdan "buyruq bormi?" deb so'raydi, buyruqni oladi va 20 soniya yozadi. Qurilmadagi chiroq yonib turadi.
5. Qurilma WAV fayl va harakat (MPU6050) ma'lumotini serverga yuboradi.
6. Server avval sifatni tekshiradi. Yomon bo'lsa, doktorga "qayta yozing" chiqadi. Yaxshi bo'lsa, AI modelga beradi.
7. Doktor ekranida natija chiqadi.
8. Doktor o'z xulosasini yozadi: "AI bilan roziman / rozi emasman" va izoh. Yakuniy qarorni doim odam qiladi.

## Ma'lumotlar bazasi va API

Bazada 8 ta jadval yetarli. Qurilma o'z kaliti (API key) bilan, sayt foydalanuvchilari esa login (JWT token) bilan kiradi.

### Jadvallar

| Jadval | Asosiy maydonlar |
| --- | --- |
| users | id, ism, email, parol xeshi, rol (admin/doctor/patient), faolmi |
| devices | id, nomi, seriya, API key xeshi, biriktirilgan doktor, oxirgi signal vaqti, Wi-Fi kuchi, dastur versiyasi |
| patients | id, doktor, bemor logini (users), ism, tug'ilgan yil, jins, bo'y, vazn, rozilik olingan vaqt |
| exams | id, bemor, doktor, qurilma, nuqta (AV/PV/TV/MV), holat, doktor izohi, doktor roziligi |
| recordings | id, tekshiruv, fayl yo'li, sample rate, davomiyligi, harakat bo'lganmi |
| ai\_results | id, tekshiruv, model nomi, model versiyasi, sifat (yaxshi/yomon), natija, foiz |
| device\_commands | id, qurilma, tekshiruv, buyruq (record), soniya, holat (kutyapti/olindi/bajarildi) |
| audit\_logs | id, foydalanuvchi, harakat, qaysi obyekt, vaqt |

Tekshiruv holatlari ketma-ket o'zgaradi: kutyapti → yozilyapti → yuklandi → tahlil qilindi → doktor tasdiqladi (yoki xato).

### API

| Kim uchun | Manzil | Nima qiladi |
| --- | --- | --- |
| Qurilma | POST /api/device/heartbeat | Har 10 soniyada "men tirikman" + Wi-Fi kuchi, versiya |
| Qurilma | GET /api/device/command | Bajarilmagan buyruq bormi, so'raydi |
| Qurilma | POST /api/device/upload/{exam\_id} | WAV fayl + JSON (harakat, keyin ECG) yuboradi |
| Sayt | POST /api/auth/login | Kirish, JWT token oladi |
| Doktor | GET, POST /api/patients | Bemorlar ro'yxati va yangi bemor |
| Doktor | POST /api/exams | Yangi tekshiruv va qurilmaga buyruq |
| Doktor | GET /api/exams/{id} | Holat va natija (sayt har 2 soniyada so'raydi) |
| Doktor | GET /api/exams/{id}/audio | Yozuvni eshitish uchun WAV |
| Doktor | PATCH /api/exams/{id} | Doktor izohi va xulosasi |
| Admin | /api/admin/devices, /users, /stats, /audit | Qurilmalar, doktorlar, statistika, audit log |

Bemor uchun: GET /api/me va GET /api/me/exams — faqat o'z ma'lumotlari va tasdiqlangan natijalari.

Fayl yuklangach, AI tahlili backend'da fon vazifasi sifatida ishlaydi (FastAPI BackgroundTasks). Shu sabab qurilma javobni kutib turmaydi.

## AI: qaysi model va qayerda

AI local ishlaydi: 1-versiyada noutbukda, 2-versiyada o'z serverimizda. Internetdagi AI xizmatlariga hech qanday ma'lumot ketmaydi. Tahlil ikki bosqichda bo'ladi: avval yozuv sifati tekshiriladi, keyin natija chiqariladi.

### 1. Sifat tekshiruvi

- **Oddiy qoidalar:** ovoz juda past yoki juda baland (to'lib ketgan), yozuv paytida MPU6050 harakat sezgan bo'lsa, yozuv rad etiladi.
- **CardioPHON sifat modeli:** yozuvni "yaroqli / yaroqsiz" deb baholaydi, maqolada aniqligi taxminan 93%. U 1 kHz'li tovush bilan ishlaydi.

Yozuv yaroqsiz bo'lsa, AI natija bermaydi, doktorga "qayta yozing" chiqadi.

### 2. Natija modeli (sinovdan keyin bittasi tanlanadi)

| Model | Nima deydi | Kiradigan ma'lumot | Plyus | Minus |
| --- | --- | --- | --- | --- |
| [AST heart murmur classifier](https://huggingface.co/rajnish612/ast-heart-murmur-classifier) | Murmur / Absent / Unknown | Tovush, 16 kHz | 5 qator kod bilan ishlaydi | Aniqligi e'lon qilinmagan, kam ishlatilgan |
| [CardioPHON](https://git.lih.lu/vdespotovic/cardiophon) | Normal / Anormal | Tovush 4 kHz + yosh, jins, bo'y, vazn | Maqolada isbotlangan, PPT'da \[1\] manba | Aniqligi taxminan 62%; sog'lomlarning yarmidan ko'pini "anormal" deydi; oxirgi qatlamni o'qitish kerak bo'lishi mumkin |

Qanday tanlaymiz: CirCor'dan 100 ta yozuv olinadi (har bemordan faqat bittasi, murmur bor va yo'q aralash). Ikkala model shu yozuvlarda ishga tushiriladi va aniqlik, sezgirlik (sensitivity), o'ziga xoslik (specificity) hisoblanadi. Qaysi biri yaxshi chiqsa, o'sha qo'yiladi. Bu solishtirish ISR qismi uchun tayyor natija bo'ladi.

Har bir natija bilan birga model nomi va versiyasi saqlanadi. Keyin model almashtirilsa, eski natijalar qaysi modeldan chiqqani ko'rinib turadi.

### Cheklovlar (komissiyaga ochiq aytiladi)

- CirCor Braziliyadagi bolalar yozuvlari. Kattalarda aniqlik pasayishi mumkin.
- Modellar klinik stetoskop yozuvlarida o'rgatilgan. Arzon mikrofonda aniqlik tushishi kutiladi (PPT'dagi \[6\] manba aynan shuni ko'rsatadi).
- Bu tashxis emas, faqat screening va doktorga yordam.

Server uchun GPU shart emas: bitta 20 soniyalik yozuvni oddiy protsessor ham bir necha soniyada tahlil qiladi.

## Data xavfsizligi: NTCC savollari va javoblari

Asosiy javob: hamma ma'lumot o'z serverimizda qoladi, AI ham o'sha yerda ishlaydi, uchinchi tomonga hech narsa ketmaydi. Quyida komissiya beradigan ehtimoliy savollar va tayyor javoblar.

| Savol | Javob |
| --- | --- |
| Ma'lumot qayerda saqlanadi? | 1-versiyada noutbukda, 2-versiyada o'z serverimizda. Bulutli AI xizmatlariga yuborilmaydi. |
| AI ma'lumotni tashqariga yuboradimi? | Yo'q. Model fayli serverda turadi va o'sha yerda ishlaydi. |
| Bemor ma'lumotini kim ko'radi? | Uni qo'shgan doktor va bemorning o'zi (faqat tasdiqlangan natijalarni). Admin faqat statistikani ko'radi. Har bir ochish audit log'ga yoziladi. |
| Ma'lumot qanday himoyalangan? | 2-versiyada HTTPS (Let's Encrypt). Parollar bcrypt bilan xeshlanadi. Sayt JWT token, qurilma esa o'z API kaliti bilan kiradi. Har bir rol faqat o'ziga ruxsat berilgan sahifani ochadi. |
| Yozuv faylida bemor ismi bormi? | Yo'q. Fayl nomi tasodifiy ID. Ism va boshqa shaxsiy ma'lumotlar alohida jadvalda (psevdonimlash). |
| Bemordan rozilik olinadimi? | Ha, yozma rozilik. Tizimda "rozilik olindi" belgisi bo'lmasa, tekshiruv boshlanmaydi. Hozir faqat jamoa a'zolari va ixtiyoriy ko'ngillilar sinaladi; haqiqiy bemorlardan oldin ethics approval olinadi. |
| Ma'lumotni o'chirish mumkinmi? | Ha. Bemor so'rasa, uning barcha yozuvlari va natijalari o'chiriladi. |
| Zaxira nusxa bormi? | 2-versiyada baza va fayllarning kunlik zaxira nusxasi olinadi. |
| Qonunga mosmi? | O'zbekistonning "Shaxsga doir ma'lumotlar to'g'risida"gi qonuni (ZRU-547) amal qiladi. 2026-yil martdagi o'zgarishdan keyin serverni faqat O'zbekistonda saqlash talabi asosan biometrik va genetik ma'lumotlarga qoldi ([kun.uz](https://kun.uz/en/news/2026/08/04/uzbekistan-approves-49-countries-for-simplified-personal-data-transfers)). Baribir eng xavfsiz yo'l: 2-versiya serverini O'zbekistondagi hostingda joylashtirish. |
| Bu tibbiy qurilmami? | Yo'q, tadqiqot prototipi. Haqiqiy tibbiy qurilma rasmiy ruxsat oladi (masalan, PPT'dagi \[11\] manba: Eko'ning FDA ruxsati). |
| Elektr xavfsizligi-chi? | ECG elektrodlari odamga ulanganda qurilma faqat power bank yoki batareyadan ishlaydi, rozetkadagi noutbukka USB orqali ulanmaydi. |

Qonun bo'yicha javobni taqdimotdan oldin yana bir bor tekshiring: men advokat emasman, qonun 2026-yilda o'zgargan.

## Jamoa rejasidagi xatolar va nimalar qo'shish kerak

PPT'dagi asosiy muammo: reja juda katta, ba'zi joylari esa texnik jihatdan noto'g'ri. Eng muhim yetishmayotgan narsa — mikrofonni ko'krakka qanday tegizish.

### Tuzatish kerak

| PPT'da | Muammo | To'g'risi |
| --- | --- | --- |
| "Wi-Fi 5" | ESP32-S3 faqat 2.4 GHz Wi-Fi 4 (802.11 b/g/n) va BLE 5 ni qo'llaydi | "Wi-Fi (2.4 GHz)" |
| Slide 14: "CardioEcho AI" | Loyiha nomi boshqa | MurMur |
| AI telefonda, "sensor to phone" | Mobil ilova yo'q, keraksiz murakkablik | AI serverda, natija web saytda |
| "MEMS sensor" | Mikrofon havo uchun; ko'krakka qanday tegishi rejada yo'q | Stetoskop boshi + trubka ichiga mikrofon (8-bo'lim) |
| Reference mic + adaptive noise cancellation | Ikkinchi mikrofon olinmagan, signal ishlovi murakkab | Oddiy filtr (25–400 Hz); ANC — future work |
| Self-calibration | Aniq reja yo'q | Future work |
| PPG | Sensor buyurtma qilinmagan | PPT'dan olib tashlash |
| MPU6050 | Sotib olingan, lekin PPT'da yo'q | Layer 1 ga qo'shish: harakat tekshiruvi |
| Fusion (H2), Baseline (H3), Fingerprint, Uncertainty, "Models 5 → 6" | MVP uchun juda katta | ISR yoki future work |
| "Time sync PCG + ECG" | Alohida muammo emas: ikkala signalni bitta ESP32 yig'adi | ECG 2-bosqichda, bitta vaqt bilan |
| Slide 10: "Delivery to Uzbekistan" | Eskirgan | Yangi holatni yozish |
| Cheklovlar yo'q | CirCor bolalar datasi, klinik stetoskop | 5-bo'limdagi cheklovlarni qo'shish |
| Quvvat yo'q | Batareya rejada yo'q | Power bank (8-bo'lim) |

### Qo'shish kerak (PPT'da umuman yo'q)

- Rollar (admin va doktor), login va ma'lumotlar bazasi.
- Qurilmani boshqarish: holati (online/offline) va saytdan "yozishni boshlash" buyrug'i.
- Data xavfsizligi bo'limi (6-bo'lim).
- Doktor xulosasi: yakuniy qarorni odam qiladi, AI faqat yordam beradi.
- Phantom test: CirCor yozuvlarini kichik dinamikdan qurilmaga eshittirib, odamsiz aniqlikni o'lchash. Ethics approval kutmasdan butun tizimni sinash mumkin bo'ladi.
- Ikki modelni solishtirish (5-bo'lim) — ISR uchun natija.

## Qo'shimcha xarid ro'yxati

Buyurtma qilingan 4 ta moduldan tashqari quyidagilar kerak. Eng muhimi — arzon stetoskop: mikrofon uning trubkasi ichiga joylanadi, shunda yurak tovushi to'g'ri ushlanadi.

| Narsa | Nima uchun | Qachon |
| --- | --- | --- |
| Arzon stetoskop (boshi + trubka) | Mikrofonni trubka ichiga joylash | Hoziroq, majburiy |
| Power bank (USB-C) | Quvvat va elektr xavfsizligi | Hoziroq, majburiy |
| USB-C data kabel | ESP32'ga kod yuklash | Hoziroq, majburiy |
| Breadboard, female-female simlar | Modullarni ulash | Hoziroq, majburiy |
| Payalnik va qalay | Modul pinlarini kavsharlash | Hoziroq, majburiy |
| Kichik dinamik yoki eski naushnik | Phantom test | Hoziroq, majburiy |
| Bir martalik ECG elektrodlar (snap) | ADS1292R uchun | ECG bosqichida |
| Ikkinchi ICS-43434 | Faqat shovqin kesish (ANC) qilinsa | Ixtiyoriy |
| 3D bosma korpus | Ko'krakka taqiladigan qurilma | MVP'dan keyin |

ADS1292R bilan birga kabellar kelgan bo'lishi mumkin (rasmda ko'rinadi), qurilma kelgach tekshiring.

## Haftalik ish rejasi va vazifa taqsimoti

Reja 5 haftaga mo'ljallangan, 9-noyabrdan boshlanadi. Qurilma kelguncha software tayyorlanadi, shuning uchun hech kim kutib o'tirmaydi. NTCC sanasi aniq bo'lsa, haftalar shunga moslab siqiladi.

### 1-hafta (9–15 noyabr): qurilmasiz

- [ ] Backend skeleti: FastAPI, login, rollar, jadvallar
- [ ] React: login, admin va doktor sahifalari skeleti
- [ ] CirCor'ni yuklab olish, 2 modelni 100 ta faylda sinash
- [ ] Stetoskop, power bank, simlar, payalnik sotib olish

### 2-hafta (16–22 noyabr): qurilma keladi

- [ ] Modullarni kavsharlash va ulash
- [ ] Mikrofondan WAV olish va noutbukka yuborish
- [ ] Heartbeat, admin sahifasida online/offline

### 3-hafta (23–29 noyabr): to'liq zanjir

- [ ] Saytdan "Boshlash" → qurilma yozadi → AI → natija
- [ ] Natija sahifasi: tovush to'lqini, foiz, doktor izohi
- [ ] Sifat tekshiruvi va MPU6050 harakat belgisi

### 4-hafta (30 noyabr – 6 dekabr): sinov

- [ ] Phantom test, natijalarni jadvalga yozish
- [ ] Audit log, PDF hisobot (ixtiyoriy)

### 5-hafta (7–13 dekabr): 2-versiya va taqdimot

- [ ] Serverga ko'chirish, domen, HTTPS, WiFiManager
- [ ] ECG grafigi (vaqt qolsa)
- [ ] PPT'ni yangilash, jonli demo tayyorlash

### Kim nima qiladi

Coding bilmaydigan a'zolar uchun ham aniq ish bor.

| Vazifa | Kim | Coding kerakmi |
| --- | --- | --- |
| Backend, frontend, qurilma kodi (Claude bilan) | Siz | Ha |
| Qurilmani yig'ish, kavsharlash, stetoskopga mikrofon joylash | 1 kishi | Yo'q |
| AI sinovi: tayyor skriptni ishga tushirish, natijalarni Excel'ga yozish | 1 kishi | Ozgina |
| Phantom test va qurilma sinovlari | 1 kishi | Yo'q |
| PPT, adabiyot, rozilik formasi, ethics hujjatlari | 1 kishi | Yo'q |

## Keyingi qadam: qurilma kodi

Qurilma kodi Arduino IDE'da, tayyor kutubxonalar bilan yoziladi. Modullar kelgach, quyidagi tartibda yozib beraman: avval mikrofon, keyin Wi-Fi va yuborish, keyin MPU6050, oxirida ECG.

| Modul | Kutubxona |
| --- | --- |
| ICS-43434 mikrofon (I2S) | ESP\_I2S (Arduino-ESP32 3.x ichida bor) |
| MPU6050 | Adafruit MPU6050 |
| ADS1292R (ECG) | ProtoCentral ADS1292R |
| Wi-Fi sozlash | WiFiManager |
| Serverga yuborish | HTTPClient (ichida bor) |

Arduino IDE sozlamalari: board — "ESP32S3 Dev Module", PSRAM — "OPI PSRAM", Flash — 16MB. Bu yozuvni xotirada vaqtincha saqlash uchun kerak.

Taxminiy ulanish (board kelgach pinout bo'yicha tasdiqlanadi):

- Mikrofon (I2S): BCLK → GPIO 4, WS → GPIO 5, SD → GPIO 6, L/R → GND.
- MPU6050 (I2C): SDA → GPIO 8, SCL → GPIO 9.
- ADS1292R (SPI): MOSI → 11, SCK → 12, MISO → 13, CS → 10, DRDY → 14, START → 15, PWDN → 16.
- GPIO 35, 36, 37 ishlatilmaydi: N16R8 board'da ular ichki xotira (PSRAM) uchun band.

Qurilmalar kelgan kuni board va modullarning rasmini yuboring, shu bo'yicha birinchi kodni (mikrofon → WAV → noutbuk) yozaman.
