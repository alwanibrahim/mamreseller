import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

const fmtUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

type Row = {
  created_at: string;
  buyer: string;
  kind: "add_balance" | "order_product";
  amount: number;
  status: string | null;
  mode: string | null;
  supplier_txn: string | null;
  system_id: string;
  qty: number | null;
  supplier_id: string | null;
  product_id: string | null;
  description: string;
};

export function AdminOrderBuyerPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<Row | null>(null);
  const [supplierBalance, setSupplierBalance] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const d = await apiFetch<{ rows: Row[] }>("/api/admin/order-buyer");
      setRows(d.rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "gagal memuat data");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // buka modal Buy: ambil saldo admin di supplier terkait
  async function openBuy(r: Row) {
    setProcessing(r);
    setSupplierBalance(null);
    setModalError(null);
    try {
      const d = await apiFetch<{ balance: number }>(`/api/suppliers/${r.supplier_id}/balance`);
      setSupplierBalance(d.balance);
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "gagal mengambil saldo supplier");
    }
  }

  const total = processing ? Math.abs(Number(processing.amount)) : 0;
  const cukup = supplierBalance !== null && supplierBalance >= total;

  async function confirmProcess() {
    if (!processing) return;
    setConfirming(true);
    setModalError(null);
    try {
      await apiFetch("/api/admin/manual-order", post("/api/admin/manual-order", { transaction_id: processing.system_id }));
      setProcessing(null);
      await reload();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "gagal memproses order");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Order Buyer</CardTitle>
            <CardDescription>
              Top up saldo dan order produk dari semua buyer. Order manual menunggu proses kamu.
            </CardDescription>
          </div>
          <button
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => void reload()}
          >
            Refresh
          </button>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!rows && !error && (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          )}
          {rows && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">Belum ada aktivitas buyer.</p>
          )}
          {rows && rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Keterangan</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Transaksi ID Supplier</TableHead>
                  <TableHead>ID System</TableHead>
                  <TableHead>Waktu</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const pendingManual =
                    r.kind === "order_product" && r.mode === "manual" && r.status === "menunggu admin prosess";
                  return (
                    <TableRow key={`${r.kind}-${r.system_id}`}>
                      <TableCell className="text-xs">{r.buyer}</TableCell>
                      <TableCell>
                        {r.kind === "add_balance" ? (
                          <Badge>add balance</Badge>
                        ) : (
                          <Badge variant="secondary">order product</Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs truncate font-medium">{r.description}</TableCell>
                      <TableCell>{r.qty ?? "—"}</TableCell>
                      <TableCell className={r.amount >= 0 ? "font-medium" : "font-medium text-destructive"}>
                        {r.amount >= 0 ? "+" : ""}
                        {fmtUSD.format(r.amount)}
                      </TableCell>
                      <TableCell>
                        {r.status === "menunggu admin prosess" ? (
                          <Badge className="bg-amber-500 text-white">menunggu admin prosess</Badge>
                        ) : statusBadge(r.status)}
                      </TableCell>
                      <TableCell>
                        {r.mode ? (
                          r.mode === "otomatis" ? (
                            <Badge>otomatis</Badge>
                          ) : (
                            <Badge variant="secondary">manual</Badge>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.status === "menunggu admin prosess" ? "—" : (r.supplier_txn ?? "—")}
                      </TableCell>                      <TableCell className="font-mono text-xs">{r.system_id}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="space-x-2 text-right">
                        {pendingManual && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => void openBuy(r)}>
                              Buy
                            </Button>
                            <Button asChild size="sm">
                              <Link to="/dashboard/admin/balance">Deposite</Link>
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Modal overview order manual */}
      <Dialog open={!!processing} onOpenChange={(v) => !v && setProcessing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Memproses order manual</DialogTitle>
            <DialogDescription>Periksa detail sebelum mengorderkan ke supplier.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <p>
              Saldo anda pada supplier ini:{" "}
              {supplierBalance === null ? (
                <Skeleton className="inline-block h-4 w-16" />
              ) : (
                <span className="font-medium">{fmtUSD.format(supplierBalance)}</span>
              )}
            </p>
            <p>
              Member order product ini:{" "}
              <span className="font-medium">{processing?.description}</span>
            </p>
            <p>
              Dengan qty: <span className="font-medium">{processing?.qty ?? "—"}</span>
            </p>
            <p>
              Total: <span className="font-medium">{fmtUSD.format(total)}</span>
            </p>
            <p className="text-muted-foreground">
              Keterangan:{" "}
              {cukup ? (
                <span className="font-medium">saldo cukup, silahkan konfirmasi</span>
              ) : supplierBalance === null ? (
                "mengambil saldo supplier..."
              ) : (
                <span className="font-medium text-destructive">
                  saldo tidak cukup, silahkan klik action deposite
                </span>
              )}
            </p>
          </div>
          {modalError && <p className="text-sm text-destructive">{modalError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setProcessing(null)}>
              Tutup
            </Button>
            {cukup && (
              <Button onClick={() => void confirmProcess()} disabled={confirming}>
                {confirming ? "Memproses..." : "Konfirmasi Order"}
              </Button>
            )}
            {!cukup && supplierBalance !== null && (
              <Button asChild>
                <Link to="/dashboard/admin/balance">Deposite</Link>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function statusBadge(status: string | null) {
  switch (status) {
    case "success":
    case "delivered":
    case "paid":
      return <Badge>{status}</Badge>;
    case "pending":
    case "processing":
      return <Badge variant="secondary">{status}</Badge>;
    case "failed":
    case "cancelled":
      return <Badge variant="destructive">{status}</Badge>;
    default:
      return <span className="text-xs text-muted-foreground">—</span>;
  }
}
