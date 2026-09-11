# Konektor Response Standard — `response.md`

Kontrak wajib untuk **semua 4 project konektor** (mamqamify, mamexcalibur, mamwarzone, mamvexoran). Apapun upstream-nya, response keluaran harus identik bentuknya. Project lain tidak boleh meniru format sendiri.

---

## 1. Response Envelope

**Semua** response — sukses maupun error — memakai satu bentuk:

```json
{
  "success": true,
  "data": { },
  "error": null,
  "meta": {
    "supplier": "qamify",
    "currency": "USD",
    "timestamp": "2026-09-11T08:30:00Z"
  }
}
```

Error:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "out_of_stock",
    "message": "Only 3 units available, requested 10",
    "upstream_status": 400
  },
  "meta": { "supplier": "warzone", "currency": "USD", "timestamp": "2026-09-11T08:30:00Z" }
}
```

Aturan:

- `success` — boolean, selalu ada.
- `data` — isi sesuai endpoint, `null` saat error.
- `error` — `null` saat sukses. Saat error: `code` (dari tabel §4), `message` (human readable), `upstream_status` (HTTP status asli supplier, `null` kalau error dibuat konektor sendiri).
- `meta` — selalu ada. `supplier` = slug env, `currency` = `CURRENCY` env, `timestamp` = ISO8601 UTC saat response dibuat.
- HTTP status mengikuti kelas error (400/401/402/404/409/429/500/502), tapi **bentuk body tetap sama persis**.

---

## 2. Endpoint Konektor

Semua project mengimplementasikan endpoint yang sama, path yang sama, method yang sama. Port dari env `PORT` (3001–3004).

### Public — auth `Authorization: Bearer <KONEKTOR_API_KEY>`

| Method | Path | Fungsi |
|---|---|---|
| GET | `/ping` | Cek API key + status supplier. Tetap jawab walau supplier down (`data.status: "up" \| "down"`) |
| GET | `/products` | Daftar produk normalisasi |
| GET | `/products/:id` | Satu produk (supplier tanpa endpoint single → filter dari list) |
| GET | `/balance` | Saldo wallet supplier |
| POST | `/orders` | Buat order |
| GET | `/orders` | Daftar order (`?limit=` `?offset=`) |
| GET | `/orders/:id` | Satu order by id |

### Admin — auth `Authorization: Bearer <MASTER_KEY>` (env)

| Method | Path | Fungsi |
|---|---|---|
| POST | `/keys` | Generate API key konektor. Body `{ "name": "toko-a", "limit": 100 }` (`limit` opsional) |
| GET | `/keys` | Daftar key (key di-mask) |
| DELETE | `/keys/:id` | Cabut key |

---

## 3. Tipe Data Standar

### Product

```json
{
  "id": "S_01",
  "name": "Gemini Pro 1 Month",
  "description": "string atau null",
  "price": 0.5,
  "stock": 4552,
  "orderable": true
}
```

### Order

```json
{
  "order_id": "ORD-04621-9a84",
  "product_id": "S_01",
  "product_name": "Gemini Pro 1 Month",
  "quantity": 2,
  "amount": 1.2,
  "status": "delivered",
  "items": ["CODE_1", "CODE_2"],
  "created_at": "2026-08-20T14:02:11Z"
}
```

- `status` enum: `"delivered" | "processing" | "cancelled" | "failed"`.
- `items` — array string hasil pengiriman (kode/link). Selalu array, kosong `[]` jika belum ada.
- `created_at` — ISO8601 UTC. Supplier pakai format lain (IST `YYYY-MM-DD HH:MM:SS`, dsb) → dikonversi.
- `amount` — total (bukan unit price).

### Balance

```json
{
  "balance": 250,
  "currency": "USD"
}
```

### Order List

```json
{
  "orders": [ ],
  "limit": 50,
  "offset": 0,
  "total": 137
}
```

`total` boleh `null` jika supplier tidak memberi total. Pagination standar konektor: `limit` (default 50, max 200) + `offset` (default 0) — supplier berbasis `page` dikonversi konektor: `offset = (page-1) * limit`, `page = offset/limit + 1`.

### API Key (admin)

```json
{
  "id": "key_01HXYZ",
  "name": "toko-a",
  "key": "cnk_live_xxxxxxxx",
  "limit": 100,
  "active": true,
  "created_at": "2026-09-11T08:30:00Z"
}
```

`GET /keys` mengembalikan `key` ter-mask (`cnk_live_xxx…xxx`), full key hanya sekali di response `POST /keys`.

---

## 4. Normalisasi Error

| `error.code` | HTTP | Dipakai saat |
|---|---|---|
| `bad_request` | 400 | Body/param tidak valid (konektor) |
| `unauthorized` | 401 | Key konektor tidak valid / hilang |
| `forbidden` | 403 | Supplier suspend / key admin salah |
| `not_found` | 404 | Produk/order tidak ada |
| `insufficient_balance` | 402 | Saldo supplier kurang |
| `out_of_stock` | 409 | Stok kurang |
| `rate_limited` | 429 | Dibatasi konektor atau supplier |
| `internal_error` | 500 | Bug konektor |
| `upstream_error` | 502 | Supplier down/error tak terklasifikasi |

---

## 5. Mapping Supplier → Standar

### Status order

| Supplier | Upstream | Standar |
|---|---|---|
| qamify | `success: true` / `false` | `delivered` / `failed` |
| qamify | `status` string | passthrough (mapping sesuai enum) |
| excalibur | `status: "success"` | `delivered` |
| warzone | `status: "success"` | `delivered` |
| vexoran | `status: "delivered"` | `delivered` |
| vexoran | `status: "cancelled"` | `cancelled` |
| *semua* | selain itu | `processing` |

### Product

| Field | qamify | excalibur / warzone | vexoran |
|---|---|---|---|
| `id` | `id` | `service_id` | `id` |
| `name` | `name` | `name` | `name` |
| `price` | `unit_price` | `price` | `price` |
| `stock` | `stock` | `stock` | `stock` (`null` = service → `-1` unknown, `orderable` tetap dari flag) |
| `orderable` | `stock > 0` | `stock > 0` (warzone: field `orderable`) | `api_orderable && available` |
| `description` | `description` | — | `description_text` |

### Order

| Field | qamify | excalibur / warzone | vexoran |
|---|---|---|---|
| `order_id` | `order_code` | `order_id` | `order_id` |
| `product_id` | `product_id` | `service_id` | `product_id` (list: dari `product` nama → simpan mapping di order) |
| `quantity` | `qty` | `quantity` | `quantity` |
| `amount` | `total` | `total_cost` / `amount` | `amount` |
| `items` | `products` | `products` / `delivered_products` | `data` (split per baris) |
| `created_at` | `created_at` | `created_at` | `created_at` |

### Idempotency (POST /orders)

Standar konektor: header `Idempotency-Key` **opsional**. Konektor menerjemahkan:

| Supplier | Diteruskan sebagai |
|---|---|
| qamify | header `Idempotency-Key` + body `idempotency_key` |
| vexoran | body `external_order_id` |
| excalibur / warzone | tidak didukung supplier → konektor simpan sendiri (SQLite `bun:sqlite`): jika key sama dan order sukses, kembalikan order lama tanpa order ulang |

Jika klien tidak mengirim header, konektor generate `cnk-<ulid>`.

### Auth upstream

Dibaca dari env: `SUPPLIER_AUTH_HEADER` + `SUPPLIER_AUTH_PREFIX` (lihat `.env.example` tiap project).

---

## 6. Contoh End-to-End

`POST /orders` sukses:

```json
{
  "success": true,
  "data": {
    "order": {
      "order_id": "VX-8F3A2C",
      "product_id": "3f9a1c02-7e64-4b8a-9d21-8c5b0e2a4f10",
      "product_name": "Netflix Premium — 1 Month",
      "quantity": 1,
      "amount": 5,
      "status": "delivered",
      "items": ["nf.demo88@vexoran.mail : S4ndb0x-Demo"],
      "created_at": "2026-09-11T08:30:00Z"
    }
  },
  "error": null,
  "meta": { "supplier": "vexoran", "currency": "USD", "timestamp": "2026-09-11T08:30:00Z" }
}
```

`GET /products`:

```json
{
  "success": true,
  "data": {
    "products": [
      { "id": "S_01", "name": "Gemini Pro 1 Month", "description": null, "price": 0.5, "stock": 4552, "orderable": true }
    ]
  },
  "error": null,
  "meta": { "supplier": "warzone", "currency": "USD", "timestamp": "2026-09-11T08:30:00Z" }
}
```

---

## 7. Aturan Implementasi

1. Bun saja (`Bun.serve`, `bun:sqlite`), tanpa express/orm.
2. `index.ts` per project — satu file cukup; pecah hanya jika >300 baris.
3. Semua output lolos satu fungsi `ok(data)` / `fail(code, message, upstream_status)` — tidak ada response manual di handler.
4. Upstream call via `fetch`, header auth dari env, timeout 15s.
5. API key konektor disimpan hash (SHA-256) di SQLite; prefix `cnk_live_`.
6. File spesifikasi ini adalah sumber kebenaran — kalau ada perbedaan kode vs dokumen, dokumen yang diubah dulu.
