// Envelope fetch — kontrak sama dengan ../response.md
export type Envelope<T> = {
  success: boolean;
  data: T;
  error: { code: string; message: string; upstream_status: number | null } | null;
  meta: { supplier: string; currency?: string; timestamp: string };
};

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json()) as Envelope<T>;
  if (!body.success) {
    const e = new Error(body.error?.message ?? `request gagal (${res.status})`) as Error & { code?: string };
    e.code = body.error?.code;
    throw e;
  }
  return body.data;
}

export const post = (path: string, body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
