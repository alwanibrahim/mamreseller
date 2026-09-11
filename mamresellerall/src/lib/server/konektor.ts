// Proxy GET ke konektor milik supplier (server-side, hindari CORS)
import type { Supplier } from "../../features/supplier/server";

export type KonektorResult = {
  ok: boolean;
  status: number | null;
  body: any;
};

export async function konektorGet(s: Supplier, path: string): Promise<KonektorResult> {
  try {
    const res = await fetch(new URL(path, s.base_url), {
      headers: { authorization: `Bearer ${s.api_key}` },
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok && !!body?.success, status: res.status, body };
  } catch {
    return { ok: false, status: null, body: null };
  }
}

export const errMessage = (r: KonektorResult) =>
  r.body?.error?.message ?? `upstream ${r.status ?? "tidak terjangkau"}`;
