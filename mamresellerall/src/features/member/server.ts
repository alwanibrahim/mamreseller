// Member area: data per-supplier (render inkremental) + dompet member
import { Database } from "bun:sqlite";
import { findSupplier } from "../supplier/server";
import { isProductActive, productProfit, sellPrice } from "@/features/products/server";
import { konektorGet } from "@/lib/server/konektor";
import { addTransaction, listMembers, listTransactions, walletBalance } from "@/lib/server/wallet";
import { currentUser } from "@/features/auth/server";
import { findPendingPayment } from "@/features/payment/server";

const db = new Database(process.env.DB_PATH ?? "mamreseller.db", { readonly: true });

const meta = () => ({ supplier: "mamresellerall", timestamp: new Date().toISOString() });
const ok = (data: unknown) => Response.json({ success: true, data, error: null, meta: meta() });
const fail = (code: string, message: string, http = 400) =>
  Response.json({ success: false, data: null, error: { code, message, upstream_status: null }, meta: meta() }, { status: http });
const failBody = (message: string) => ({
  success: false,
  data: null,
  error: { code: "upstream_error", message, upstream_status: null },
  meta: meta(),
});

const activeSupplier = (id: string) => {
  const s = findSupplier(id);
  if (!s) return { error: fail("not_found", "supplier not found", 404) as Response };
  if (!s.active) return { error: fail("supplier_inactive", "supplier is currently inactive", 409) as Response };
  return { supplier: s };
};

export const memberRoutes = {
  "/api/suppliers/:id/products": {
    async GET(req: Bun.BunRequest<"/api/suppliers/:id">) {
      const r1 = activeSupplier(req.params.id);
      if (r1.error) return r1.error;
      const s = r1.supplier;
      const r = await konektorGet(s, "/products");
      if (!r.ok) return Response.json(r.body ?? failBody("supplier unreachable"), { status: r.status ?? 502 });
      const products = (r.body.data.products ?? []).map((p: any) => {
        const profit = productProfit(s.id, String(p.id));
        return {
          ...p,
          supplier_id: s.id,
          supplier_name: s.name,
          active: isProductActive(s.id, String(p.id)),
          profit_percent: profit,
          sell_price: sellPrice(Number(p.price ?? 0), profit),
        };
      });
      return ok({ products });
    },
  },

  "/api/suppliers/:id/balance": {
    async GET(req: Bun.BunRequest<"/api/suppliers/:id">) {
      const r1 = activeSupplier(req.params.id);
      if (r1.error) return r1.error;
      const s = r1.supplier;
      const r = await konektorGet(s, "/balance");
      if (!r.ok) return Response.json(r.body ?? failBody("supplier unreachable"), { status: r.status ?? 502 });
      return ok({ supplier_id: s.id, supplier_name: s.name, currency: r.body.data.currency, balance: r.body.data.balance, status: "up" });
    },
  },

  // Dompet member
  "/api/wallet": {
    async GET(req: Request) {
      const user = currentUser(req);
      if (!user) return fail("unauthorized", "please sign in", 401);
      return ok({
        balance: walletBalance(user.id),
        transactions: listTransactions(user.id),
        pending_payment: pendingView(findPendingPayment(user.id)),
      });
    },
  },

  // ponytail: top up instan tanpa gateway — jalur QRIS di features/payment/server.ts
  "/api/wallet/topup": {
    async POST(req: Request) {
      const user = currentUser(req);
      if (!user) return fail("unauthorized", "please sign in", 401);
      let body: any;
      try { body = await req.json(); } catch { return fail("bad_request", "invalid json body"); }
      const amount = Number(body?.amount);
      if (!Number.isFinite(amount) || amount < 0.1 || amount > 10000)
        return fail("bad_request", "amount must be between 0.1 and 10000 USD");
      if (findPendingPayment(user.id))
        return fail("payment_pending", "pending transaction exists, go to /dashboard/orders to cancel it first", 409);
      const trx = addTransaction(user.id, { type: "topup", amount, description: "Balance top up" });
      return ok({ balance: walletBalance(user.id), transaction: trx });
    },
  },

  // Panel admin: daftar semua member/user + saldo + jumlah order
  "/api/admin/members": {
    async GET(req: Request) {
      const user = currentUser(req);
      if (!user) return fail("unauthorized", "please sign in", 401);
      if (user.role !== "admin") return fail("forbidden", "admin only", 403);
      const members = listMembers().map((m: any) => ({ ...m, balance: Number(m.balance), orders: Number(m.orders) }));
      return ok({ members });
    },
  },

  // Overview member: agregat transaksi milik sendiri (untuk chart /dashboard)
  "/api/member/overview": {
    async GET(req: Request) {
      const user = currentUser(req);
      if (!user) return fail("unauthorized", "please sign in", 401);
      const q = (sql: string) => db.query(sql).all(user.id) as any[];
      const one = (sql: string) => db.query(sql).get(user.id) as any;

      const t = one(
        `SELECT COUNT(*) orders,
                COALESCE(SUM(CASE WHEN type='order' AND amount < 0 THEN -amount ELSE 0 END), 0) spent,
                COALESCE(SUM(CASE WHEN type='topup' THEN amount ELSE 0 END), 0) topup,
                SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) delivered
         FROM transactions WHERE user_id = ?`,
      );
      const orders = Number(t.orders);
      const daily = q(
        `SELECT substr(created_at, 1, 10) AS date,
                COUNT(CASE WHEN type='order' THEN 1 END) AS orders,
                COALESCE(SUM(CASE WHEN type='order' AND amount < 0 THEN -amount ELSE 0 END), 0) AS spend
         FROM transactions
         WHERE user_id = ? AND created_at >= date('now', '-13 days')
         GROUP BY date ORDER BY date`,
      ).map((r) => ({ date: r.date, orders: Number(r.orders), spend: Number(r.spend) }));
      const byProduct = q(
        `SELECT description AS name, COUNT(*) AS orders
         FROM transactions WHERE user_id = ? AND type='order'
         GROUP BY description ORDER BY orders DESC LIMIT 5`,
      ).map((r) => ({ name: r.name, orders: Number(r.orders) }));
      const weekdayRows = q(
        `SELECT CAST(strftime('%w', created_at) AS INTEGER) w, COUNT(*) c
         FROM transactions WHERE user_id = ? AND type='order' GROUP BY w`,
      );
      const wdNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const byWeekday = wdNames.map((day, i) => ({ day, orders: Number(weekdayRows.find((r) => r.w === i)?.c ?? 0) }));

      return ok({
        totals: {
          orders,
          spent: Number(t.spent),
          topup: Number(t.topup),
          balance: walletBalance(user.id),
          fulfillment: orders > 0 ? Math.round((Number(t.delivered) / orders) * 100) : 0,
        },
        daily,
        byProduct,
        byWeekday,
      });
    },
  },
};

function pendingView(p: any) {
  if (!p) return null;
  return {
    id: p.id,
    amount: p.amount,
    amount_idr: p.amount_idr,
    qr_url: p.qr_url,
    checkout_url: p.checkout_url,
    created_at: p.created_at,
  };
}
