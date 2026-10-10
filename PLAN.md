# PLAN: Pengembangan Web Latihan UTS Kecerdasan Buatan (Mobile-First)

Dokumen ini mendokumentasikan hasil audit sistem saat ini, arsitektur modul baru, skema data terpusat, dan rencana tahapan pengembangan web latihan UTS Kecerdasan Buatan (KOM321) agar menjadi aplikasi belajar lengkap, modular, dan ramah seluler.

---

## 1. Audit Kode Eksisting

- **`index.html`**:
  - Menyediakan container `<main>`, header dengan sticker "UTS", nav `#tabs`, filter `#chips`, container `#app`, dan tombol reset progres hafalan `#rsall`.
  - Memuat Google Fonts (*Plus Jakarta Sans*, *Knewave*, *Anton*) dan stylesheet `css/style.css`.
  - Memuat skrip `js/data.js` dan `js/app.js`.

- **`js/data.js`**:
  - `C`: 60 ringkasan & kartu [bab, judul, penjelasan].
  - `B`: 70 soal Benar/Salah [bab, pernyataan, boolean_jawaban, penjelasan].
  - `F`: 70 soal Isian [bab, soal, keyword_slash_separated, jawaban_display].
  - `M`: 21 set Cocokkan [bab, judul, opsi_array, pairs_array].
  - `E`: 21 soal Esai komprehensif [bab, soal, pembahasan_html].

- **`js/app.js`**:
  - Variabel global: `mode`, `ch`, `known`, `st`, `deck`, `i`, `flip`, `search`.
  - Akses `localStorage` terfragmentasi (`ai_mode`, `ai_ch`, `ai_known`, `ai_esai3`, `ai_esai`).
  - Fitur yang sudah berjalan:
    - Tab: Ringkasan (`rg`), Kartu (`fc`), Benar/Salah (`bs`), Cocokkan (`mt`), Isian (`fi`), Esai (`es`).
    - Filter chip per bab (Semua, Bab 1–7).
    - Skor kuis Benar/Salah, Cocokkan, Isian via `flow()`.

- **`css/style.css`**:
  - Palet warna:
    - Hot Magenta: `#D4249F` (`--mag`)
    - Grape Purple: `#8E2A9C` (`--gp`)
    - Sunshine Yellow: `#FFC530` (`--yel`)
    - Sky Cyan: `#22B8F0` (`--cy`)
    - Plum Night: `#4A1F55` (`--plum`)
    - Paper White: `#fff` (`--wh`)
    - Accent Orange: `#E8742A` (`--org`)
  - Typography:
    - *Plus Jakarta Sans* (bacaan & UI umum)
    - *Knewave* (judul utama)
    - *Anton* (angka statistik besar)
  - Desain adaptif: panel radius 40px (desktop) / 28px (mobile), touch targets ≥ 44px, styling accordion `<details>/<summary>`.

---

## 2. Struktur Modul Baru

```
BelajarAI/
├── index.html            # Entry point aplikasi
├── PLAN.md               # Dokumentasi arsitektur dan tahapan
├── css/
│   └── style.css         # Design system, tata letak, komponen dashboard & accordion
└── js/
    ├── data.js           # Bank soal mentah (C, B, F, M, E) + utilitas generator stable ID
    ├── storage.js        # Modul penyimpanan terpusat (ai_v2), migrasi, export/import
    └── app.js            # UI controller, routing, render dashboard & mode latihan
```

---

## 3. Skema Data Terpusat (`ai_v2`)

Seluruh state persisten disimpan dalam satu key `localStorage`: `ai_v2` (dengan fallback in-memory jika private mode / kuota storage penuh):

```json
{
  "version": 2,
  "settings": {
    "dailyGoal": 20,
    "pomodoro": {
      "focusMin": 25,
      "shortBreakMin": 5,
      "longBreakMin": 15
    },
    "sound": {
      "type": "none",
      "volume": 0.25
    }
  },
  "ui": {
    "mode": "home",
    "ch": 0
  },
  "bookmarks": ["id_soal_1", "id_soal_2"],
  "history": [
    {
      "id": "b_1a2b3c",
      "kategori": "bs",
      "bab": 1,
      "benar": true,
      "waktu": 1728520000000
    }
  ],
  "wrongReview": {
    "b_1a2b3c": {
      "consecutiveCorrect": 0,
      "lastWrongTime": 1728520000000
    }
  },
  "leitner": {
    "c_judul_kartu": {
      "box": 1,
      "due": 1728520000000
    }
  },
  "essays": ["e_soal_hash_1"],
  "simulations": [
    {
      "waktu": 1728520000000,
      "durasiDetik": 1800,
      "skorTotal": 85,
      "skorKategori": { "bs": 80, "mt": 100, "fi": 75 },
      "skorBab": { "1": 100, "2": 80 },
      "totalSoal": 20
    }
  ],
  "streak": {
    "lastDate": "2026-10-10",
    "count": 1
  }
}
```

### Strategi Migrasi dari Kunci Lama (`ai_*`):
- `ai_mode`: diambil dan dipetakan ke `ui.mode` (default: `'home'`).
- `ai_ch`: disimpan ke `ui.ch`.
- `ai_known`: array judul kartu yang dihafal dimigrasikan ke `leitner` dengan `box: 3` (interval 1 hari).
- `ai_esai3` (dan `ai_esai`): indeks esai lama dipetakan ke ID stabil esai baru pada `essays`.
- Data lama tetap dibersihkan/dihormati secara transparan tanpa menghilangkan pencapaian pengguna.

---

## 4. Algoritma ID Stabil (Hash djb2)

Setiap item (soal atau kartu) diberi ID stabil string alfanumerik pendek:
```javascript
function hashId(category, text) {
  const str = category + ':' + text.trim().toLowerCase();
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return category + '_' + Math.abs(hash).toString(36);
}
```
Contoh: `bs_k7x9a`, `mt_p3q1z`, `fi_m8w2d`, `fc_r4t6y`, `es_v9b2c`.

---

## 5. Rencana Pelaksanaan Bertahap

- **Fase 0 (Selesai)**: Audit dan penyusunan `PLAN.md`.
- **Fase 1 (Selesai)**: Fondasi Data (`storage.js`, namespace `ai_v2`, stable ID djb2, migrasi otomatis, log 2000 riwayat).
- **Fase 2 (Selesai)**: Dashboard Beranda & Bank Soal Salah (Progres 7 Bab, Bab terlemah, Target harian, grafik 7 hari, Bookmark).
- **Fase 3 (Selesai)**: Sistem Leitner 5 Kotak pada Kartu (`fc`).
- **Fase 4 (Selesai)**: Simulasi Ujian UTS (Tab Simulasi, timer countdown akurat, 20 soal campuran, grid navigasi 1-20, ragu-ragu, resume state, analisis hasil).
- **Fase 5 (Selesai)**: Navigasi Mobile-First & Hash Routing (`#home`, `#sim`, `#wrong`, dll).
- **Fase 6 (Selesai)**: Pomodoro Timer & Background Ambient Sound (Web Audio murni, floating bubble).
- **Fase 7 (Selesai)**: PWA Offline (`manifest.json`, `sw.js` service worker) & Vercel Config (`vercel.json`).
- **Fase 8 (Selesai)**: Ekspor/Impor JSON Progres, Toleransi Ejaan Levenshtein untuk Isian, Polish & Finalization.

---

## 6. Asumsi dan Keputusan Desain
1. **ES Modules vs Global Script**: Menggunakan skrip modular bersih dengan objek singleton namespace yang dapat dijalankan secara konsisten baik via HTTP server maupun file lokal tanpa konfigurasi build rumit.
2. **Kalkulasi Streak**: Dihitung berdasarkan tanggal kalender lokal (format `YYYY-MM-DD`). Jika aktivitas terakhir adalah kemarin, streak bertambah 1; jika hari ini, streak tetap; jika lebih dari 1 hari yang lalu, reset ke 1.
3. **Penyimpanan Cocokkan**: Soal cocokkan dicatat sebagai satu set latihan dengan bobot skor `benar / total` dan pencatatan per pasang untuk analisis kesalahan konsep.
