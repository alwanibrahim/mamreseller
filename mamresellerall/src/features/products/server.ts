// Gabungan produk dari semua supplier (proxy /products konektor) + toggle aktif per produk
import { Database } from "bun:sqlite";
import { currentUser } from "@/features/auth/server";
import { listSuppliers } from "../supplier/server";
import { errMessage, konektorGet } from "@/lib/server/konektor";

const db = new Database(process.env.DB_PATH ?? "mamreseller.db");
db.exec(`
CREATE TABLE IF NOT EXISTS product_overrides (
  supplier_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (supplier_id, product_id)
);
`);
// migrasi: kolom profit_percent (abaikan error kalau sudah ada)
try { db.exec("ALTER TABLE product_overrides ADD COLUMN profit_percent REAL NOT NULL DEFAULT 0"); } catch {}

// markup jual per produk: harga member = harga supplier + profit %
export function productProfit(supplierId: string, productId: string): number {
  const r = db.query("SELECT profit_percent FROM product_overrides WHERE supplier_id = ? AND product_id = ?")
    .get(supplierId, productId) as any;
  const n = Number(r?.profit_percent ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function sellPrice(price: number, profitPercent: number): number {
  return Math.round(price * (1 + profitPercent / 100) * 100) / 100;
}

// default aktif — override opsional
export function isProductActive(supplierId: string, productId: string): boolean {
  const r = db.query("SELECT active FROM product_overrides WHERE supplier_id = ? AND product_id = ?")
    .get(supplierId, productId) as any;
  return r ? !!r.active : true;
}

const meta = () => ({ supplier: "mamresellerall", timestamp: new Date().toISOString() });
const ok = (data: unknown) => Response.json({ success: true, data, error: null, meta: meta() });
const fail = (code: string, message: string, http = 400) =>
  Response.json({ success: false, data: null, error: { code, message, upstream_status: null }, meta: meta() }, { status: http });

export const productRoutes = {
  "/api/products": {
    async GET(req: Request) {
      const isAdmin = currentUser(req)?.role === "admin";
      const suppliers = listSuppliers();
      const results = await Promise.all(
        suppliers.map(async (s) => {
          const r = await konektorGet(s, "/products");
          return { s, r };
        }),
      );
      // nama supplier disembunyikan dari member/landing — hanya admin yang lihat
      const strip = (p: any) => (isAdmin ? p : { ...p, supplier_name: undefined });
      const products = results.flatMap(({ s, r }) =>
        r.ok
          ? (r.body?.data?.products ?? []).map((p: any) => {
              const profit = productProfit(s.id, String(p.id));
              return strip({
                ...p,
                supplier_id: s.id,
                supplier_name: s.name,
                active: isProductActive(s.id, String(p.id)),
                profit_percent: profit,
                sell_price: sellPrice(Number(p.price ?? 0), profit),
              });
            })
          : [],
      );
      const failures = results
        .filter(({ r }) => !r.ok)
        .map(({ s, r }) => ({ supplier_id: s.id, supplier_name: s.name, error: errMessage(r) }));
      return Response.json({
        success: true,
        data: { products, failures: isAdmin ? failures : failures.map((f) => ({ error: f.error })) },
        error: null,
        meta: meta(),
      });
    },

    // toggle aktif/nonaktif produk — admin only
    async POST(req: Request) {
      const user = currentUser(req);
      if (!user) return fail("unauthorized", "login dulu", 401);
      if (user.role !== "admin") return fail("forbidden", "khusus admin", 403);
      let body: any;
      try { body = await req.json(); } catch { return fail("bad_request", "body json tidak valid"); }
      const supplier_id = String(body?.supplier_id ?? "");
      const product_id = String(body?.product_id ?? "");
      if (!supplier_id || !product_id) return fail("bad_request", "supplier_id dan product_id wajib");
      const hasActive = typeof body?.active === "boolean";
      const hasProfit = body?.profit_percent !== undefined;
      if (!hasActive && !hasProfit) return fail("bad_request", "active (boolean) atau profit_percent (number) wajib");
      let profit = 0;
      if (hasProfit) {
        profit = Number(body.profit_percent);
        if (!Number.isFinite(profit) || profit < 0 || profit > 1000)
          return fail("bad_request", "profit_percent harus angka 0–1000");
      }
      // pertahankan nilai field yang tidak dikirim
      const existing = db.query("SELECT active, profit_percent FROM product_overrides WHERE supplier_id = ? AND product_id = ?")
        .get(supplier_id, product_id) as any;
      const active = hasActive ? body.active : !existing || !!existing.active;
      if (!hasProfit) profit = Number(existing?.profit_percent ?? 0);
      db.query("INSERT OR REPLACE INTO product_overrides (supplier_id, product_id, active, profit_percent) VALUES (?,?,?,?)")
        .run(supplier_id, product_id, active ? 1 : 0, profit);
      return ok({ supplier_id, product_id, active, profit_percent: profit });
      return ok({ supplier_id, product_id, active: body.active });
    },
  },
};
