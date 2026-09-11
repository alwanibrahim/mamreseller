// Balance semua supplier (proxy /balance konektor)
import { listSuppliers } from "../supplier/server";
import { konektorGet } from "@/lib/server/konektor";

export const balanceRoutes = {
  "/api/balances": {
    async GET() {
      const suppliers = listSuppliers();
      const balances = await Promise.all(
        suppliers.map(async (s) => {
          const r = await konektorGet(s, "/balance");
          const status = r.ok ? "up" : "down";
          return {
            supplier_id: s.id,
            supplier_name: s.name,
            currency: r.body?.meta?.currency ?? "USD",
            balance: r.ok ? Number(r.body?.data?.balance ?? 0) : null,
            status,
            error: r.ok ? null : (r.body?.error?.message ?? `upstream ${r.status ?? "tidak terjangkau"}`),
          };
        }),
      );
      return Response.json({ success: true, data: { balances }, error: null, meta: { supplier: "mamresellerall", timestamp: new Date().toISOString() } });
    },
  },
};
