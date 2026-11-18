export type Me = {
  id: number;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: "admin" | "member";
};

export type MeResult =
  | { kind: "user"; user: Me }
  | { kind: "signed_out" }
  | { kind: "expired" }
  | { kind: "error" };

const INIT: RequestInit = { credentials: "same-origin" };

export async function getMe(): Promise<MeResult> {
  try {
    const res = await fetch("/api/me", INIT);
    if (res.status === 200) return { kind: "user", user: (await res.json()) as Me };
    if (res.status === 401) {
      const body: unknown = await res.json().catch(() => null);
      const detail = (body as { detail?: unknown } | null)?.detail;
      return detail === "session_expired" ? { kind: "expired" } : { kind: "signed_out" };
    }
    return { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

export async function getConfig(): Promise<string | null> {
  try {
    const res = await fetch("/api/config", INIT);
    if (!res.ok) return null;
    const body = (await res.json()) as { allowed_hd?: unknown };
    return typeof body.allowed_hd === "string" ? body.allowed_hd : null;
  } catch {
    return null;
  }
}

export async function getMemberCount(): Promise<number | null> {
  try {
    const res = await fetch("/api/members", INIT);
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return Array.isArray(body) ? body.length : null;
  } catch {
    return null;
  }
}
