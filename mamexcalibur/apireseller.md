# API Reseller — Excalibur

RESTful endpoints to check balance, monitor live product stock, and automate purchases in real-time.

## Base URL

```
https://arrsnetworkzone.in
```

## Authentication

Every request requires the API key via the `X-API-Key` header:

```
X-API-Key: AK_YOUR_SECRET_KEY
```

Keep the key secret. If compromised, revoke it immediately via the Telegram Bot.

## Rate Limits

All endpoints are rate-limited to **3 requests per second per API key**. Exceeding returns HTTP `429 Too Many Requests`.

## Endpoints

### GET /api/v1/me

Fetch profile information and real-time wallet balance.

**Response 200 OK**

```json
{
  "chat_id": 123456789,
  "first_name": "John Doe",
  "wallet_balance": 150.50
}
```

### GET /api/v1/products

List all available products with pricing and exact stock amounts.

**Response 200 OK**

```json
{
  "services": [
    {
      "service_id": "S_01",
      "name": "Gemini Pro 1 Month",
      "price": 10.0,
      "stock": 42
    }
  ]
}
```

### POST /api/v1/order

Place an automated order. Cost is deducted from balance, product codes returned instantly.

> **Stock note:** depending on admin settings, the API may require a minimum stock buffer (e.g. 100 stock). If the buffer is active, API purchases can only be made from stock above the buffer limit.

**Request payload**

```json
{
  "service_id": "S_01",
  "quantity": 1
}
```

**Response 200 OK**

```json
{
  "success": true,
  "order_id": "API_ABC123XYZ",
  "service_id": "S_01",
  "quantity": 1,
  "total_cost": 10.0,
  "new_balance": 140.50,
  "products": [
    "CODE_12345"
  ]
}
```

**Error 400 Bad Request**

```json
{
  "error": "Insufficient balance"
}
```

```bash
curl -X POST https://arrsnetworkzone.in/api/v1/order \
  -H "X-API-Key: AK_YOUR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"service_id": "S_01", "quantity": 1}'
```

### GET /api/v1/orders

Fetch complete order history. Optional `page` and `limit` (default 50, **max 200** — larger returns an error).

```bash
curl "https://arrsnetworkzone.in/api/v1/orders?page=1&limit=50" \
  -H "X-API-Key: AK_YOUR_SECRET_KEY"
```

**Response 200 OK**

```json
{
  "success": true,
  "page": 1,
  "limit": 50,
  "total_orders": 120,
  "total_pages": 3,
  "orders": [
    {
      "order_id": "TRXN12345",
      "service": "Gemini Pro",
      "quantity": 1,
      "amount": 10.0,
      "status": "success",
      "delivered_products": ["CODE_XYZ"],
      "created_at": "2026-07-09T08:00:00"
    }
  ]
}
```

### GET /api/v1/order/{id}

Fetch details of a specific order by `order_id`.

**Response 200 OK**

```json
{
  "success": true,
  "order": {
    "order_id": "TRXN12345",
    "service": "Gemini Pro",
    "quantity": 1,
    "amount": 10.0,
    "status": "success",
    "delivered_products": ["CODE_XYZ"]
  }
}
```

### GET /api/v1/stats

Comprehensive account statistics: total deposits, total spends, per-product purchase breakdown. Optional custom date filtering.

**Query parameters (optional)**

- `start` — custom start date, format `YYYY-MM-DD-HH:MM-AM/PM` (e.g. `2026-07-09-10:00-AM`)
- `end` — custom end date, same format

**Response 200 OK**

```json
{
  "success": true,
  "deposits": {
    "today": 10.0,
    "7d": 50.0,
    "30d": 200.0,
    "365d": 1500.0,
    "all_time": 2000.0
  },
  "sales": {
    "today": 5.0,
    "7d": 30.0,
    "30d": 150.0,
    "365d": 1200.0,
    "all_time": 1800.0
  },
  "products_breakdown": [
    {
      "service_id": "service_123",
      "name": "Premium Product",
      "quantity_sold": 10,
      "revenue": 100.0
    }
  ]
}
```
