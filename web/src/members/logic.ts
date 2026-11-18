import type { ListResult, Me, Member, Refusal, Role, RoleResult } from "../api";
import { roleChangedText, saveErrorText } from "./text";

export type MembersState = "denied" | "loading" | "network" | "server" | "ready";

export type MembersApi = {
  getMembers: () => Promise<ListResult<Member[]>>;
  getRefused: () => Promise<ListResult<Refusal[]>>;
  setMemberRole: (id: number, role: Role) => Promise<RoleResult>;
};

export type LoadOutcome =
  | { expired: true }
  | { expired: false; state: MembersState; rows: Member[]; refused: Refusal[] };

export type SaveOutcome = {
  rows: Member[];
  message: string | null;
  expired: boolean;
  denied: boolean;
};

/** Only admins fetch the list and the feed; everyone else gets the explanation state. */
export function shouldLoad(me: Me): boolean {
  return me.role === "admin";
}

export async function loadMembers(api: MembersApi): Promise<LoadOutcome> {
  const [m, r] = await Promise.all([api.getMembers(), api.getRefused()]);
  if (m.kind === "expired" || r.kind === "expired") return { expired: true };
  if (m.kind === "ok" && r.kind === "ok") {
    return { expired: false, state: "ready", rows: m.data, refused: r.data };
  }
  // A 403 means the admin was demoted since the page loaded.
  const state: MembersState =
    m.kind === "forbidden" || r.kind === "forbidden"
      ? "denied"
      : m.kind === "network" || r.kind === "network"
        ? "network"
        : "server";
  return { expired: false, state, rows: [], refused: [] };
}

/** Wait for the server; only a success changes the rows. */
export async function saveRole(
  api: MembersApi,
  rows: Member[],
  id: number,
  role: Role,
): Promise<SaveOutcome> {
  const res = await api.setMemberRole(id, role);
  if (res.kind === "ok") {
    return {
      rows: rows.map((r) => (r.id === id ? res.data : r)),
      message: roleChangedText(res.data.name ?? res.data.email, res.data.role),
      expired: false,
      denied: false,
    };
  }
  if (res.kind === "expired") return { rows, message: null, expired: true, denied: false };
  if (res.kind === "forbidden") return { rows, message: null, expired: false, denied: true };
  return { rows, message: saveErrorText(res.kind), expired: false, denied: false };
}
