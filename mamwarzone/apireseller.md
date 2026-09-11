# API Reseller — Warzone

Inventory, priced and delivered, over HTTP. REST · JSON · Key auth.

## Base URL

```
https://api.warzoneshop.in
```

## Authentication

API Key is created on first tap of *API Key* in the bot main menu. *Revoke API Key* (same panel) kills it instantly and permanently. A new key reads the same account — balance, history, and old-key orders unchanged.

```
X-API-Key: WAR_example
```

The key can spend the balance — treat it like a password. It reaches nobody else's wallet, stock, or orders. Top up in Telegram, spend anywhere.

## Rate Limits

- **3 requests per second per key**, and the same per IP address before the key is even read.
- Bursts are not queued. Every failure returns the same shape: `{"error": "..."}`.

## Errors

| Code | Meaning | What to do |
|---|---|---|
| 400 | Bad parameters, out of stock, or insufficient balance | Read error; do not retry blindly |
| 401 | Key missing or unknown | Check the header |
| 403 | Key revoked | Issue a new one in the bot |
| 404 | No such order or endpoint | Check the id |
| 405 | Wrong method for that path | Check the verb; the path exists |
| 413 | Body larger than 64 KB | Send only `service_id` and `quantity` |
| 429 | Rate limited | Back off, then retry |
| 500 | Internal error — already logged on their side | Safe to retry on GET. On `POST /order`, check `GET /orders` first — the order may exist |
| 503 | At capacity, shop in maintenance, or service stopped selling | Safe to retry — nothing was charged |

An order either completes or changes nothing. A 400 never debits the balance and never consumes stock. On `POST /order`, retry only 503 and 429 — neither reached the purchase path; for 429 wait out the `Retry-After` header.

## Reads — five endpoints, none can change anything

### GET /api/v1/me

```bash
curl "$BASE/api/v1/me" -H "X-API-Key: $KEY"
```

**200 OK**

```json
{
  "chat_id": 1000000000,
  "first_name": "Alex",
  "wallet_balance": 42.75
}
```

**401**

```json
{
  "error": "Missing X-API-Key header"
}
```

### GET /api/v1/products

Stock moves constantly — read before ordering.

```bash
curl "$BASE/api/v1/products" -H "X-API-Key: $KEY"
```

**200 OK**

```json
{
  "services": [
    {
      "service_id": "S_01",
      "name": "Gemini AI Pro 18Months - 15hour Hold warranty",
      "price": 0.50,
      "stock": 4552,
      "in_stock": true,
      "pricing": "tiered",
      "orderable": true,
      "price_tiers": [
        { "min_qty": 1,  "max_qty": 10,    "unit_price": 0.50 },
        { "min_qty": 11, "max_qty": 49,    "unit_price": 0.45 },
        { "min_qty": 50, "max_qty": 10000, "unit_price": 0.40 }
      ]
    }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `service_id` | string | The id to order with. Stable; store it. |
| `name` | string | Display name, plain text |
| `price` | number \| null | Unit price at quantity 1. `null` when pricing is `"unavailable"`. |
| `stock` | number | Units available right now |
| `in_stock` | boolean | `false` when selling is paused for this service |
| `pricing` | string | `"tiered"`, `"custom"` or `"unavailable"` |
| `price_tiers` | array \| null | `null` on a negotiated flat rate |
| `orderable` | boolean | Gate the buy on this one. `true` only when priced, selling, and has stock. |

- `pricing` is the regime the key is on; under `"tiered"` a bulk total can be lower than `price × quantity`.
- **Negotiated flat rate:** pricing is `"custom"` and `price_tiers` is `null`. One price at every quantity: `total = price × quantity` exactly.
- **Third state:** pricing `"unavailable"`, price `null`, `price_tiers` `[]`, `orderable` `false`. `POST /order` answers 400 "No pricing tier configured for this quantity". Handle `price === null`.

### GET /api/v1/orders

Whole account history — Telegram and API orders in one list, newest first, with delivered links to re-fetch. Paginated with `page` and `limit` (optional); `total_pages` in the reply tells the count.

- Out-of-range value is an error, not a ceiling: `limit=500` returns `400 limit must be between 1 and 200`.
- Listed orders omit `unit_price`; compute `amount / quantity`.
- `created_at` is IST (UTC+05:30) as `YYYY-MM-DD HH:MM:SS` — parse as `Asia/Kolkata`, not UTC.
- Two totals, deliberately: `total_orders` counts every order row (that is what `total_pages` divides); `counts.paid` is the one that cost money (success + undelivered).

| Query | Type | Notes |
|---|---|---|
| `page` | number | optional, defaults to 1 |
| `limit` | number | optional, defaults to 50. Max 200 — larger returns 400, not silently reduced |

```bash
curl "$BASE/api/v1/orders?page=1&limit=50" -H "X-API-Key: $KEY"
```

**200 OK**

```json
{
  "success": true,
  "page": 1,
  "limit": 50,
  "total_orders": 137,
  "total_pages": 3,
  "orders": [
    {
      "order_id": "ORD-04621-9a84",
      "service_id": "S_01",
      "service": "Gemini AI Pro 18Months - 15hour Hold warranty",
      "quantity": 11,
      "amount": 6.05,
      "status": "success",
      "created_at": "2026-08-20 14:02:11",
      "delivered_products": ["https://…"]
    }
  ]
}
```

### GET /api/v1/order/{id}

Any order on the account — Telegram or API. Other people's return 404, same as one that does not exist.

Order ids are `ORD-<5 digits>-<4 hex>`; the delivery message omits the `ORD-` prefix — so `04621-9a84` reaches the same order. Either form, either case. A bare sequence number matching two of your orders returns 404 asking for the full id.

```bash
curl "$BASE/api/v1/order/ORD-04621-9a84" -H "X-API-Key: $KEY"
```

**200 OK**

```json
{
  "success": true,
  "order": {
    "order_id": "ORD-04621-9a84",
    "service_id": "S_01",
    "service": "Gemini AI Pro 18Months - 15hour Hold warranty",
    "quantity": 11,
    "amount": 6.05,
    "status": "success",
    "created_at": "2026-08-20 14:02:11",
    "delivered_products": ["https://…"]
  }
}
```

**404**

```json
{
  "error": "No such order"
}
```

### GET /api/v1/stats

Account totals plus per-service breakdown. Telegram and API purchases count together. Lifetime only — no date range or time bucketing. Per day: page `/orders`, group by `created_at`.

```bash
curl "$BASE/api/v1/stats" -H "X-API-Key: $KEY"
```

**200 OK**

```json
{
  "success": true,
  "wallet_balance": 42.75,
  "total_orders": 137,
  "total_spent": 391.05,
  "products_breakdown": [
    {
      "service_id": "S_01",
      "name": "Gemini AI Pro 18Months - 15hour Hold warranty",
      "quantity_sold": 318,
      "revenue": 174.90
    }
  ]
}
```

## Spends — one endpoint, moves real money

### POST /api/v1/order

Buys immediately, returning activation links inline. Store `products` on receipt — and if the response is lost, re-fetch from `GET /order/{order_id}`.

| Field | Type | Notes |
|---|---|---|
| `service_id` | string | required — from `/products`, e.g. `S_01` |
| `quantity` | number | required — whole number, 1 to 10000 |

```bash
curl -X POST "$BASE/api/v1/order" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"service_id":"S_01","quantity":2}'
```

**200 OK**

```json
{
  "success": true,
  "order_id": "ORD-04621-9a84",
  "service_id": "S_01",
  "quantity": 2,
  "unit_price": 0.50,
  "total_cost": 1.20,
  "new_balance": 41.55,
  "products": [
    "https://serviceactivation.google.com/subscription/new/AQC1x…",
    "https://serviceactivation.google.com/subscription/new/AQC2y…"
  ]
}
```

**400 · not enough stock**

```json
{
  "error": "Only 3 accounts available. Requested 10."
}
```

**400 · wallet short**

```json
{
  "error": "Insufficient Wallet Balance! You need $6.05 but have $2.10."
}
```
