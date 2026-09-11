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
          ? (r.body?.data?.products ?? []).map((p: any) =>
              strip({
                ...p,
                supplier_id: s.id,
                supplier_name: s.name,
                active: isProductActive(s.id, String(p.id)),
              }),
            )
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
      if (typeof body?.active !== "boolean") return fail("bad_request", "active wajib boolean");
      db.query("INSERT OR REPLACE INTO product_overrides (supplier_id, product_id, active) VALUES (?,?,?)")
        .run(supplier_id, product_id, body.active ? 1 : 0);
      return ok({ supplier_id, product_id, active: body.active });
    },
  },
};
