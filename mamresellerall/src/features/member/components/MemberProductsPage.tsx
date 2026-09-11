import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useProductsIncremental } from "@/features/products/hooks/useProductsIncremental";
import { useBalancesIncremental } from "@/features/balance/hooks/useBalancesIncremental";
import { MemberBuyDialog } from "./MemberBuyDialog";

const fmtUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function MemberProductsPage() {
  const { products, loadingCount, failures, error } = useProductsIncremental();
  // saldo admin di sisi supplier (API reseller GET /balance) — pembanding mode
  const { sections: balanceSections } = useBalancesIncremental();
  const [query, setQuery] = useState("");

  const balanceBySupplier = useMemo(() => {
    const m = new Map<string, { status: "loading" | "ok" | "error"; value: number | null }>();
    for (const s of balanceSections)
      m.set(s.supplierId, { status: s.status, value: s.balance?.balance ?? null });
    return m;
  }, [balanceSections]);

  const filtered = useMemo(() => {
    const visible = products.filter((p) => p.active !== false);
    const q = query.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter((p) =>
      [p.name, p.id, p.description ?? ""].some((v) => v.toLowerCase().includes(q)),
    );
  }, [products, query]);

  // otomatis jika saldo supplier (admin) cukup untuk harga produk; selain itu manual
  const modeOf = (p: { supplier_id: string; price: number }): "loading" | "otomatis" | "manual" | "unknown" => {
    const b = balanceBySupplier.get(p.supplier_id);
    if (!b || b.status === "loading") return "loading";
    if (b.status === "error" || b.value === null) return "unknown";
    return Number(b.value) >= Number(p.price) ? "otomatis" : "manual";
  };

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="space-y-1.5">
          <CardTitle>Products</CardTitle>
          <CardDescription>
            Available products.{loadingCount > 0 && " Loading..."}
          </CardDescription>
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search product name or id..."
          className="max-w-sm"
        />
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {failures.length > 0 && (
          <p className="text-sm text-destructive">Some products failed to load — try refreshing.</p>
        )}
        <p className="text-sm text-muted-foreground">
          {filtered.length} products
          {query.trim() && ` (filtered from ${products.length})`}
        </p>
        {filtered.length === 0 && (products.filter((p) => p.active !== false).length === 0) && loadingCount === 0 && (
          <p className="text-sm text-muted-foreground">No products.</p>
        )}
        {filtered.length === 0 && products.length > 0 && (
          <p className="text-sm text-muted-foreground">No matching products.</p>
        )}
        {filtered.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => {
                const mode = modeOf(p);
                return (
                  <TableRow key={`${p.supplier_id}-${p.id}`}>
                    <TableCell className="font-medium">
                      <HoverCard openDelay={200} closeDelay={100}>
                        <HoverCardTrigger asChild>
                          <span className="cursor-help underline decoration-dotted underline-offset-4">
                            {p.name}
                          </span>
                        </HoverCardTrigger>
                        <HoverCardContent className="w-80">
                          <div className="space-y-2">
                            <p className="text-sm font-semibold">{p.name}</p>
                            <p className="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
                              {p.description ?? "No description."}
                            </p>
                            <p className="text-xs">
                              Price {fmtUSD.format(p.price)} · stock {p.stock === -1 ? "service" : p.stock}
                            </p>
                          </div>
                        </HoverCardContent>
                      </HoverCard>
                    </TableCell>
                    <TableCell>{fmtUSD.format(p.price)}</TableCell>
                    <TableCell>{p.stock === -1 ? "service" : p.stock}</TableCell>
                    <TableCell>
                      {mode === "loading" ? (
                        <Skeleton className="h-5 w-16" />
                      ) : mode === "otomatis" ? (
                        <Badge>auto</Badge>
                      ) : mode === "manual" ? (
                        <Badge variant="secondary">manual</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <MemberBuyDialog product={p} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
