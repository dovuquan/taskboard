import type { Role } from "../api";

export type SaveError = "last_admin" | "own_role" | "forbidden" | "expired" | "network" | "server";

export function saveErrorText(kind: SaveError): string {
  switch (kind) {
    case "last_admin":
      return "A workspace needs at least one admin. Make someone else an admin first.";
    case "own_role":
      return "You cannot change your own role";
    case "network":
      return "Can't reach Taskboard. Your change was undone.";
    case "expired":
      return "Your session has ended. Your change was undone; sign in again.";
    case "forbidden":
    case "server":
      return "That did not go through. Your change was undone; try again.";
  }
}

export function roleChangedText(name: string, role: Role): string {
  return `${name} is now ${role === "admin" ? "a workspace admin" : "a workspace member"}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayNumber(d: Date): number {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
}

function shortDate(d: Date, now: Date): string {
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

function dayWord(d: Date, now: Date): string {
  const diff = dayNumber(now) - dayNumber(d);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return shortDate(d, now);
}

export function formatJoined(iso: string, now: Date): string {
  return shortDate(new Date(iso), now);
}

export function formatLastActive(iso: string | null, now: Date): string {
  return iso === null ? "Not yet" : dayWord(new Date(iso), now);
}

export function formatWhen(iso: string, now: Date): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dayWord(d, now)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
