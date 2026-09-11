# API Reseller — Vexoran

One key, six actions: browse products and stock, check balance, place and list orders, and manage webhooks.

- **6** endpoints · **60** req/min · **99.9%** uptime

## Overview

The Reseller API is a single REST endpoint. Select an action with the `?action=` query parameter and authenticate with the API key as a bearer token. All responses are JSON and are never cached.

| Action | Method | Purpose |
|---|---|---|
| `products` | GET | Active products with effective pricing, promotions, bulk tiers and stock |
| `stock` | GET | Stock and effective price for one product at a specific quantity |
| `balance` | GET | Current reseller wallet balance |
| `orders` | GET | History of orders placed with this API key (offset pagination) |
| `order` | POST | Create an order. Idempotent via `external_order_id` — retries never double-charge |
| `webhooks` | GET | Registered webhook endpoints (secret masked) |

GET actions are side-effect-free for data — no orders, stock, balance or deliveries change. (Every authenticated request, GET included, records one usage-log row and consumes one unit of the rate limit.)

## Base URL

```
https://api.vexoran.app
```

## Authentication

Every request is authenticated with the API key as a bearer token. Generate or rotate the key in the Telegram bot under **Profile → API Key**. Keep it server-side.

| Header | Value |
|---|---|
| `Authorization` | `Bearer <API_KEY>` — the primary, documented form |
| `x-api-key` | `<API_KEY>` — accepted only as a fallback when Authorization is empty |
| `Content-Type` | `application/json` on POST requests |

> Keys issued by the bot start with `vex_sk_` (71 characters). Keys issued by the rotate endpoint start with `vxr_` (68 characters). Both are accepted — the API matches the key by hash and does not care about the prefix. If a key leaks, rotate it in the bot immediately; the old one stops working at once.

## Errors & Limits

### Rate limit

**60 requests per 60 seconds, per API key, sliding window.** Every request (GET and POST) counts. Read the budget from the response headers:

| Header | Meaning |
|---|---|
| `X-RateLimit-Limit` | The ceiling (60) |
| `X-RateLimit-Remaining` | Requests left in the current window |

On 429 the body is `{ error, limit, window_seconds, used }`. Back off until Remaining recovers — a fixed pause of a second or two, then retry; never hammer in a tight loop.

### Order safety guarantee

A failed order is never net-charged. Balance is only debited after the stock and balance pre-checks pass. If anything downstream fails, the debit is reversed by a keyed, idempotent compensation refund and the order is cancelled.

- **Idempotent retries.** Always send a stable `external_order_id`. A retry with the same value returns the original order (`idempotent_replay: true`) — never a second charge and never a second delivery. Without it, a retried-but-already-successful request places a new order.
- `refund: "processing"` means the reversal is queued and will land shortly (guaranteed retry with backoff) — the money is not lost. `refund: "refunded"` means it is already back.
- **Pre-checks don't charge.** 402 Insufficient balance and 409 Insufficient stock happen before any debit — nothing is taken.

### Common errors

| Status | error | Meaning | What to do |
|---|---|---|---|
| 401 | `Missing API key` | No Authorization / x-api-key header | Send `Authorization: Bearer <key>` |
| 401 | `Invalid or revoked API key` | Unknown, revoked, or inactive key (or shorter than 8 chars) | Generate a fresh key in the bot |
| 403 | `Reseller access disabled` | Account is not a reseller, or is suspended | Contact support in the bot |
| 429 | `Rate limit exceeded` | More than 60 requests in 60s for this key | Back off; read `X-RateLimit-Remaining` |
| 503 | `Reseller API temporarily disabled` | Global kill switch is on | Retry later |
| 503 | `Account temporarily disabled` | Per-reseller kill switch is on | Contact support |
| 400 | `Unknown action` | `action` query param missing or unrecognised | Use `products\|stock\|balance\|orders\|order\|webhooks` |
| 500 | `Internal error` | Unhandled server error (includes detail) | Retry; report if it persists |

### Order errors

| Status | error | Meaning | What to do |
|---|---|---|---|
| 400 | `product_id required` | Missing `product_id` in the body | Include `product_id` |
| 404 | `Product not found or inactive` | Unknown or inactive product | Re-list products |
| 400 | `Quantity exceeds per-order limit` | `quantity > 1000` | Split into multiple orders (`max_per_order: 1000`) |
| 400 | `Below / Above order quantity` | Outside the product/account min–max band | Read `min_qty` / `max_qty` in the response |
| 400 | `Manual delivery / Variation / not available via API` | Product can't be sold through the API | Order via the Telegram bot |
| 402 | `Insufficient balance` | Wallet below the total. Not charged | Top up; response returns `balance` + `required` |
| 409 | `Insufficient stock` | Fewer units than requested. Not charged | Lower quantity; response returns `available` |
| 409 | `Stock allocation failed` | 0 units allocated → refunded + cancelled | Retry with the same `external_order_id` |
| 422 | `coupon_min_purchase` | Order below the coupon's minimum | Raise quantity or drop the coupon |
| 502 | `Upstream delivery failed` | External supplier failed → refunded + cancelled | Retry with the same `external_order_id` |

## Endpoints

### GET ?action=products

Active products with effective pricing, promotions, bulk tiers and stock. Effective price is computed at quantity 1 (bulk tiers need qty > 1).

```bash
curl "https://api.vexoran.app?action=products" \
  -H "Authorization: Bearer $KEY"
```

**Response fields**

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | Product id — pass to stock / order |
| `name` | string | Display name |
| `description` / `description_text` / `description_html` | string \| null | Raw, plain-text, and HTML renderings |
| `delivery_instructions` | string \| null | Post-purchase instructions |
| `price` | number | Effective unit price (at qty 1) |
| `base_price` | number | Public base price |
| `custom_price` | boolean | A reseller per-product override is active |
| `discount_source` | enum | `reseller` \| `tier` \| `offer` \| `flash_sale` \| `bulk` \| `base` — which rule won |
| `discount_ends_at` | iso8601 \| null | Expiry of the active promo, if any |
| `offer` / `flash_sale` / `campaign` | object \| null | `{ active, price, ends_at, source? }`. campaign = cheapest active promo |
| `bulk_discount_percent` | number | Effective % when bulk is the active source |
| `bulk_discount_active` | boolean | `== (discount_source === 'bulk')` |
| `bulk_discount_style` | `'percentage' \| 'custom_price' \| null` | Shape of the matched bulk tier |
| `bulk_discount_unit_price` / `bulk_discount_text` | number \| string \| null | Matched tier unit + label |
| `price_locked` | boolean | Override/tier/campaign fixed the unit (blocks bulk stacking) |
| `bulk_discounts` | array | `{ min_qty, unit_price, discount_percent }` — always present |
| `bulk_pricing` / `bulk_pricing_text` | array / string \| null | Formatted tiers (`[]` when `price_locked`) |
| `category` | string | Catalogue category |
| `warranty_type` | `"none" \| "full"` | Warranty tier. Returned on products & stock only |
| `stock` | number \| null | Units available; `null` for service products (`requires_stock` false) |
| `available` | boolean | Service → always true; else `stock > 0` |
| `manual_delivery` | boolean | Manual-delivery products are not API-orderable |
| `requires_stock` | boolean | `false` = service item (no stock tracking) |
| `external_source` | string \| null | Upstream supplier tag |
| `api_orderable` | boolean | `!manual_delivery && external_source !== 'coursera_panel'` |

**200 OK**

```json
{
  "products": [
    {
      "id": "3f9a1c02-7e64-4b8a-9d21-8c5b0e2a4f10",
      "name": "Netflix Premium — 1 Month",
      "description": "4K UHD · shared profile · instant delivery",
      "description_text": "4K UHD · shared profile · instant delivery",
      "description_html": "<p>4K UHD · shared profile · instant delivery</p>",
      "delivery_instructions": "Sign in within 24h and set your own profile PIN.",
      "price": 5,
      "base_price": 5,
      "custom_price": false,
      "discount_source": "base",
      "discount_ends_at": null,
      "offer": null,
      "flash_sale": null,
      "campaign": null,
      "bulk_discount_percent": 0,
      "bulk_discount_active": false,
      "bulk_discount_style": null,
      "bulk_discount_unit_price": null,
      "bulk_discount_text": null,
      "price_locked": false,
      "bulk_discounts": [
        { "min_qty": 10, "unit_price": 4.25, "discount_percent": 15 },
        { "min_qty": 25, "unit_price": 4, "discount_percent": 20 }
      ],
      "bulk_pricing": [
        { "min_qty": 10, "style": "percentage", "discount_percent": 15, "unit_price": 4.25, "text": "Buy 10+ → 15% OFF (4.25 USDT each)" },
        { "min_qty": 25, "style": "percentage", "discount_percent": 20, "unit_price": 4, "text": "Buy 25+ → 20% OFF (4.00 USDT each)" }
      ],
      "bulk_pricing_text": "Buy 10+ → 15% OFF (4.25 USDT each)\nBuy 25+ → 20% OFF (4.00 USDT each)",
      "category": "Streaming",
      "warranty_type": "full",
      "stock": 42,
      "available": true,
      "manual_delivery": false,
      "requires_stock": true,
      "external_source": null,
      "api_orderable": true
    },
    {
      "id": "c9d0e1f2-3a4b-5c6d-7e8f-9a0b1c2d3e4f",
      "name": "ChatGPT Plus — Voucher Code",
      "description": "30-day voucher · redeemable worldwide",
      "description_text": "30-day voucher · redeemable worldwide",
      "description_html": "<p>30-day voucher · redeemable worldwide</p>",
      "delivery_instructions": "Redeem at chatgpt.com within 7 days of purchase.",
      "price": 6.5,
      "base_price": 9,
      "custom_price": false,
      "discount_source": "flash_sale",
      "discount_ends_at": "2026-09-05T12:00:00Z",
      "offer": null,
      "flash_sale": { "active": true, "price": 6.5, "ends_at": "2026-09-05T12:00:00Z", "source": "flash_sales" },
      "campaign": { "active": true, "price": 6.5, "ends_at": "2026-09-05T12:00:00Z", "source": "flash_sale" },
      "bulk_discount_percent": 0,
      "bulk_discount_active": false,
      "bulk_discount_style": null,
      "bulk_discount_unit_price": null,
      "bulk_discount_text": null,
      "price_locked": true,
      "bulk_discounts": [],
      "bulk_pricing": [],
      "bulk_pricing_text": null,
      "category": "AI Tools",
      "warranty_type": "full",
      "stock": null,
      "available": true,
      "manual_delivery": false,
      "requires_stock": false,
      "external_source": null,
      "api_orderable": true
    }
  ]
}
```

**401**

```json
{ "error": "Invalid or revoked API key" }
```

### GET ?action=stock

Stock and effective price for one product at a specific quantity.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `product_id` | query | uuid | | Product to check |
| `quantity` | query | int | — | Default 1, clamped 1..1000. Applies the matching bulk tier |

```bash
curl "https://api.vexoran.app?action=stock&product_id=3f9a1c02-7e64-4b8a-9d21-8c5b0e2a4f10&quantity=1" \
  -H "Authorization: Bearer $KEY"
```

Key response fields: `product_id` (echoed), `quantity` (clamped 1..1000), `price` (bulk applied), `base_price` / `custom_price`, `discount_source` / `discount_ends_at`, promo blocks (`offer` / `flash_sale` / `campaign`), bulk fields (same as products), `stock` (null for services), `available`, `is_active`, `warranty_type`, `manual_delivery` / `requires_stock`.

**200 OK**

```json
{
  "product_id": "3f9a1c02-7e64-4b8a-9d21-8c5b0e2a4f10",
  "name": "Netflix Premium — 1 Month",
  "description": "4K UHD · shared profile · instant delivery",
  "description_text": "4K UHD · shared profile · instant delivery",
  "description_html": "<p>4K UHD · shared profile · instant delivery</p>",
  "delivery_instructions": "Sign in within 24h and set your own profile PIN.",
  "quantity": 1,
  "price": 5,
  "base_price": 5,
  "custom_price": false,
  "discount_source": "base",
  "discount_ends_at": null,
  "offer": null,
  "flash_sale": null,
  "campaign": null,
  "bulk_discount_percent": 0,
  "bulk_discount_active": false,
  "bulk_discount_style": null,
  "bulk_discount_unit_price": null,
  "bulk_discount_text": null,
  "price_locked": false,
  "bulk_discounts": [
    { "min_qty": 10, "unit_price": 4.25, "discount_percent": 15 },
    { "min_qty": 25, "unit_price": 4, "discount_percent": 20 }
  ],
  "bulk_pricing": [
    { "min_qty": 10, "style": "percentage", "discount_percent": 15, "unit_price": 4.25, "text": "Buy 10+ → 15% OFF (4.25 USDT each)" },
    { "min_qty": 25, "style": "percentage", "discount_percent": 20, "unit_price": 4, "text": "Buy 25+ → 20% OFF (4.00 USDT each)" }
  ],
  "bulk_pricing_text": "Buy 10+ → 15% OFF (4.25 USDT each)\nBuy 25+ → 20% OFF (4.00 USDT each)",
  "stock": 42,
  "available": true,
  "is_active": true,
  "warranty_type": "full",
  "manual_delivery": false,
  "requires_stock": true
}
```

**404**

```json
{ "error": "Product not found" }
```

### GET ?action=balance

Current reseller wallet balance.

```bash
curl "https://api.vexoran.app?action=balance" \
  -H "Authorization: Bearer $KEY"
```

**200 OK**

```json
{ "balance": 250 }
```

Balance is in USDT.

**401**

```json
{ "error": "Invalid or revoked API key" }
```

### GET ?action=orders

History of orders placed with this API key (offset pagination). `warranty_type` is not returned here — only on products & stock.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `limit` | query | int | — | Default 50, clamped 1..100 |
| `offset` | query | int | — | Default 0, min 0 |

```bash
curl "https://api.vexoran.app?action=orders&limit=50&offset=0" \
  -H "Authorization: Bearer $KEY"
```

**Response fields**

| Field | Type | Notes |
|---|---|---|
| `external_order_id` | string \| null | Idempotency key for this order |
| `order_id` | string | Vexoran order code (orders.order_code) |
| `product` | string | Product name |
| `description` / `description_text` / `description_html` | string \| null | Product descriptions |
| `delivery_instructions` | string \| null | Post-purchase instructions |
| `status` | string | `delivered` \| `cancelled` \| … |
| `amount` | number | Total charged |
| `quantity` | number | Units |
| `data` | string \| null | Delivered value (orders.delivered_value) |
| `created_at` | iso8601 | Order timestamp |
| (envelope) | object | `{ orders: [...], limit, offset }` — offset pagination |

**200 OK**

```json
{
  "orders": [
    {
      "external_order_id": "po-2026-0830-0007",
      "order_id": "VX-7B2E10",
      "product": "Netflix Premium — 1 Month",
      "description": "4K UHD · shared profile · instant delivery",
      "description_text": "4K UHD · shared profile · instant delivery",
      "description_html": "<p>4K UHD · shared profile · instant delivery</p>",
      "delivery_instructions": "Sign in within 24h and set your own profile PIN.",
      "status": "delivered",
      "amount": 5,
      "quantity": 1,
      "data": "nf.demo42@vexoran.mail : S4ndb0x-Demo",
      "created_at": "2026-08-30T14:05:00Z"
    },
    {
      "external_order_id": "po-2026-0829-0031",
      "order_id": "VX-6A19F3",
      "product": "ChatGPT Plus — Voucher Code",
      "description": "30-day voucher · redeemable worldwide",
      "description_text": "30-day voucher · redeemable worldwide",
      "description_html": "<p>30-day voucher · redeemable worldwide</p>",
      "delivery_instructions": "Redeem at chatgpt.com within 7 days of purchase.",
      "status": "delivered",
      "amount": 6.5,
      "quantity": 1,
      "data": "CGPT-DEMO-9F3A-2C71-SANDBOX",
      "created_at": "2026-08-29T09:41:00Z"
    }
  ],
  "limit": 50,
  "offset": 0
}
```

**401**

```json
{ "error": "Invalid or revoked API key" }
```

### POST ?action=order

Create an order. Idempotent via `external_order_id` — retries never double-charge. Requires `Content-Type: application/json`.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `product_id` | body | uuid | | Product to buy |
| `quantity` | body | int | — | Default 1; > 1000 rejected; clamped to product min/max bands |
| `external_order_id` | body | string | — | ≤ 200 chars. Idempotency key — reuse the same value to retry safely |
| `coupon_code` | body | string | — | Optional discount coupon (alias: `coupon`). Upper-cased |

```bash
curl -X POST "https://api.vexoran.app?action=order" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "product_id": "3f9a1c02-7e64-4b8a-9d21-8c5b0e2a4f10",
    "quantity": 1,
    "external_order_id": "po-2026-0902-0044"
  }'
```

**Response fields**

| Field | Type | Notes |
|---|---|---|
| `status` | `"delivered"` | Success state |
| `order_id` | string | Vexoran order code |
| `product` | string | Product name |
| `description` / `description_text` / `description_html` | string \| null | Product descriptions |
| `quantity` | number | Delivered count |
| `unit_price` / `amount` / `base_price` | number | Per-unit, total charged, public base |
| `subtotal` | number | Pre-coupon subtotal |
| `coupon` | object \| null | `{ code, applied, discount }` or `{ code, applied: false }` or null |
| `discount_source` / `discount_ends_at` | enum / iso8601 \| null | Applied pricing rule |
| `bulk_discount_percent` / `bulk_discount_active` | number / boolean | Bulk summary |
| `data` | string | Delivered value(s), newline-joined |
| `delivery_format` | `"text" \| "merged" \| "per_file"` | How data is packaged |
| `delivery_files` | array | `[{ file_name, mime_type }]` for file stock |
| `delivery_instructions` | string \| null | Post-purchase instructions |
| `external_order_id` | string \| null | Echoed idempotency key |
| `idempotent_replay` | boolean | `true` when a prior order with this key is returned unchanged |

**200 OK**

```json
{
  "status": "delivered",
  "order_id": "VX-8F3A2C",
  "product": "Netflix Premium — 1 Month",
  "description": "4K UHD · shared profile · instant delivery",
  "description_text": "4K UHD · shared profile · instant delivery",
  "description_html": "<p>4K UHD · shared profile · instant delivery</p>",
  "quantity": 1,
  "unit_price": 5,
  "amount": 5,
  "base_price": 5,
  "subtotal": 5,
  "coupon": null,
  "discount_source": "base",
  "discount_ends_at": null,
  "bulk_discount_percent": 0,
  "bulk_discount_active": false,
  "data": "nf.demo88@vexoran.mail : S4ndb0x-Demo",
  "delivery_format": "text",
  "delivery_files": [],
  "delivery_instructions": "Sign in within 24h and set your own profile PIN.",
  "external_order_id": "po-2026-0902-0044"
}
```

**402**

```json
{
  "error": "Insufficient balance",
  "balance": 3.2,
  "required": 5
}
```

### GET ?action=webhooks

Registered webhook endpoints (secret masked).

```bash
curl "https://api.vexoran.app?action=webhooks" \
  -H "Authorization: Bearer $KEY"
```

**Response fields**

| Field | Type | Notes |
|---|---|---|
| `webhooks[]` | array | Endpoints (secret masked) |
| `webhooks[].id` | uuid | Endpoint id — pass to `op=rotate_secret/enable/delete/test` |
| `webhooks[].name` / `url` | string | Label and https target |
| `webhooks[].events` | string[] | Subscribed events |
| `webhooks[].is_active` / `failure_count` | boolean / number | Health; auto-disabled after repeated failures |
| `webhooks[].last_triggered_at` / `created_at` | iso8601 \| null | Timestamps |
| `webhooks[].secret_preview` | string | Masked secret (never the full value) |
| `webhooks[].hmac_version` | number | Signature version (2) |
| `max_endpoints` | number | Cap per reseller (3) |
| `events_available` | string[] | The event allowlist |

**200 OK**

```json
{
  "webhooks": [
    {
      "id": "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b",
      "name": "prod-receiver",
      "url": "https://hooks.example.com/vexoran",
      "events": ["product.price_changed", "order.delivered"],
      "is_active": true,
      "failure_count": 0,
      "last_triggered_at": "2026-09-01T09:12:00Z",
      "created_at": "2026-08-20T10:00:00Z",
      "secret_preview": "whsec_1a2b…",
      "hmac_version": 2
    }
  ],
  "max_endpoints": 3,
  "events_available": [
    "product.price_changed",
    "product.stock_changed",
    "order.delivered"
  ]
}
```

**401**

```json
{ "error": "Invalid or revoked API key" }
```

## Webhooks · Setup & Signatures

Register HTTPS endpoints and Vexoran pushes a signed POST when something relevant happens — stop polling. Managed through `?action=webhooks` with the same key.

### Operations

| Call | Does |
|---|---|
| `POST ?action=webhooks` | Register — body `{ url, events[], name? }`. Returns the signing secret **once** |
| `POST &op=rotate_secret` | New secret (shown once); the previous one stops signing immediately. Body `{ endpoint_id }` |
| `POST &op=enable` | Re-activate after auto-disable; re-runs SSRF checks and resets the failure count |
| `POST &op=delete` | Remove an endpoint and its delivery history |
| `POST &op=test` | Send a synthetic signed ping and return the delivery outcome |
| `GET ?action=webhooks` | List endpoints (secret masked) |

Guardrails: HTTPS only, at most 3 endpoints per account, SSRF-validated at registration and on every send. Event allowlist: `product.price_changed`, `product.stock_changed`, `order.delivered`.

### Register an endpoint

```bash
curl -X POST "https://api.vexoran.app?action=webhooks" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://hooks.example.com/vexoran",
    "events": ["product.price_changed", "order.delivered"],
    "name": "prod-receiver"
  }'
```

### Verifying signatures

Each delivery carries an `X-Vexoran-Signature-V2` header:

```
X-Vexoran-Signature-V2: v2,t=<unix>,n=<nonce>,s=<hmac_sha256_hex>
```

Recompute the HMAC and compare in constant time; reject if the timestamp is more than 5 minutes old or the nonce was seen in the last 10 minutes.

```ts
import crypto from "node:crypto";

// Parse: X-Vexoran-Signature-V2: v2,t=<unix>,n=<nonce>,s=<hmac_sha256_hex>
function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(
    header.split(",").slice(1).map((kv) => kv.split("=")),
  );
  const { t, n, s } = parts;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // 5-min window
  const signed = `${t}.${n}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signed).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(s);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

> The signed payload is `<t>.<n>.<raw_request_body>`. Always use constant-time comparison (`crypto.timingSafeEqual`) — never `===` — and verify against the raw body, before any JSON parsing.
