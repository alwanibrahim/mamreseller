// Konektor Warzone — mengikuti kontrak response.md
// Upstream: X-API-Key, path /api/v1/*, pagination page-based, created_at IST, tanpa idempotency upstream (dedup lokal)
import { Database } from "bun:sqlite";

const env = {
  port: Number(process.env.PORT ?? 3003),
  base: process.env.SUPPLIER_BASE_URL!,
  key: process.env.SUPPLIER_API_KEY!,
  authHeader: process.env.SUPPLIER_AUTH_HEADER ?? "X-API-Key",
  authPrefix: process.env.SUPPLIER_AUTH_PREFIX ?? "",
  currency: process.env.CURRENCY ?? "USD",
  master: process.env.MASTER_KEY!,
  supplier: "warzone",
};

const db = new Database(process.env.DB_PATH ?? "konektor.db");
db.exec(`
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  key_suffix TEXT NOT NULL,
  limit_count INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT PRIMARY KEY,
  order_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

// ---------- helpers ----------
const sha = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
const meta = () => ({ supplier: env.supplier, currency: env.currency, timestamp: new Date().toISOString() });
const ok = (data: unknown) => Response.json({ success: true, data, error: null, meta: meta() });
const fail = (code: string, message: string, upstream_status: number | null = null, http = 400) =>
  Response.json({ success: false, data: null, error: { code, message, upstream_status }, meta: meta() }, { status: http });

// created_at warzone = IST (UTC+05:30) → konversi ke UTC
function toISO(s: unknown, assumeOffset = "+05:30"): string | null {
  if (!s) return null;
  let str = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)) str = str.replace(" ", "T") + assumeOffset;
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(str)) str += assumeOffset;
  const d = new Date(str);
  return isNaN(+d) ? String(s) : d.toISOString();
}

function genKey() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return "cnk_live_" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function bearer(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : h;
}

function authKey(req: Request) {
  const t = bearer(req);
  if (!t) return null;
  return db.query("SELECT * FROM api_keys WHERE key_hash = ? AND active = 1").get(sha(t)) ?? null;
}

const authMaster = (req: Request) => bearer(req) === env.master;

// ---------- upstream ----------
async function upstream(path: string, init: RequestInit = {}) {
  const auth = env.authPrefix ? `${env.authPrefix} ${env.key}` : env.key;
  const headers = { [env.authHeader]: auth, ...(init.headers ?? {}) };
  const res = await fetch(env.base + path, { ...init, headers, signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => null);
  return { res, body };
}

// 400 upstream = bad params / stok kurang / saldo kurang → bedakan via pesan
function mapUpstream(res: Response, up: any) {
  const msg =
    typeof up?.error === "string" ? up.error
    : up?.error?.message ?? up?.message ?? `upstream ${res.status}`;
  const s = res.status;
  if (s === 400) {
    const m = msg.toLowerCase();
    return m.includes("balance")
      ? fail("insufficient_balance", msg, s, 402)
      : fail("out_of_stock", msg, s, 409);
  }
  if (s === 402) return fail("insufficient_balance", msg, s, 402);
  if (s === 409) return fail("out_of_stock", msg, s, 409);
  if (s === 429) return fail("rate_limited", msg, s, 429);
  if (s === 404) return fail("not_found", msg, s, 404);
  return fail("upstream_error", msg, s, 502);
}

// ---------- normalisasi ----------
function pickArray(b: any): any[] {
  if (Array.isArray(b)) return b;
  for (const k of ["services", "products", "data", "orders"]) {
    if (Array.isArray(b?.[k])) return b[k];
  }
  return [];
}

function normProduct(p: any) {
  const stock = p.stock == null ? -1 : Number(p.stock);
  return {
    id: String(p.service_id ?? p.id ?? ""),
    name: String(p.name ?? ""),
    description: p.description ?? null,
    price: Number(p.price ?? 0),
    stock,
    orderable: p.orderable != null ? !!p.orderable : stock > 0,
  };
}

const STATUSES = ["delivered", "processing", "cancelled", "failed"];
function normStatus(s: unknown): string {
  const v = s === undefined || s === null ? undefined : String(s).toLowerCase();
  if (v === "success" || v === "true" || v === true) return "delivered";
  if (v && STATUSES.includes(v)) return v;
  return "processing";
}

function normOrder(o: any) {
  const raw = o.delivered_products ?? o.products ?? o.items;
  const items = Array.isArray(raw) ? raw.map(String) : [];
  return {
    order_id: String(o.order_id ?? o.id ?? ""),
    product_id: String(o.service_id ?? o.product_id ?? ""),
    product_name: String(o.service ?? o.product_name ?? o.product ?? ""),
    quantity: Number(o.quantity ?? 0),
    amount: Number(o.amount ?? o.total_cost ?? 0),
    status: normStatus(o.status ?? o.success),
    items,
    created_at: toISO(o.created_at),
  };
}

// ---------- handler ----------
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const m = req.method;

  if (path === "/ping" && m === "GET") {
    if (!authKey(req)) return fail("unauthorized", "api key tidak valid", null, 401);
    try {
      const { res, body } = await upstream("/api/v1/me");
      return ok({ status: res.ok ? "up" : "down", http_status: res.status, upstream: body ?? null });
    } catch {
      return ok({ status: "down", http_status: null, upstream: null });
    }
  }

  if (path === "/products" && m === "GET") {
    if (!authKey(req)) return fail("unauthorized", "api key tidak valid", null, 401);
    const { res, body } = await upstream("/api/v1/products");
    if (!res.ok) return mapUpstream(res, body);
    return ok({ products: pickArray(body).map(normProduct) });
  }

  let match = path.match(/^\/products\/([^/]+)$/);
  if (match && m === "GET") {
    if (!authKey(req)) return fail("unauthorized", "api key tidak valid", null, 401);
    const id = match[1];
    const { res, body } = await upstream("/api/v1/products");
    if (!res.ok) return mapUpstream(res, body);
    const found = pickArray(body).find((p: any) => String(p.service_id ?? p.id) === id);
    if (!found) return fail("not_found", `produk ${id} tidak ditemukan`, null, 404);
    return ok({ product: normProduct(found) });
  }

  if (path === "/balance" && m === "GET") {
    if (!authKey(req)) return fail("unauthorized", "api key tidak valid", null, 401);
    const { res, body } = await upstream("/api/v1/me");
    if (!res.ok) return mapUpstream(res, body);
    return ok({ balance: Number(body?.wallet_balance ?? 0), currency: env.currency });
  }

  if (path === "/orders" && m === "POST") {
    if (!authKey(req)) return fail("unauthorized", "api key tidak valid", null, 401);
    let body: any;
    try { body = await req.json(); } catch { return fail("bad_request", "body json tidak valid"); }
    const product_id = body?.product_id;
    const quantity = Number(body?.quantity ?? 1);
    if (!product_id || !Number.isFinite(quantity) || quantity < 1)
      return fail("bad_request", "product_id dan quantity >= 1 wajib diisi");
    // upstream tanpa idempotency → dedup lokal
    const idem = req.headers.get("idempotency-key") ?? body?.idempotency_key ?? `cnk-${crypto.randomUUID()}`;
    const prev = db.query("SELECT order_json FROM idempotency WHERE key = ?").get(idem) as any;
    if (prev) return ok(JSON.parse(prev.order_json));
    const { res, body: up } = await upstream("/api/v1/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ service_id: product_id, quantity }),
    });
    if (!res.ok) return mapUpstream(res, up);
    const order = normOrder(up?.order ?? up);
    const payload = { order };
    db.query("INSERT OR IGNORE INTO idempotency (key, order_json, created_at) VALUES (?,?,?)")
      .run(idem, JSON.stringify(payload), new Date().toISOString());
    return ok(payload);
  }

  if (path === "/orders" && m === "GET") {
    if (!authKey(req)) return fail("unauthorized", "api key tidak valid", null, 401);
    let limit = Number(url.searchParams.get("limit") ?? 50);
    let offset = Number(url.searchParams.get("offset") ?? 0);
    if (!Number.isFinite(limit) || limit < 1) limit = 50;
    if (limit > 200) limit = 200;
    if (!Number.isFinite(offset) || offset < 0) offset = 0;
    // upstream page-based → konversi offset
    const page = Math.floor(offset / limit) + 1;
    const { res, body } = await upstream(`/api/v1/orders?page=${page}&limit=${limit}`);
    if (!res.ok) return mapUpstream(res, body);
    return ok({
      orders: pickArray(body).map(normOrder),
      limit,
      offset,
      total: body?.total_orders ?? null,
    });
  }

  match = path.match(/^\/orders\/([^/]+)$/);
  if (match && m === "GET") {
    if (!authKey(req)) return fail("unauthorized", "api key tidak valid", null, 401);
    const { res, body } = await upstream(`/api/v1/order/${match[1]}`);
    if (!res.ok) return mapUpstream(res, body);
    return ok({ order: normOrder(body?.order ?? body) });
  }

  // ----- admin: MASTER_KEY -----
  if (path === "/keys" && m === "POST") {
    if (!authMaster(req)) return fail("unauthorized", "master key tidak valid", null, 401);
    let body: any = {};
    try { body = await req.json(); } catch {}
    const raw = genKey();
    const id = `key_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    db.query("INSERT INTO api_keys (id, name, key_hash, key_prefix, key_suffix, limit_count, active, created_at) VALUES (?,?,?,?,?,?,1,?)")
      .run(id, body?.name ?? "", sha(raw), raw.slice(0, 12), raw.slice(-4), body?.limit ?? null, new Date().toISOString());
    return ok({
      key: { id, name: body?.name ?? "", key: raw, limit: body?.limit ?? null, active: true, created_at: new Date().toISOString() },
    });
  }

  if (path === "/keys" && m === "GET") {
    if (!authMaster(req)) return fail("unauthorized", "master key tidak valid", null, 401);
    const rows = db.query("SELECT * FROM api_keys ORDER BY created_at DESC").all() as any[];
    return ok({
      keys: rows.map((r) => ({
        id: r.id, name: r.name,
        key: `${r.key_prefix}…${r.key_suffix}`,
        limit: r.limit_count, active: !!r.active, created_at: r.created_at,
      })),
    });
  }

  match = path.match(/^\/keys\/([^/]+)$/);
  if (match && m === "DELETE") {
    if (!authMaster(req)) return fail("unauthorized", "master key tidak valid", null, 401);
    db.query("UPDATE api_keys SET active = 0 WHERE id = ?").run(match[1]);
    return ok({ id: match[1], active: false });
  }

  return fail("not_found", `endpoint ${m} ${path} tidak ada`, null, 404);
}

Bun.serve({ port: env.port, fetch: handler });
console.log(`[konektor ${env.supplier}] listening on http://localhost:${env.port}`);
