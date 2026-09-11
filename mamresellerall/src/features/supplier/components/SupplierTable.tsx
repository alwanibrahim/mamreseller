import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Supplier } from "../hooks/useSuppliers";

type Props = {
  suppliers: Supplier[];
  onPing: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggle: (id: string, active: boolean) => Promise<void>;
};

const maskKey = (k: string) => (k.length > 16 ? `${k.slice(0, 12)}…${k.slice(-4)}` : k);

export function SupplierTable({ suppliers, onPing, onDelete, onToggle }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  async function run(id: string, action: "ping" | "delete" | "activate" | "deactivate") {
    setBusy(id);
    try {
      if (action === "ping") await onPing(id);
      else if (action === "delete") {
        if (window.confirm("Hapus supplier ini?")) await onDelete(id);
      } else await onToggle(id, action === "activate");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nama</TableHead>
          <TableHead>Base URL</TableHead>
          <TableHead>API Key</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Dites</TableHead>
          <TableHead>Aktif</TableHead>
          <TableHead className="text-right">Aksi</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {suppliers.map((s) => (
          <TableRow key={s.id}>
            <TableCell className="font-medium">{s.name}</TableCell>
            <TableCell className="font-mono text-xs">{s.base_url}</TableCell>
            <TableCell className="font-mono text-xs">{maskKey(s.api_key)}</TableCell>
            <TableCell>
              {s.last_ping_status === "up" && <Badge>up</Badge>}
              {s.last_ping_status === "down" && <Badge variant="destructive">down</Badge>}
              {s.last_ping_status !== "up" && s.last_ping_status !== "down" && (
                <Badge variant="secondary">belum dites</Badge>
              )}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {s.last_ping_at ? new Date(s.last_ping_at).toLocaleString() : "—"}
            </TableCell>
            <TableCell>
              {s.active ? <Badge>active</Badge> : <Badge variant="secondary">inactive</Badge>}
            </TableCell>
            <TableCell className="space-x-2 text-right">
              <Button variant="outline" size="sm" disabled={busy === s.id} onClick={() => run(s.id, "ping")}>
                {busy === s.id ? "..." : "Test"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy === s.id}
                onClick={() => run(s.id, s.active ? "deactivate" : "activate")}
              >
                {s.active ? "Nonaktifkan" : "Aktifkan"}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy === s.id}
                onClick={() => run(s.id, "delete")}
              >
                Hapus
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
