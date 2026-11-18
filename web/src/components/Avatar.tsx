import type { Me } from "../api";

export function initials(user: Pick<Me, "name" | "email">): string {
  const words = (user.name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0][0].toUpperCase();
  return (user.email[0] ?? "?").toUpperCase();
}

export function Avatar({ user }: { user: Pick<Me, "name" | "email"> }) {
  return <span className="avatar">{initials(user)}</span>;
}
