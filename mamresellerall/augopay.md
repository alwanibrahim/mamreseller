# AutoGopay Integration Guide

Dokumen ini adalah spesifikasi lengkap cara integrasi AutoGopay (payment gateway QRIS) ke project lain. Ditulis agar bisa dibaca manusia maupun dipakai AI untuk generate kode integrasi.

Referensi implementasi asli: `mamresellerall/src/index.ts` (pola yang sudah berjalan di production).

---

## 1. Overview

AutoGopay = REST API untuk QRIS payment. Alur umum:

```
[App] → POST /qris/generate  → dapat qr_url + transaction_id
[Buyer] scan QRIS & bayar
[App] → POST /qris/status    → polling status (atau terima webhook)
[AutoGopay] → POST {app}/api/payment/webhook  → notifikasi paid
[App] fulfills order
```

## 2. Konfigurasi

Dua environment variable:

| Variable | Wajib | Default | Keterangan |
|---|---|---|---|
| `AUTOGO_PAY_API_KEY` | Ya | — | API key. Juga dipakai sebagai HMAC secret untuk verifikasi webhook. |
| `AUTOGO_PAY_BASE_URL` | Tidak | `https://v1-gateway.autogopay.site` | Base URL gateway. |

```bash
# .env
AUTOGO_PAY_API_KEY=your-api-key-here
AUTOGO_PAY_BASE_URL=https://v1-gateway.autogopay.site
```

Jika `AUTOGO_PAY_API_KEY` kosong → anggap fitur payment tidak dikonfigurasi → HTTP 503 dari endpoint app, jangan panggil AutoGopay.

## 3. Autentikasi

Semua request ke AutoGopay pakai header:

```
Authorization: Bearer {AUTOGO_PAY_API_KEY}
Accept: application/json
Content-Type: application/json
```

## 4. API Endpoints (AutoGopay)

Semua endpoint di bawah `AUTOGO_PAY_BASE_URL`, semua **POST**, semua JSON.

### 4.1 Generate QRIS

`POST {base}/qris/generate`

Request:

```json
{ "amount": 15000 }
```

- `amount`: integer rupiah (tanpa desimal).

Response sukses (unwrap pakai `data.data || data` — API kadang membungkus di `data`, kadang tidak):

```json
{
  "data": {
    "transaction_id": "AGP-xxx",
    "order_id": "ORD-xxx",
    "checkout_url": "https://...",
    "qr_url": "https://.../qr.png"
  }
}
```

Simpan `transaction_id` (untuk status/cancel/webhook matching), `checkout_url` (redirect user), `qr_url` (tampilkan gambar QR).

### 4.2 Cek Status

`POST {base}/qris/status`

Request:

```json
{ "transaction_id": "AGP-xxx" }
```

Response (unwrap sama, `data.data || data`):

```json
{ "data": { "transaction_status": "settlement" } }
```

Normalisasi status — ambil field pertama yang ada (lowercase semua):

```
data.transaction_status || data.status || transaction_status || status
```

Mapping status:

| Status mentah | Arti |
|---|---|
| `pending` | Belum dibayar |
| `paid`, `settlement`, `success` | **Lunas** → fulfill order |
| `expire` | Kadaluarsa → tandai gagal |

### 4.3 Cancel QRIS

`POST {base}/qris/cancel`

Request:

```json
{ "transaction_id": "AGP-xxx" }
```

Panggil hanya saat transaksi masih `pending`. Error dari AutoGopay boleh diabaikan (`.catch(() => undefined)`) — cancel tetap tandai transaksi gagal di sisi app.

## 5. Webhook (AutoGopay → App)

AutoGopay mengirim notifikasi pembayaran ke endpoint app. Daftarkan URL ini ke dashboard AutoGopay.

### 5.1 Keamanan: verifikasi signature

- Header: `x-signature`
- Isi: **HMAC-SHA256 dari raw request body (hex), keyed dengan `AUTOGO_PAY_API_KEY`**

WAJIB: baca body sebagai raw text dulu, verifikasi signature terhadap raw text, baru parse JSON. Jangan parse dulu lalu re-serialize.

Implementasi Bun/TS:

```ts
const hmacMatches = (payload: string, signature: string, secret: string) => {
  const expected = new Bun.CryptoHasher("sha256", secret)
    .update(payload)
    .digest("hex");
  const actual = new TextEncoder().encode(signature);
  const wanted = new TextEncoder().encode(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
};
```

(Package Node: `import { timingSafeEqual } from "node:crypto"`.)

Signature tidak cocok atau API key kosong → **401**, jangan proses body.

### 5.2 Payload

```json
{
  "transaction": {
    "transaction_id": "AGP-xxx",
    "status": "paid",
    "order_id": "ORD-xxx"
  }
}
```

Handler harus:

1. Verifikasi signature (5.1).
2. Cari transaksi app berdasarkan `body.transaction.transaction_id` (nilai yang disimpan saat generate).
3. Jika `status` ∈ `{paid, settlement, success}` dan transaksi masih `pending` → tandai lunas + fulfill.
4. Idempotent: transaksi yang sudah bukan `pending` diabaikan (webhook bisa double-fire).
5. Selalu balas `200 { "success": true }` jika signature valid, walaupun transaksi tidak ditemukan.

```ts
app.post("/api/payment/webhook", async (req) => {
  const raw = await req.text();
  const signature = req.headers.get("x-signature") || "";
  if (!apiKey() || !hmacMatches(raw, signature, apiKey()))
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  const body = JSON.parse(raw);
  // ... cari transaksi by transaction_id, fulfill jika paid & masih pending
  return Response.json({ success: true });
});
```

## 6. Pola Integrasi di Sisi App

Dokumen implementasi `mamresellerall` yang perlu ditiru project lain:

### 6.1 Simpan field payment di transaksi

```
transactionId       (id internal app)
orderId             (order id internal app)
paymentTransactionId (dari AutoGopay generate)
paymentOrderId      (dari AutoGopay generate)
checkoutUrl         (dari AutoGopay generate)
qrUrl               (dari AutoGopay generate)
status              pending | success | failed
createdAt, updatedAt
```

### 6.2 Expiry 10 menit

Transaksi `pending` yang umurnya ≥ 10 menit sejak `createdAt` → auto-expire di sisi app (tanpa panggil AutoGopay): set `status: "failed"`, `error: "Payment expired after 10 minutes"`, balas `paymentStatus: "expire"`.

### 6.3 Endpoint app yang disarankan

| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/payment/qris` | Buat transaksi + panggil `/qris/generate` |
| GET | `/api/payment/:id/status` | Cek status (validasi expiry dulu, lalu polling AutoGopay) |
| POST | `/api/payment/:id/cancel` | Cancel (hanya jika masih pending) |
| POST | `/api/payment/webhook` | Terima notifikasi AutoGopay |

Pada endpoint app ini, `:id` boleh cocok dengan `transaction.id`, `orderId`, atau `mamselOrderId` internal — cari dengan fallback tersebut.

### 6.4 Error handling

- `AUTOGO_PAY_API_KEY` kosong → **503** `{ error: "AutoGopay is not configured" }`.
- Request ke AutoGopay gagal (network/HTTP error) → **502**, log raw response (`console.error` status + body, slice 2000 char) untuk debugging.
- Response AutoGopay bisa non-JSON → parse dalam try/catch, fallback `{ raw: text }`.
- Polling status gagal → jangan error ke user, balas `paymentStatus: "pending"` (frontend akan polling lagi).
- Fulfill hanya terjadi saat status berubah `pending → paid`. Cek `transaction.status === "pending"` sebelum fulfill (idempotency).

### 6.5 Frontend flow

1. POST buat QRIS → tampilkan `qrUrl` (gambar QR) atau redirect ke `checkoutUrl`.
2. Polling `GET /api/payment/:id/status` tiap 3–5 detik sampai status bukan `pending`.
3. Status `paid/settlement/success` → tampilkan sukses / fulfill.
4. Status `expire` atau 10 menit lewat → tampilkan gagal + tombol coba lagi / cancel.

## 7. Checklist Integrasi

- [ ] Set `AUTOGO_PAY_API_KEY` (+ optional `AUTOGO_PAY_BASE_URL`) di env.
- [ ] Helper `autoHeaders()`: Bearer key + Accept + Content-Type JSON.
- [ ] Helper unwrap response: `data.data || data`.
- [ ] Generate: simpan `transaction_id`, `order_id`, `checkout_url`, `qr_url`.
- [ ] Status: normalisasi 4 kemungkinan field, mapping `settlement|paid|success` = lunas.
- [ ] Expiry 10 menit di sisi app.
- [ ] Cancel hanya untuk transaksi pending, error di-silence.
- [ ] Webhook: verifikasi HMAC-SHA256 hex (raw body, key = API key), timing-safe, 401 jika gagal.
- [ ] Webhook: idempotent, selalu 200 setelah signature valid.
- [ ] Log raw response AutoGopay untuk debugging.
- [ ] 503 jika unconfigured, 502 jika upstream gagal.

## 8. Prompt Siap Pakai untuk AI (Generate Kode Integrasi)

Copy prompt ini ke AI di project lain, sudah self-contained:

```
Integrasikan AutoGopay (QRIS payment gateway) ke project ini.

Konfigurasi:
- Env: AUTOGO_PAY_API_KEY (wajib), AUTOGO_PAY_BASE_URL (default https://v1-gateway.autogopay.site)
- API key kosong = fitur off, endpoint app balas 503.

Semua endpoint AutoGopay: POST JSON, header:
Authorization: Bearer {key}, Accept: application/json, Content-Type: application/json

1. POST {base}/qris/generate  body {"amount": <rupiah integer>}
   → unwrap "data.data || data" → simpan transaction_id, order_id, checkout_url, qr_url.
2. POST {base}/qris/status    body {"transaction_id": "..."}
   → unwrap sama → status = (data.transaction_status || data.status || root.transaction_status || root.status).toLowerCase()
   → "settlement"|"paid"|"success" = LUNAS, "expire" = kadaluarsa, lainnya pending.
3. POST {base}/qris/cancel    body {"transaction_id": "..."} — hanya untuk transaksi pending; error diabaikan.

Webhook (didaftarkan di dashboard AutoGopay):
- POST /api/payment/webhook, header x-signature = HMAC-SHA256 hex dari RAW request body, key = AUTOGO_PAY_API_KEY.
- WAJIB verifikasi terhadap raw body (baca req.text() dulu) pakai timing-safe compare. Gagal → 401.
- Payload: {"transaction": {"transaction_id": "...", "status": "paid", "order_id": "..."}}
- Jika status paid/settlement/success DAN transaksi masih pending → fulfill order (idempotent).
- Setelah signature valid selalu balas 200 {"success": true}.

Pola app:
- Buat endpoint: POST /api/payment/qris (buat transaksi + generate), GET /api/payment/:id/status (cek expiry 10 menit dulu, lalu polling), POST /api/payment/:id/cancel.
- Transaksi pending > 10 menit sejak createdAt → auto-expire: status failed, paymentStatus "expire".
- Simpan di transaksi: paymentTransactionId, paymentOrderId, checkoutUrl, qrUrl.
- Error upstream → 502 + log raw response (status + body, max 2000 char). Polling gagal → balas pending, jangan error.
- Fulfill hanya sekali: cek status masih "pending" sebelum tandai lunas.
- Response AutoGopay bisa non-JSON: parse dalam try/catch, fallback {raw: text}.
```

---

Versi dokumen: 1.0 (2026-09-11). Sumber: integrasi live di `mamresellerall/src/index.ts`.
