// Konektor Qamify — mengikuti kontrak response.md
// Semua response: { success, data, error, meta }
import { Database } from "bun:sqlite";

const env = {
  port: Number(process.env.PORT ?? 3001),
  base: process.env.SUPPLIER_BASE_URL!,
  key: process.env.SUPPLIER_API_KEY!,
  authHeader: process.env.SUPPLIER_AUTH_HEADER ?? "Authorization",
  authPrefix: process.env.SUPPLIER_AUTH_PREFIX ?? "",
  currency: process.env.CURRENCY ?? "USD",
  master: process.env.MASTER_KEY!,
  supplier: "qamify",
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

// created_at qamify bisa unix seconds → ISO
function toISO(s: unknown): string | null {
  if (!s) return null;
  const str = String(s).trim();
  if (/^\d{10}$/.test(str)) return new Date(Number(str) * 1000).toISOString();
  if (/^\d{13}$/.test(str)) return new Date(Number(str)).toISOString();
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
  for (const k of ["products", "data", "services", "orders"]) {
    if (Array.isArray(b?.[k])) return b[k];
  }
  return [];
}

function normProduct(p: any) {
  const stock = p.stock == null ? -1 : Number(p.stock);
  return {
    id: String(p.id ?? p.product_id ?? p.service_id ?? ""),
    name: String(p.name ?? p.product_name ?? ""),
    description: p.description ?? p.description_text ?? null,
    price: Number(p.unit_price ?? p.price ?? 0),
    stock,
    orderable: stock > 0,
  };
}

const STATUSES = ["delivered", "processing", "cancelled", "failed"];
function normStatus(s: unknown): string {
  const v = s === undefined || s === null ? undefined : String(s).toLowerCase();
  if (v === "success" || v === "true" || v === true || v === "completed") return "delivered";
  if (v && STATUSES.includes(v)) return v;
  return "processing";
}

function normOrder(o: any) {
  const raw = o.products ?? o.delivered_products ?? o.data ?? o.items;
  const items = Array.isArray(raw)
    ? raw.map((x: any) => String(typeof x === "object" && x !== null ? (x.content ?? JSON.stringify(x)) : x))
    : typeof raw === "string" && raw
      ? raw.split(/\r?\n/).filter(Boolean)
      : [];
  return {
    order_id: String(o.order_id ?? o.order_code ?? o.code ?? o.id ?? ""),
    product_id: String(o.product_id ?? o.service_id ?? ""),
    product_name: String(o.product_name ?? o.product ?? ""),
    quantity: Number(o.quantity ?? o.qty ?? 0),
    amount: Number(o.amount ?? o.total ?? o.total_cost ?? 0),
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

  // ----- public: auth konektor key -----
  if (path === "/ping" && m === "GET") {
    const key = authKey(req);
    if (!key) return fail("unauthorized", "api key tidak valid", null, 401);
    try {
      const { res, body } = await upstream("/v1/ping");
      return ok({ status: res.ok ? "up" : "down", http_status: res.status, upstream: body ?? null });
    } catch {
      return ok({ status: "down", http_status: null, upstream: null });
    }
  }

  if (path === "/products" && m === "GET") {
    if (!authKey(req)) return fail("unauthorized", "api key tidak valid", null, 401);
    const { res, body } = await upstream("/v1/products");
    if (!res.ok) return mapUpstream(res, body);
    return ok({ products: pickArray(body).map(normProduct) });
  }

  let match = path.match(/^\/products\/([^/]+)$/);
  if (match && m === "GET") {
    if (!authKey(req)) return fail("unauthorized", "api key tidak valid", null, 401);
    const id = match[1];
    const { res, body } = await upstream(`/v1/products/${id}`);
    if (res.ok) {
      const p = body?.product ?? body;
      return ok({ product: normProduct(p) });
    }
    // fallback: cari dari list
    const { res: r2, body: b2 } = await upstream("/v1/products");
    if (r2.ok) {
      const found = pickArray(b2).find((p: any) => String(p.id ?? p.product_id ?? p.service_id) === id);
      if (found) return ok({ product: normProduct(found) });
    }
    return fail("not_found", `produk ${id} tidak ditemukan`, res.status, 404);
  }

  if (path === "/balance" && m === "GET") {
    if (!authKey(req)) return fail("unauthorized", "api key tidak valid", null, 401);
    const { res, body } = await upstream("/v1/balance");
    if (!res.ok) return mapUpstream(res, body);
    const bal = Number(body?.balance ?? body?.wallet_balance ?? 0);
    return ok({ balance: bal, currency: env.currency });
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
    const { res, body: up } = await upstream("/v1/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": idem },
      body: JSON.stringify({ product_id: Number(product_id), qty: quantity, idempotency_key: idem }),
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
    const { res, body } = await upstream(`/v1/orders?limit=${limit}&offset=${offset}`);
    if (!res.ok) return mapUpstream(res, body);
    return ok({
      orders: pickArray(body).map(normOrder),
      limit,
      offset,
      total: body?.total_orders ?? body?.total ?? null,
    });
  }

  match = path.match(/^\/orders\/([^/]+)$/);
  if (match && m === "GET") {
    if (!authKey(req)) return fail("unauthorized", "api key tidak valid", null, 401);
    const { res, body } = await upstream(`/v1/orders/${match[1]}`);
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
