# API Reseller — Qamify

Programmatic access to products, orders, and balance.

## Base URL

```
https://api.qamify.site
```

## Authentication

Send the API key on every request using one of these headers:

```
Authorization: Bearer YOUR_API_KEY
# or
X-API-Key: YOUR_API_KEY
```

Get the API key from the shop bot → Reseller menu → Generate Key.

## Endpoints

### GET /v1/ping

Check API key and reseller status. Works even if the account is suspended.

```bash
curl https://api.qamify.site/v1/ping \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### GET /v1/balance

Get current prepaid balance.

```bash
curl https://api.qamify.site/v1/balance \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### GET /v1/products

List all products available at reseller prices, with live stock counts.

```bash
curl https://api.qamify.site/v1/products \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### GET /v1/products/:id

Get a single product by ID including live stock and sold counts.

```bash
curl https://api.qamify.site/v1/products/42 \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### POST /v1/orders

Place an order. Keys are returned instantly in the response.

> **Idempotency-Key header is required.** Use a unique value per order attempt. Retrying with the same key returns the original order instead of charging again.

Request body:

| Field | Type | Description |
|---|---|---|
| `product_id` | integer | ID from `/v1/products` |
| `qty` | integer | Quantity to buy (min 1) |
| `idempotency_key` | string | Unique key for this order attempt |

```bash
curl -X POST https://api.qamify.site/v1/orders \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Idempotency-Key: order-$(date +%s)-001" \
  -H "Content-Type: application/json" \
  -d '{"product_id": 1, "qty": 1}'
```

### GET /v1/orders/:code

Re-fetch a single order and its delivered items by order code.

```bash
curl https://api.qamify.site/v1/orders/RA-1A2B3C4D5E \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### GET /v1/orders

List recent orders. Supports `?limit=` (max 200) and `?offset=` for pagination.

```bash
curl "https://api.qamify.site/v1/orders?limit=20&offset=0" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### GET /v1/sold

Aggregate stats — products sold with totals.

```bash
curl https://api.qamify.site/v1/sold \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Error Codes

| Code | HTTP | Meaning |
|---|---|---|
| `missing_or_malformed_key` | 401 | No API key or invalid format |
| `invalid_key` | 401 | Key not found or revoked |
| `reseller_suspended` | 403 | Account suspended — contact shop |
| `out_of_stock` | 409 | Not enough stock for requested qty |
| `rate_limited` | 429 | Too many requests — check `Retry-After` header |
| `internal_error` | 500 | Order failed and was fully rolled back — safe to retry |
