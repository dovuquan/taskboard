import type { EventEntry } from "../api";
import { formatDue } from "./due";

/** What the activity sentences need to name a list or a person. */
export type ActivityContext = {
  lists: { id: number; name: string }[];
  people: { id: number; name: string | null; email: string }[];
};

/** The feed starts with this many entries until the person asks for all of them. */
export const FEED_FIRST = 4;

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** Who did it: their name, "someone" when they have none, "Taskboard" for a change with no actor. */
export function actorName(entry: EventEntry): string {
  if (!entry.actor) return "Taskboard";
  return str(entry.actor.name) ?? "someone";
}

function dayText(day: unknown): string | null {
  const text = str(day);
  return text === null ? null : formatDue(text);
}

/**
 * The sentence for one activity entry, without the actor ("moved this card from To do to Doing").
 * Anything missing from the data falls back to general words, so an odd entry never breaks the feed.
 */
export function activityText(entry: EventEntry, ctx: ActivityContext): string {
  const d = entry.data;
  const list = (id: unknown) => ctx.lists.find((l) => l.id === id)?.name ?? "another list";
  const person = (id: unknown) => {
    const p = ctx.people.find((x) => x.id === id);
    return p ? (str(p.name) ?? p.email) : "someone";
  };
  const item = str(d.text) ?? "an item";
  switch (entry.kind) {
    case "card.created":
      return `created this card in ${list(d.list_id)}`;
    case "card.moved":
      return `moved this card from ${list(d.from_list_id)} to ${list(d.to_list_id)}`;
    case "card.copied":
      return `copied this card from ${str(d.from_key) ?? "another card"}`;
    case "card.renamed":
      return `renamed this card from ${str(d.from) ?? "its old title"} to ${str(d.to) ?? "a new title"}`;
    case "card.described":
      return d.cleared === true ? "cleared the description" : "changed the description";
    case "card.due_changed": {
      const to = dayText(d.to);
      if (to === null) return "cleared the due date";
      return dayText(d.from) === null ? `set the due date to ${to}` : `changed the due date to ${to}`;
    }
    case "card.member_added":
      return `added ${person(d.user_id)} to this card`;
    case "card.member_removed":
      return `removed ${person(d.user_id)} from this card`;
    case "card.label_added":
      return `added the label ${str(d.name) ?? "a label"}`;
    case "card.label_removed":
      return `removed the label ${str(d.name) ?? "a label"}`;
    case "checklist.item_added":
      return `added ${item} to the checklist`;
    case "checklist.item_checked":
      return `checked ${item}`;
    case "checklist.item_unchecked":
      return `unchecked ${item}`;
    case "checklist.item_deleted":
      return `deleted ${item} from the checklist`;
    case "checklist.item_restored":
      return `restored ${item} to the checklist`;
    default:
      return "changed this card";
  }
}

/** True while the server's edit deadline is still ahead of `now` (milliseconds). */
export function canChangeComment(editableUntil: string | null, now: number): boolean {
  if (editableUntil === null) return false;
  const until = Date.parse(editableUntil);
  return !Number.isNaN(until) && until > now;
}

/** The first four entries, or all of them. */
export function shownEntries<T>(entries: T[], all: boolean): T[] {
  return all ? entries : entries.slice(0, FEED_FIRST);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** "just now", "45m ago", "3h ago", then a date ("6 Nov", with the year when it is not this one). */
export function whenText(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const age = now - at;
  if (age < MINUTE) return "just now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m ago`;
  if (age < 24 * HOUR) return `${Math.floor(age / HOUR)}h ago`;
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** A comment is unsent while the new-comment box has text or an open edit differs from the comment. */
export function commentUnsent(box: string, edit: { text: string; original: string } | null): boolean {
  return box.trim() !== "" || (edit !== null && edit.text !== edit.original);
}
