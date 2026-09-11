// Panel admin overview: agregat dari tabel transactions/users untuk chart
import { Database } from "bun:sqlite";
import { currentUser } from "@/features/auth/server";
import { listAllSuppliers } from "../supplier/server";

const db = new Database(process.env.DB_PATH ?? "mamreseller.db", { readonly: true });

const meta = () => ({ supplier: "mamresellerall", timestamp: new Date().toISOString() });
const ok = (data: unknown) => Response.json({ success: true, data, error: null, meta: meta() });
const fail = (code: string, message: string, http = 400) =>
  Response.json({ success: false, data: null, error: { code, message, upstream_status: null }, meta: meta() }, { status: http });

export const dashboardRoutes = {
  "/api/admin/overview": {
    async GET(req: Request) {
      const user = currentUser(req);
      if (!user) return fail("unauthorized", "please sign in", 401);
      if (user.role !== "admin") return fail("forbidden", "admin only", 403);

      const users = Number((db.query("SELECT COUNT(*) c FROM users").get() as any).c);
      const totals = db
        .query(
          `SELECT COUNT(*) orders,
                  COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) revenue,
                  SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) delivered
           FROM transactions WHERE type = 'order'`,
        )
        .get() as any;

      // volume + jumlah order 14 hari terakhir
      const daily = db
        .query(
          `SELECT substr(created_at, 1, 10) AS date,
                  COUNT(*) AS orders,
                  COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS volume
           FROM transactions
           WHERE type = 'order' AND created_at >= date('now', '-13 days')
           GROUP BY date ORDER BY date`,
        )
        .all()
        .map((r: any) => ({ date: r.date, orders: Number(r.orders), volume: Number(r.volume) }));

      // order per supplier
      const suppliers = listAllSuppliers();
      const nameOf = new Map(suppliers.map((s) => [s.id, s.name]));
      const bySupplier = db
        .query("SELECT supplier_id, COUNT(*) c FROM transactions WHERE type = 'order' AND supplier_id IS NOT NULL GROUP BY supplier_id")
        .all()
        .map((r: any) => ({ name: nameOf.get(r.supplier_id) ?? r.supplier_id, orders: Number(r.c) }))
        .sort((a, b) => b.orders - a.orders);

      // order per hari dalam minggu (Minggu=0) — untuk radar
      const weekdayRows = db
        .query(
          `SELECT CAST(strftime('%w', created_at) AS INTEGER) w, COUNT(*) c
           FROM transactions WHERE type = 'order' GROUP BY w`,
        )
        .all() as any[];
      const wdNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const byWeekday = wdNames.map((day, i) => ({
        day,
        orders: Number(weekdayRows.find((r) => r.w === i)?.c ?? 0),
      }));

      const orders = Number(totals.orders);
      return ok({
        totals: {
          users,
          orders,
          revenue: Number(totals.revenue),
          fulfillment: orders > 0 ? Math.round((Number(totals.delivered) / orders) * 100) : 0,
        },
        daily,
        bySupplier,
        byWeekday,
      });
    },
  },
};
