// AutoGopay QRIS payment — top up saldo member
// Spesifikasi: /Users/alwan/Projects/mamresellerall/autogopay.md
import { Database } from "bun:sqlite";
import { timingSafeEqual } from "node:crypto";
import { addTransaction, walletBalance } from "@/lib/server/wallet";
import { currentUser } from "@/features/auth/server";

const db = new Database(process.env.DB_PATH ?? "mamreseller.db");
db.exec(`
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount REAL NOT NULL,
  amount_idr INTEGER NOT NULL,
  payment_transaction_id TEXT,
  payment_order_id TEXT,
  checkout_url TEXT,
  qr_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

const apiKey = () => process.env.AUTOGO_PAY_API_KEY ?? "";
const base = () => process.env.AUTOGO_PAY_BASE_URL ?? "https://v1-gateway.autogopay.site";
const idrRate = () => Number(process.env.SATU_USD_TO_IDR ?? 16000);
const EXPIRY_MS = 10 * 60 * 1000;

const meta = () => ({ supplier: "mamresellerall", timestamp: new Date().toISOString() });
const ok = (data: unknown) => Response.json({ success: true, data, error: null, meta: meta() });
const fail = (code: string, message: string, http = 400) =>
  Response.json({ success: false, data: null, error: { code, message, upstream_status: null }, meta: meta() }, { status: http });

const autoHeaders = () => ({
  authorization: `Bearer ${apiKey()}`,
  accept: "application/json",
  "content-type": "application/json",
});

// unwrap "data.data || data" — API kadang membungkus di data, kadang tidak
function unwrap(body: any) {
  return body?.data?.data ?? body?.data ?? body ?? {};
}

// status mentah → "paid" | "expire" | "pending"
function normalizeStatus(raw: any): "paid" | "expire" | "pending" {
  const s = String(
    raw?.transaction_status ?? raw?.status ?? raw?.data?.transaction_status ?? raw?.data?.status ?? "",
  ).toLowerCase();
  if (["paid", "settlement", "success"].includes(s)) return "paid";
  if (s === "expire" || s === "expired") return "expire";
  return "pending";
}

function findPayment(id: string) {
  return db.query("SELECT * FROM payments WHERE id = ? OR payment_transaction_id = ? OR payment_order_id = ?").get(id, id, id) as any;
}

// pending yang lewat 10 menit dipensiunkan otomatis (tanpa panggil gateway)
export function expireStalePending(userId: string) {
  db.query("UPDATE payments SET status = 'failed', updated_at = ? WHERE user_id = ? AND status = 'pending' AND created_at <= ?")
    .run(new Date().toISOString(), userId, new Date(Date.now() - EXPIRY_MS).toISOString());
}

// hanya boleh ada SATU transaksi pending per user — ponytail: antrian perlu kalau nanti mau multi pending
export function findPendingPayment(userId: string) {
  expireStalePending(userId);
  return db.query("SELECT * FROM payments WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").get(userId) as any;
}

function setPaymentStatus(id: string, status: "success" | "failed") {
  db.query("UPDATE payments SET status = ?, updated_at = ? WHERE id = ?").run(status, new Date().toISOString(), id);
}

// fulfill idempotent — hanya sekali, saat pending → paid
function fulfillIfPending(p: any): boolean {
  if (p.status !== "pending") return false;
  setPaymentStatus(p.id, "success");
  addTransaction(p.user_id, {
    type: "topup",
    amount: p.amount,
    description: `Top up saldo (QRIS ${p.payment_transaction_id ?? "-"})`,
  });
  return true;
}

async function autoPost(path: string, body: unknown) {
  try {
    const res = await fetch(`${base()}${path}`, {
      method: "POST",
      headers: autoHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
    if (!res.ok) console.error("[AutoGopay]", res.status, text.slice(0, 2000));
    return { status: res.status, body: parsed };
  } catch {
    return null; // network error
  }
}

function hmacMatches(payload: string, signature: string, secret: string) {
  const expected = new Bun.CryptoHasher("sha256", secret).update(payload).digest("hex");
  const actual = new TextEncoder().encode(signature);
  const wanted = new TextEncoder().encode(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export const paymentRoutes = {
  // Buat QRIS top up
  "/api/payment/qris": {
    async POST(req: Request) {
      const user = currentUser(req);
      if (!user) return fail("unauthorized", "please sign in", 401);
      if (!apiKey()) return fail("upstream_error", "AutoGopay is not configured", 503);
      let body: any;
      try { body = await req.json(); } catch { return fail("bad_request", "invalid json body"); }
      const amount = Number(body?.amount);
      if (!Number.isFinite(amount) || amount < 0.1 || amount > 10000)
        return fail("bad_request", "amount must be between 0.1 and 10000 USD");
      if (findPendingPayment(user.id))
        return fail("payment_pending", "pending transaction exists, go to /dashboard/orders to cancel it first", 409);
      const amountIdr = Math.round(amount * idrRate());

      const id = `pay_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const now = new Date().toISOString();
      db.query("INSERT INTO payments (id, user_id, amount, amount_idr, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
        .run(id, user.id, amount, amountIdr, "pending", now, now);

      const out = await autoPost("/qris/generate", { amount: amountIdr });
      if (!out) return fail("upstream_error", "gateway unreachable", 502);
      const g = unwrap(out.body);
      if (!g.transaction_id) {
        setPaymentStatus(id, "failed");
        const gwMsg = String(out.body?.message ?? out.body?.error ?? "gagal membuat QRIS");
        return fail("upstream_error", gwMsg, 502);
      }
      db.query("UPDATE payments SET payment_transaction_id = ?, payment_order_id = ?, checkout_url = ?, qr_url = ?, updated_at = ? WHERE id = ?")
        .run(String(g.transaction_id), String(g.order_id ?? ""), String(g.checkout_url ?? ""), String(g.qr_url ?? ""), new Date().toISOString(), id);

      return ok({
        id,
        amount,
        amount_idr: amountIdr,
        qr_url: String(g.qr_url ?? ""),
        checkout_url: String(g.checkout_url ?? ""),
        status: "pending",
      });
    },
  },

  // Polling status (expiry 10 menit dicek dulu, lalu polling AutoGopay)
  "/api/payment/:id/status": {
    async GET(req: Bun.BunRequest<"/api/payment/:id/status">) {
      const user = currentUser(req);
      if (!user) return fail("unauthorized", "please sign in", 401);
      const p = findPayment(req.params.id);
      if (!p || p.user_id !== user.id) return fail("not_found", "payment not found", 404);

      if (p.status !== "pending") {
        return ok({
          status: p.status,
          paymentStatus: p.status === "success" ? "paid" : "expire",
          balance: walletBalance(user.id),
        });
      }

      // expiry 10 menit di sisi app — tanpa panggil AutoGopay
      if (Date.now() - new Date(p.created_at).getTime() >= EXPIRY_MS) {
        setPaymentStatus(p.id, "failed");
        return ok({ status: "failed", paymentStatus: "expire", balance: walletBalance(user.id) });
      }

      const st = await autoPost("/qris/status", { transaction_id: p.payment_transaction_id });
      if (!st || st.status >= 400) return ok({ status: "pending", paymentStatus: "pending" }); // polling gagal → jangan error
      const paymentStatus = normalizeStatus(unwrap(st.body));
      if (paymentStatus === "paid") {
        fulfillIfPending(p);
        return ok({ status: "success", paymentStatus: "paid", balance: walletBalance(user.id) });
      }
      if (paymentStatus === "expire") {
        setPaymentStatus(p.id, "failed");
        return ok({ status: "failed", paymentStatus: "expire", balance: walletBalance(user.id) });
      }
      return ok({ status: "pending", paymentStatus: "pending" });
    },
  },

  // Cancel — hanya untuk pending; error AutoGopay diabaikan
  "/api/payment/:id/cancel": {
    async POST(req: Bun.BunRequest<"/api/payment/:id/cancel">) {
      const user = currentUser(req);
      if (!user) return fail("unauthorized", "please sign in", 401);
      const p = findPayment(req.params.id);
      if (!p || p.user_id !== user.id) return fail("not_found", "payment not found", 404);
      if (p.status !== "pending") return ok({ id: p.id, status: p.status });
      await autoPost("/qris/cancel", { transaction_id: p.payment_transaction_id }).catch(() => undefined);
      setPaymentStatus(p.id, "failed");
      return ok({ id: p.id, status: "failed" });
    },
  },

  // Order Buyer (admin): gabungan top up saldo + order produk semua user
  "/api/admin/order-buyer": {
    async GET(req: Request) {
      const user = currentUser(req);
      if (!user) return fail("unauthorized", "please sign in", 401);
      if (user.role !== "admin") return fail("forbidden", "admin only", 403);
      const rows = db
        .query(
          `SELECT p.created_at AS created_at, u.email AS buyer, 'add_balance' AS kind,
                  p.amount AS amount, p.status AS status, NULL AS mode,
                  NULL AS supplier_txn, p.id AS system_id,
                  NULL AS qty, NULL AS supplier_id, NULL AS product_id,
                  p.payment_transaction_id AS ref, 'Top up saldo (QRIS)' AS description
           FROM payments p JOIN users u ON u.id = p.user_id
           UNION ALL
           SELECT t.created_at, u.email, 'order_product', t.amount, t.status, t.mode,
                  t.order_ref AS supplier_txn, t.id AS system_id,
                  t.qty, t.supplier_id, t.product_id,
                  t.order_ref, t.description
           FROM transactions t JOIN users u ON u.id = t.user_id
           WHERE t.type = 'order'
           ORDER BY created_at DESC LIMIT 200`,
        )
        .all();
      return ok({ rows });
    },
  },

  // Badge sidebar: jumlah order manual yang menunggu admin prosess
  "/api/admin/order-buyer/pending": {
    async GET(req: Request) {
      const user = currentUser(req);
      if (!user) return fail("unauthorized", "please sign in", 401);
      if (user.role !== "admin") return fail("forbidden", "admin only", 403);
      const r = db
        .query("SELECT COUNT(*) AS c FROM transactions WHERE type = 'order' AND mode = 'manual' AND status = 'menunggu admin prosess'")
        .get() as any;
      return ok({ count: Number(r?.c ?? 0) });
    },
  },

  // Ubah status manual oleh admin (order produk / top up saldo)
  "/api/admin/order-buyer/status": {
    async POST(req: Request) {
      const user = currentUser(req);
      if (!user) return fail("unauthorized", "please sign in", 401);
      if (user.role !== "admin") return fail("forbidden", "admin only", 403);
      let body: any;
      try { body = await req.json(); } catch { return fail("bad_request", "invalid json body"); }
      const kind = String(body?.kind ?? "");
      const system_id = String(body?.system_id ?? "");
      const status = String(body?.status ?? "");
      const allowed = ["menunggu admin prosess", "pending", "processing", "delivered", "success", "paid", "failed", "cancelled"];
      if (!allowed.includes(status))
        return fail("bad_request", `status harus salah satu dari: ${allowed.join(", ")}`);
      if (kind === "order_product") {
        const r = db.query("UPDATE transactions SET status = ? WHERE id = ? AND type = 'order'").run(status, system_id);
        if (r.changes === 0) return fail("not_found", "transaksi tidak ditemukan", 404);
        return ok({ kind, system_id, status });
      }
      if (kind === "add_balance") {
        const r = db.query("UPDATE payments SET status = ?, updated_at = ? WHERE id = ?").run(status, new Date().toISOString(), system_id);
        if (r.changes === 0) return fail("not_found", "payment tidak ditemukan", 404);
        return ok({ kind, system_id, status });
      }
      return fail("bad_request", "kind tidak dikenal");
    },
  },

  // Webhook AutoGopay → app. Daftarkan {origin}/api/payment/webhook di dashboard AutoGopay.
  "/api/payment/webhook": {
    async POST(req: Request) {
      const raw = await req.text();
      const signature = req.headers.get("x-signature") ?? "";
      if (!apiKey() || !hmacMatches(raw, signature, apiKey()))
        return Response.json({ error: "Invalid signature" }, { status: 401 });
      let body: any;
      try { body = JSON.parse(raw); } catch { return Response.json({ success: true }); }
      const t = body?.transaction ?? {};
      const p = findPayment(String(t.transaction_id ?? ""));
      if (p && normalizeStatus(t) === "paid") fulfillIfPending(p);
      return Response.json({ success: true });
    },
  },
};
