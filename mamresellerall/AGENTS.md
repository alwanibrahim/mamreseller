# AGENTS.md — mamresellerall

Platform jualan (React + shadcn) yang memanggil 4 konektor API. Baca dulu `../response.md` — kontrak response standar semua konektor (`{ success, data, error, meta }`).

## Stack

- Bun (jangan npm/node/vite) — `bun install`, `bun --hot src/index.ts`, `bun test`
- React 19 + Tailwind v4 + shadcn/ui style `new-york` (`components.json`)
- Tanpa RSC, tanpa express. Icon: `lucide-react`

## Aturan Wajib

1. **Gunakan komponen yang sudah ada dulu.** Cek `src/components/ui/` sebelum bikin apa pun. Jangan bikin komponen sendiri kalau sudah tersedia.
2. **Kalau tidak ada → tambah via MCP shadcn** (`shadcn_search_items_in_registries` → `shadcn_view_items_in_registries` / add). Jangan tulis komponen ui manual, jangan copy-paste dari internet.
   - Komponen ui hasil add berada di `src/components/ui/` — **jangan pernah edit file di situ** secara manual.
3. **Feature-based folder structure.** Kode fitur dikelompokkan per fitur, bukan per tipe file:

```
src/
  features/
    supplier/          # /dashboard/admin/supplier
      api.ts           # fetch ke konektor
      components/      # SupplierTable, AddSupplierDialog, ...
      hooks/           # useSuppliers, ...
    products/          # /dashboard/admin/product
    balance/           # /dashboard/admin/balance
    orders/            # /dashboard/admin/order-reseller
  components/ui/       # shadcn (jangan diedit)
  lib/                 # utils, api client bersama
```

4. **Desain se-adanya shadcn.** Default style, default warna, default spacing. Tidak buat custom theme, tidak utak-atik CSS global. Layout dashboard cukup `Card` + `Table` + `Badge` bawaan.
5. **Prioritas fitur (urutan pengerjaan):**

| Route | Fitur |
|---|---|
| `/dashboard/admin/supplier` | Tabel supplier. Tombol **Add Supplier** → dialog minta **nama, baseUrl, apiKey** saja |
| `/dashboard/admin/product` | Semua produk gabungan dari semua supplier aktif |
| `/dashboard/admin/balance` | Balance semua api reseller |
| `/dashboard/admin/order-reseller` | Order history dari semua api reseller |

## Kontrak Konektor

- Envelope tiap response: `{ success, data, error, meta }` — `meta.supplier` = sumber data.
- Auth: `Authorization: Bearer <cnk_live_...>` (key dari `POST /keys` konektor dengan `MASTER_KEY`).
- Endpoint yang dipakai UI: `GET /products`, `GET /balance`, `GET /orders`, `POST /orders`, `GET /ping`.
- Konektor lokal: `localhost:3001` (qamify), `3002` (excalibur), `3003` (warzone), `3004` (vexoran).

## Konvensi

- Satu fitur = satu folder di `src/features/`. Komponen lain tidak boleh mengimpor dari folder fitur lain kecuali lewat `api.ts` / `hooks/` yang diekspor.
- Error handling: tampilkan `error.message` dari envelope via `Card` + teks merah; jangan `alert()`.
- Loading: pakai `Skeleton` shadcn (add dulu kalau belum ada).
- Format uang: ikut `meta.currency` (USD), format `Intl.NumberFormat`.
- Jangan tambah dependency baru tanpa cek `package.json` dulu. (Sudah disetujui: `react-router-dom@7` untuk routing.)
