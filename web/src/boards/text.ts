import type { Visibility } from "../api";
import { formatLastActive } from "../members/text";

export function formatUpdated(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ago`;
  return formatLastActive(iso, now);
}

export function memberCountText(n: number): string {
  return n === 1 ? "1 member" : `${n} members`;
}

export function visibilityText(v: Visibility): string {
  return v === "private" ? "Private" : "Workspace";
}

export function workspaceVisibilityText(domain: string | null): string {
  return `Everyone in the ${domain ? `${domain} ` : ""}workspace can open it as an observer. Members and owners are added below.`;
}
