// Konektor Vexoran — mengikuti kontrak response.md
// Upstream: Authorization Bearer, ?action= query style, offset pagination (max 100), idempotency via external_order_id
import { Database } from "bun:sqlite";

const env = {
  port: Number(process.env.PORT ?? 3004),
  base: process.env.SUPPLIER_BASE_URL!,
  key: process.env.SUPPLIER_API_KEY!,
  authHeader: process.env.SUPPLIER_AUTH_HEADER ?? "Authorization",
  authPrefix: process.env.SUPPLIER_AUTH_PREFIX ?? "Bearer",
  currency: process.env.CURRENCY ?? "USD",
  master: process.env.MASTER_KEY!,
  supplier: "vexoran",
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

function toISO(s: unknown): string | null {
  if (!s) return null;
  const d = new Date(String(s));
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

function mapUpstream(res: Response, up: any) {
  const msg =
    typeof up?.error === "string" ? up.error
    : up?.error?.message ?? up?.message ?? `upstream ${res.status}`;
  const s = res.status;
  if (s === 402) return fail("insufficient_balance", msg, s, 402);
  if (s === 409) return fail("out_of_stock", msg, s, 409);
  if (s === 429) return fail("rate_limited", msg, s, 429);
  if (s === 404) return fail("not_found", msg, s, 404);
  return fail("upstream_error", msg, s, 502);
}

// ---------- normalisasi ----------
function pickArray(b: any): any[] {
  if (Array.isArray(b)) return b;
  for (const k of ["products", "data", "orders"]) {
    if (Array.isArray(b?.[k])) return b[k];
  }
  return [];
}

function normProduct(p: any) {
  const stock = p.stock == null ? -1 : Number(p.stock);
  return {
    id: String(p.id ?? p.product_id ?? ""),
    name: String(p.name ?? ""),
    description: p.description_text ?? p.description ?? null,
    price: Number(p.price ?? 0),
    stock,
    orderable: p.available != null || p.api_orderable != null
      ? (p.available ?? true) && (p.api_orderable ?? true)
      : stock > 0,
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
  // list tidak memuat product_id → hanya nama
  const raw = o.data ?? o.products ?? o.delivered_products;
  const items = Array.isArray(raw) ? raw.map(String)
    : typeof raw === "string" && raw ? raw.split(/\r?\n/).filter(Boolean) : [];
  return {
    order_id: String(o.order_id ?? ""),
    product_id: String(o.product_id ?? ""),
    product_name: String(o.product ?? o.product_name ?? ""),
    quantity: Number(o.quantity ?? 0),
    amount: Number(o.amount ?? 0),
    status: normStatus(o.status),
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
      const { res, body } = await upstream("/?action=balance");
      return ok({ status: res.ok ? "up" : "down", http_status: res.status, upstream: body ?? null });
    } catch {
      return ok({ status: "down", http_status: null, upstream: null });
    }
  }

  if (path === "/products" && m === "GET") {
    if (!authKey(req)) return fail("unauthorized", "api key tidak valid", null, 401);
    const { res, body } = await upstream("/?action=products");
    if (!res.ok) return mapUpstream(res, body);
    return ok({ products: pickArray(body).map(normProduct) });
  }

  let match = path.match(/^\/products\/([^/]+)$/);
  if (match && m === "GET") {
    if (!authKey(req)) return fail("unauthorized", "api key tidak valid", null, 401);
    const id = match[1];
    const { res, body } = await upstream(`/?action=stock&product_id=${encodeURIComponent(id)}&quantity=1`);
    if (!res.ok) return mapUpstream(res, body);
    const p = body ?? {};
    const stock = p.stock == null ? -1 : Number(p.stock);
    return ok({
      product: {
        id: String(p.product_id ?? id),
        name: String(p.name ?? ""),
        description: p.description_text ?? p.description ?? null,
        price: Number(p.price ?? 0),
        stock,
        orderable: (p.is_active ?? true) && (p.available ?? stock > 0),
      },
    });
  }

  if (path === "/balance" && m === "GET") {
    if (!authKey(req)) return fail("unauthorized", "api key tidak valid", null, 401);
    const { res, body } = await upstream("/?action=balance");
    if (!res.ok) return mapUpstream(res, body);
    return ok({ balance: Number(body?.balance ?? 0), currency: env.currency });
  }

  if (path === "/orders" && m === "POST") {
    if (!authKey(req)) return fail("unauthorized", "api key tidak valid", null, 401);
    let body: any;
    try { body = await req.json(); } catch { return fail("bad_request", "body json tidak valid"); }
    const product_id = body?.product_id;
    const quantity = Number(body?.quantity ?? 1);
    if (!product_id || !Number.isFinite(quantity) || quantity < 1)
      return fail("bad_request", "product_id dan quantity >= 1 wajib diisi");
    const idem = req.headers.get("idempotency-key") ?? body?.idempotency_key ?? `cnk-${crypto.randomUUID()}`;
    const prev = db.query("SELECT order_json FROM idempotency WHERE key = ?").get(idem) as any;
    if (prev) return ok(JSON.parse(prev.order_json));
    const { res, body: up } = await upstream("/?action=order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ product_id, quantity, external_order_id: idem }),
    });
    if (!res.ok) return mapUpstream(res, up);
    const order = { ...normOrder(up), product_id: String(product_id) };
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
    if (limit > 100) limit = 100; // upstream clamp 1..100
    if (!Number.isFinite(offset) || offset < 0) offset = 0;
    const { res, body } = await upstream(`/?action=orders&limit=${limit}&offset=${offset}`);
    if (!res.ok) return mapUpstream(res, body);
    return ok({
      orders: pickArray(body).map(normOrder),
      limit,
      offset,
      total: null, // upstream tidak memberi total
    });
  }

  match = path.match(/^\/orders\/([^/]+)$/);
  if (match && m === "GET") {
    if (!authKey(req)) return fail("unauthorized", "api key tidak valid", null, 401);
    // upstream tidak punya endpoint single-order → cari dari list
    const id = match[1];
    const { res, body } = await upstream("/?action=orders&limit=100&offset=0");
    if (!res.ok) return mapUpstream(res, body);
    const found = pickArray(body).find((o: any) => String(o.order_id) === id);
    if (!found) return fail("not_found", `order ${id} tidak ditemukan`, null, 404);
    return ok({ order: normOrder(found) });
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
