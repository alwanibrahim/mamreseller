// Server-side fitur supplier — SQLite + proxy ping ke konektor
import { Database } from "bun:sqlite";

const db = new Database(process.env.DB_PATH ?? "mamreseller.db");
db.exec(`
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  last_ping_status TEXT,
  last_ping_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
`);
// migrasi DB lama yang belum punya kolom active
try {
  db.exec("ALTER TABLE suppliers ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
} catch {
  // kolom sudah ada
}

const meta = () => ({ supplier: "mamresellerall", timestamp: new Date().toISOString() });
const ok = (data: unknown) => Response.json({ success: true, data, error: null, meta: meta() });
const fail = (code: string, message: string, http = 400) =>
  Response.json({ success: false, data: null, error: { code, message, upstream_status: null }, meta: meta() }, { status: http });

type Supplier = {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  last_ping_status: string | null;
  last_ping_at: string | null;
  active: number;
  created_at: string;
};

// hanya supplier aktif — dipakai endpoint produk/balance/order
const list = () => db.query("SELECT * FROM suppliers WHERE active = 1 ORDER BY created_at DESC").all() as Supplier[];
export const listSuppliers = list;
// semua termasuk nonaktif — untuk tabel admin
export const listAllSuppliers = () => db.query("SELECT * FROM suppliers ORDER BY created_at DESC").all() as Supplier[];
const find = (id: string) => db.query("SELECT * FROM suppliers WHERE id = ?").get(id) as Supplier | undefined;
export const findSupplier = find;
export type { Supplier };

async function ping(s: Supplier) {
  try {
    const res = await fetch(new URL("/ping", s.base_url), {
      headers: { authorization: `Bearer ${s.api_key}` },
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => null);
    const status = res.ok && body?.success && body?.data?.status === "up" ? "up" : "down";
    return { status, http_status: res.status };
  } catch {
    return { status: "down", http_status: null };
  }
}

export const supplierRoutes = {
  "/api/suppliers": {
    async GET() {
      // semua supplier (termasuk nonaktif) — tabel admin; konsumen produk memfilter active
      return ok({ suppliers: listAllSuppliers().map((s) => ({ ...s, active: !!s.active })) });
    },
    async POST(req: Request) {
      let body: any;
      try { body = await req.json(); } catch { return fail("bad_request", "body json tidak valid"); }
      const name = String(body?.name ?? "").trim();
      let baseUrl = String(body?.baseUrl ?? "").trim().replace(/\/+$/, "");
      const apiKey = String(body?.apiKey ?? "").trim();
      if (!name || !baseUrl || !apiKey) return fail("bad_request", "nama, baseUrl, apiKey wajib diisi");
      if (!/^https?:\/\//.test(baseUrl)) return fail("bad_request", "baseUrl harus diawali http:// atau https://");
      const id = `sup_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      db.query("INSERT INTO suppliers (id, name, base_url, api_key, created_at) VALUES (?,?,?,?,?)")
        .run(id, name, baseUrl, apiKey, new Date().toISOString());
      return ok({ supplier: find(id) });
    },
  },

  "/api/suppliers/:id": {
    async PATCH(req: Bun.BunRequest<"/api/suppliers/:id">) {
      const id = req.params.id;
      if (!find(id)) return fail("not_found", `supplier ${id} tidak ada`, 404);
      let body: any;
      try { body = await req.json(); } catch { return fail("bad_request", "body json tidak valid"); }
      if (typeof body?.active !== "boolean") return fail("bad_request", "active wajib boolean");
      db.query("UPDATE suppliers SET active = ? WHERE id = ?").run(body.active ? 1 : 0, id);
      return ok({ id, active: body.active });
    },
    async DELETE(req: Bun.BunRequest<"/api/suppliers/:id">) {
      const id = req.params.id;
      if (!find(id)) return fail("not_found", `supplier ${id} tidak ada`, 404);
      db.query("DELETE FROM suppliers WHERE id = ?").run(id);
      return ok({ id, deleted: true });
    },
  },

  "/api/suppliers/:id/ping": {
    async GET(req: Bun.BunRequest<"/api/suppliers/:id">) {
      const id = req.params.id;
      const s = find(id);
      if (!s) return fail("not_found", `supplier ${id} tidak ada`, 404);
      const { status, http_status } = await ping(s);
      const at = new Date().toISOString();
      db.query("UPDATE suppliers SET last_ping_status = ?, last_ping_at = ? WHERE id = ?").run(status, at, id);
      return ok({ id, status, http_status, checked_at: at });
    },
  },
};
