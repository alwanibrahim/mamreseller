import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch, post } from "@/lib/api";
import { useProductsIncremental } from "../hooks/useProductsIncremental";

const PAGE_SIZE = 10;
const fmtUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// daftar nomor halaman dengan "…" di tengah, mis. 1 2 3 … 8
function pageItems(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set(
    [1, total, current - 1, current, current + 1].filter((p) => p >= 1 && p <= total),
  );
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | "ellipsis")[] = [];
  let prev: number | null = null;
  for (const p of sorted) {
    if (prev !== null && p - prev > 1) out.push("ellipsis");
    out.push(p);
    prev = p;
  }
  return out;
}

export function ProductPage() {
  const { products, loadingCount, failures, error, reload } = useProductsIncremental();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [toggling, setToggling] = useState<string | null>(null);

  async function toggleActive(p: { supplier_id: string; id: string; active: boolean }) {
    setToggling(`${p.supplier_id}-${p.id}`);
    try {
      await apiFetch("/api/products", post("/api/products", { supplier_id: p.supplier_id, product_id: p.id, active: !p.active }));
      await reload();
    } finally {
      setToggling(null);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      [p.name, p.id, p.supplier_name].some((v) => v.toLowerCase().includes(q)),
    );
  }, [products, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => {
    setPage(1);
  }, [query]);
  const current = Math.min(page, totalPages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>Product</CardTitle>
            <CardDescription>
              Semua produk dari semua supplier.
              {loadingCount > 0 && ` Memuat ${loadingCount} supplier...`}
            </CardDescription>
          </div>
          <button
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => void reload()}
          >
            Refresh
          </button>
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari nama produk, id, atau supplier..."
          className="max-w-sm"
        />
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {failures.map((f) => (
          <p key={f.supplier_name} className="text-sm text-destructive">
            {f.supplier_name}: {f.error}
          </p>
        ))}
        <p className="text-sm text-muted-foreground">
          {filtered.length} produk
          {query.trim() && ` (difilter dari ${products.length})`}
        </p>
        {rows.length === 0 && products.length === 0 && loadingCount === 0 && (
          <p className="text-sm text-muted-foreground">Tidak ada produk.</p>
        )}
        {rows.length === 0 && products.length > 0 && (
          <p className="text-sm text-muted-foreground">Tidak ada produk yang cocok.</p>
        )}
        {rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Harga</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Orderable</TableHead>
                <TableHead>Aktif</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={`${p.supplier_id}-${p.id}`}>
                  <TableCell>
                    <Badge variant="secondary">{p.supplier_name}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">
                    {p.name}
                    {p.description && (
                      <span className="block max-w-md truncate text-xs text-muted-foreground">
                        {p.description}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{fmtUSD.format(p.price)}</TableCell>
                  <TableCell>{p.stock === -1 ? "service" : p.stock}</TableCell>
                  <TableCell className="text-right">
                    {p.orderable ? <Badge>ya</Badge> : <Badge variant="secondary">tidak</Badge>}
                  </TableCell>
                  <TableCell>
                    {p.active === false ? <Badge variant="secondary">inactive</Badge> : <Badge>active</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={toggling === `${p.supplier_id}-${p.id}`}
                      onClick={() => void toggleActive(p)}
                    >
                      {toggling === `${p.supplier_id}-${p.id}` ? "..." : p.active === false ? "Aktifkan" : "Nonaktifkan"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {totalPages > 1 && (
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setPage(Math.max(1, current - 1));
                  }}
                  aria-disabled={current === 1}
                  className={current === 1 ? "pointer-events-none opacity-50" : undefined}
                />
              </PaginationItem>
              {pageItems(current, totalPages).map((item, i) =>
                item === "ellipsis" ? (
                  <PaginationItem key={`e${i}`} className="px-2 text-sm text-muted-foreground">
                    …
                  </PaginationItem>
                ) : (
                  <PaginationItem key={item}>
                    <PaginationLink
                      href="#"
                      isActive={item === current}
                      onClick={(e) => {
                        e.preventDefault();
                        setPage(item);
                      }}
                    >
                      {item}
                    </PaginationLink>
                  </PaginationItem>
                ),
              )}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setPage(Math.min(totalPages, current + 1));
                  }}
                  aria-disabled={current === totalPages}
                  className={current === totalPages ? "pointer-events-none opacity-50" : undefined}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </CardContent>
    </Card>
  );
}
