import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBalancesIncremental } from "../hooks/useBalancesIncremental";

const fmt = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
const fmtUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function BalancePage() {
  const { sections, pending, error, reload } = useBalancesIncremental();
  const loaded = sections.filter((s) => s.status === "ok" && s.balance);
  const total = loaded.reduce((acc, s) => acc + (s.balance!.balance ?? 0), 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Balance</CardTitle>
          <CardDescription>
            Balance semua api reseller.
            {pending.length > 0 && ` Memuat ${pending.length} supplier...`}
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
        {sections.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Balance</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sections.map((s) => (
                <TableRow key={s.supplierId}>
                  <TableCell>
                    <Badge variant="secondary">{s.supplierName}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">
                    {s.status === "ok" && s.balance?.balance != null
                      ? fmt(s.balance.balance, s.balance.currency)
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {s.status === "ok" ? (
                      <Badge>up</Badge>
                    ) : (
                      <Badge variant="destructive" title={s.error ?? undefined}>
                        down
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {sections.length === 0 && pending.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Memuat: {pending.join(", ")}
          </p>
        )}
        {pending.length > 0 && sections.length > 0 && (
          <p className="text-xs text-muted-foreground">Masih memuat: {pending.join(", ")}</p>
        )}
        {loaded.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Total: <span className="font-medium text-foreground">{fmtUSD.format(total)}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
