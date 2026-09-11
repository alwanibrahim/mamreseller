// Order history gabungan semua supplier (proxy /orders konektor) + aksi beli member (pakai saldo dompet)
import { findSupplier, listSuppliers } from "../supplier/server";
import { errMessage, konektorGet } from "@/lib/server/konektor";
import { currentUser } from "@/features/auth/server";
import { isProductActive, productProfit, sellPrice } from "@/features/products/server";
import { addTransaction, getTransaction, updateTransaction, walletBalance } from "@/lib/server/wallet";
import { findPendingPayment } from "@/features/payment/server";

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

export const orderRoutes = {
  "/api/orders": {
    async GET(req: Bun.BunRequest<"/api/orders">) {
      const url = new URL(req.url);
      let limit = Number(url.searchParams.get("limit") ?? 20);
      let offset = Number(url.searchParams.get("offset") ?? 0);
      if (!Number.isFinite(limit) || limit < 1) limit = 20;
      if (limit > 200) limit = 200;
      if (!Number.isFinite(offset) || offset < 0) offset = 0;

      const suppliers = listSuppliers();
      const results = await Promise.all(
        suppliers.map(async (s) => {
          const r = await konektorGet(s, `/orders?limit=${limit}&offset=${offset}`);
          return { s, r };
        }),
      );
      const orders = results.flatMap(({ s, r }) =>
        r.ok
          ? (r.body?.data?.orders ?? []).map((o: any) => ({
              ...o,
              supplier_id: s.id,
              supplier_name: s.name,
            }))
          : [],
      );
      const failures = results
        .filter(({ r }) => !r.ok)
        .map(({ s, r }) => ({ supplier_id: s.id, supplier_name: s.name, error: errMessage(r) }));
      return Response.json({ success: true, data: { orders, failures, limit, offset }, error: null, meta: meta() });
    },

    // Aksi beli member → proxy POST /orders konektor dengan Idempotency-Key, dibayar dari saldo dompet
    async POST(req: Request) {
      const user = currentUser(req);
      if (!user) return fail("unauthorized", "please sign in", 401);
      let body: any;
      try { body = await req.json(); } catch { return fail("bad_request", "invalid json body"); }
      const s = findSupplier(String(body?.supplier_id ?? ""));
      if (!s) return fail("not_found", "supplier not found", 404);
      if (!s.active) return fail("supplier_inactive", "supplier is currently inactive", 409);
      const product_id = body?.product_id;
      const quantity = Number(body?.quantity ?? 1);
      if (!product_id || !Number.isFinite(quantity) || quantity < 1)
        return fail("bad_request", "product_id and quantity >= 1 are required");
      if (!isProductActive(s.id, String(product_id)))
        return fail("product_inactive", "product is currently inactive", 409);
      if (findPendingPayment(user.id))
        return fail("payment_pending", "pending transaction exists, go to /dashboard/orders to cancel it first", 409);

      // pre-check saldo pakai harga jual produk (harga konektor + profit %)
      const pr = await konektorGet(s, `/products/${encodeURIComponent(String(product_id))}`);
      const basePrice = pr.ok ? Number(pr.body?.data?.product?.price ?? 0) : 0;
      const price = sellPrice(basePrice, productProfit(s.id, String(product_id)));
      const required = price * quantity;
      const saldo = walletBalance(user.id);
      if (saldo < required)
        return fail("insufficient_saldo", `saldo kurang: butuh ${required.toFixed(2)}, saldo ${saldo.toFixed(2)}`, 402);

      // mode: otomatis jika saldo admin di supplier cukup untuk membeli
      const sb = await konektorGet(s, "/balance");
      const supplierBalance = sb.ok ? Number(sb.body?.data?.balance ?? 0) : 0;
      const mode = supplierBalance >= required ? "otomatis" : "manual";

      // ID system = idempotency ke supplier — satu ID untuk dua-duanya, gampang dicocokkan saat error
      const trxId = `trx_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const productName = String(pr.ok ? pr.body?.data?.product?.name ?? product_id : product_id);

      // mode manual → tidak panggil supplier. Order masuk antrean, menunggu admin prosess.
      if (mode === "manual") {
        const trx = addTransaction(user.id, {
          id: trxId,
          type: "order",
          amount: -required,
          description: productName,
          orderRef: null,
          status: "menunggu admin prosess",
          mode: "manual",
          qty: quantity,
          supplierId: s.id,
          productId: String(product_id),
        });
        return ok({
          order: { order_id: trxId, status: "menunggu admin prosess", amount: required, items: [] },
          idempotency_key: trxId,
          saldo: walletBalance(user.id),
          transaction: trx,
          mode,
        });
      }

      try {
        const res = await fetch(new URL("/orders", s.base_url), {
          method: "POST",
          headers: {
            authorization: `Bearer ${s.api_key}`,
            "content-type": "application/json",
            "idempotency-key": trxId,
          },
          body: JSON.stringify({ product_id, quantity }),
          signal: AbortSignal.timeout(30000),
        });
        const up = await res.json().catch(() => null);
        if (!res.ok || !up?.success)
          return Response.json(up ?? failBody("order failed"), { status: res.status || 502 });
        // potong saldo sesuai total yang benar-benar ditarik supplier
        const amount = Number(up.data.order?.amount ?? required);
        const orderStatus = String(up.data.order?.status ?? "delivered");
        const trx = addTransaction(user.id, {
          id: trxId,
          type: "order",
          amount: -amount,
          description: String(up.data.order?.product ?? productName),
          orderRef: String(up.data.order?.order_id ?? up.data.order?.order_code ?? ""),
          status: orderStatus,
          mode,
          qty: quantity,
          supplierId: s.id,
          productId: String(product_id),
        });
        return ok({ order: up.data.order, idempotency_key: trxId, saldo: walletBalance(user.id), transaction: trx });
      } catch {
        return fail("upstream_error", "supplier unreachable", 502);
      }
    },
  },

  // Admin memproses order manual → order ke supplier atas nama member
  "/api/admin/manual-order": {
    async POST(req: Request) {
      const user = currentUser(req);
      if (!user) return fail("unauthorized", "please sign in", 401);
      if (user.role !== "admin") return fail("forbidden", "admin only", 403);
      let body: any;
      try { body = await req.json(); } catch { return fail("bad_request", "invalid json body"); }
      const t = getTransaction(String(body?.transaction_id ?? ""));
      if (!t || t.type !== "order") return fail("not_found", "transaction not found", 404);
      if (t.mode !== "manual" || t.status !== "menunggu admin prosess")
        return fail("bad_request", "this transaction is not a manual order awaiting processing");

      const s = findSupplier(String(t.supplier_id ?? ""));
      if (!s) return fail("not_found", "supplier not found", 404);
      if (!s.active) return fail("supplier_inactive", "supplier is currently inactive", 409);

      // cek saldo admin di supplier — cukup baru konfirmasi
      const sb = await konektorGet(s, "/balance");
      const supplierBalance = sb.ok ? Number(sb.body?.data?.balance ?? 0) : 0;
      const total = Math.abs(Number(t.amount));
      if (supplierBalance < total)
        return fail(
          "insufficient_supplier_balance",
          `insufficient balance: supplier has ${supplierBalance.toFixed(2)}, needs ${total.toFixed(2)} — please deposit`,
          402,
        );

      try {
        const res = await fetch(new URL("/orders", s.base_url), {
          method: "POST",
          headers: {
            authorization: `Bearer ${s.api_key}`,
            "content-type": "application/json",
            "idempotency-key": t.id,
          },
          body: JSON.stringify({ product_id: t.product_id, quantity: t.qty ?? 1 }),
          signal: AbortSignal.timeout(30000),
        });
        const up = await res.json().catch(() => null);
        if (!res.ok || !up?.success)
          return Response.json(up ?? failBody("order failed"), { status: res.status || 502 });
        const o = up.data?.order ?? up.data ?? up;
        const amount = Number(o.amount ?? total);
        updateTransaction(t.id, {
          status: String(o.status ?? "processing"),
          orderRef: String(o.order_id ?? o.order_code ?? `manual-${t.id}`),
          amount: -amount,
        });
        return ok({ transaction: getTransaction(t.id), order: o });
      } catch {
        return fail("upstream_error", "supplier unreachable", 502);
      }
    },
  },

  // Order Reseller (admin): order selesai (delivered) dari semua supplier via GET /orders
  "/api/admin/order-reseller": {
    async GET(req: Request) {
      const user = currentUser(req);
      if (!user) return fail("unauthorized", "please sign in", 401);
      if (user.role !== "admin") return fail("forbidden", "admin only", 403);
      const suppliers = listSuppliers();
      const results = await Promise.all(
        suppliers.map(async (s) => ({
          s,
          r: await konektorGet(s, "/orders?limit=100&offset=0"),
          pr: await konektorGet(s, "/products"),
        })),
      );
      const orders = results.flatMap(({ s, r, pr }) => {
        if (!r.ok) return [];
        // map id + nama → produk supplier, untuk resolusi nama + data detail
        const byId = new Map<string, any>();
        const byName = new Map<string, any>();
        for (const p of pr.ok ? (pr.body?.data?.products ?? []) : []) {
          byId.set(String(p.id), p);
          byName.set(String(p.name).trim().toLowerCase(), p);
        }
        return (r.body?.data?.orders ?? [])
          .map((o: any) => {
            const prod =
              byId.get(String(o.product_id ?? "")) ??
              byId.get(String(o.product_name ?? "")) ??
              byName.get(String(o.product_name ?? o.product ?? "").trim().toLowerCase()) ??
              null;
            return {
              supplier_name: s.name,
              supplier_id: s.id,
              product: String(prod?.name ?? o.product_name ?? o.product ?? ""),
              qty: o.quantity,
              amount: o.amount,
              status: o.status,
              supplier_txn: o.order_id,
              created_at: o.created_at,
              product_data: prod,
              items: Array.isArray(o.items) ? o.items.map(String) : [],
            };
          });
      });
      const failures = results
        .filter(({ r }) => !r.ok)
        .map(({ s, r }) => ({ supplier_name: s.name, error: errMessage(r) }));
      return ok({ orders, failures });
    },
  },

  // Data delivery satu order (lazy — untuk modal Detail, mis. qamify yang tak memuat items di list)
  "/api/order-delivery": {
    async GET(req: Bun.BunRequest<"/api/order-delivery">) {
      const user = currentUser(req);
      if (!user) return fail("unauthorized", "please sign in", 401);
      const url = new URL(req.url);
      const t = getTransaction(url.searchParams.get("trx") ?? "");
      if (!t || t.user_id !== user.id) return fail("not_found", "transaction not found", 404);
      if (t.type !== "order" || !t.supplier_id || !t.order_ref)
        return fail("bad_request", "not an order with delivery data");
      const s = findSupplier(t.supplier_id);
      if (!s) return fail("not_found", "supplier not found", 404);
      if (!s.active) return fail("supplier_inactive", "supplier is currently inactive", 409);
      const r = await konektorGet(s, `/orders/${encodeURIComponent(t.order_ref)}`);
      if (!r.ok) return Response.json(r.body ?? failBody("order not found"), { status: r.status ?? 502 });
      const order = r.body?.data?.order ?? {};
      return ok({ items: Array.isArray(order.items) ? order.items.map(String) : [] });
    },
  },

  "/api/admin/order-delivery": {
    async GET(req: Bun.BunRequest<"/api/admin/order-delivery">) {
      const user = currentUser(req);
      if (!user) return fail("unauthorized", "please sign in", 401);
      if (user.role !== "admin") return fail("forbidden", "admin only", 403);
      const url = new URL(req.url);
      const s = findSupplier(url.searchParams.get("supplier_id") ?? "");
      if (!s) return fail("not_found", "supplier not found", 404);
      if (!s.active) return fail("supplier_inactive", "supplier is currently inactive", 409);
      const txn = url.searchParams.get("txn") ?? "";
      if (!txn) return fail("bad_request", "txn is required");
      const r = await konektorGet(s, `/orders/${encodeURIComponent(txn)}`);
      if (!r.ok) return Response.json(r.body ?? failBody("order not found"), { status: r.status ?? 502 });
      const order = r.body?.data?.order ?? {};
      return ok({ items: Array.isArray(order.items) ? order.items.map(String) : [] });
    },
  },
};
