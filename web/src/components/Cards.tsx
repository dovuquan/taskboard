import { type CSSProperties, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

import type { Card, Label } from "../api";
import { dueState, dueTitle, formatDue } from "../cards/due";
import { oneLine } from "../cards/logic";
import { linkify, shortUrl } from "../cards/markdown";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";

const GLYPHS = {
  check: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />,
  act: <circle cx="12" cy="12" r="3" />,
};

/** The checklist, comment and activity icons (the shared icon set has no room for them yet). */
export function GlyphIcon({ name }: { name: keyof typeof GLYPHS }) {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
      {GLYPHS[name]}
    </svg>
  );
}

/**
 * Plain text in which only bare http(s) addresses are links: new tab, host and the start of the
 * path as the text, the full address in the tooltip. Nothing else is formatted, and the text is
 * never read as HTML.
 */
export function LinkedText({ text }: { text: string }) {
  const parts: ReactNode[] = linkify(text).map((node, i) =>
    node.t === "link" ? (
      <a
        key={i}
        className="ext"
        href={node.href}
        target="_blank"
        rel="noopener noreferrer"
        title={node.href}
      >
        {shortUrl(node.href)}
      </a>
    ) : node.t === "text" ? (
      node.v
    ) : null,
  );
  return <>{parts}</>;
}

/** A person a card can show: the board's people carry at least these fields. */
export type CardPerson = { id: number; name: string | null; email: string };

/** A label as a chip: the name in the text colour, with a dot and tint in the label's colour. */
export function LabelChip({ label }: { label: Label }) {
  // The colour names a design token; anything unexpected falls back to a neutral one.
  const color = /^[a-z][a-z0-9-]*$/.test(label.color) ? label.color : "research";
  return (
    <span className="lbl" style={{ "--c": `var(--l-${color})` } as CSSProperties}>
      {label.name}
    </span>
  );
}

/** A person's avatar; someone not on the board's list shows as unknown rather than disappearing. */
export function CardAvatar({ person, large = false }: { person: CardPerson | undefined; large?: boolean }) {
  if (!person) {
    return (
      <span className={large ? "avatar lg" : "avatar"} title="Unknown person">
        ?
      </span>
    );
  }
  return <Avatar user={person} large={large} />;
}

const TILE_PEOPLE = 4;

/** One card in a lane: it opens the card dialog on a click or Enter, and drags for editors. */
export function CardTile({
  card,
  labels = [],
  people = [],
  editor,
  dragging,
  dropBefore,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  card: Card;
  labels?: Label[];
  people?: CardPerson[];
  editor: boolean;
  dragging: boolean;
  dropBefore: boolean;
  onOpen?: (key: string) => void;
  onDragStart?: (id: number) => void;
  onDragEnd?: () => void;
}) {
  const classes = ["card"];
  if (dragging) classes.push("dragging");
  if (dropBefore) classes.push("drop-before");
  const chips = card.label_ids
    .map((id) => labels.find((l) => l.id === id))
    .filter((l): l is Label => l !== undefined);
  const state = card.due_on ? dueState(card.due_on) : null;
  const assigned = card.member_ids.map((id) => ({ id, person: people.find((p) => p.id === id) }));
  const names = assigned.map((a) => a.person?.name ?? a.person?.email ?? "an unknown person").join(", ");
  const checkDone = card.checklist_done ?? 0;
  const checkTotal = card.checklist_total ?? 0;
  const comments = card.comment_count ?? 0;
  const hasBadges =
    card.due_on !== null ||
    card.has_description ||
    checkTotal > 0 ||
    comments > 0 ||
    assigned.length > 0;
  return (
    <div
      className={classes.join(" ")}
      data-card={card.id}
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(card.key)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        onOpen?.(card.key);
      }}
      {...(editor
        ? {
            draggable: true,
            onDragStart: (e: DragEvent<HTMLDivElement>) => {
              e.dataTransfer.effectAllowed = "move";
              try {
                e.dataTransfer.setData("text/plain", card.key);
              } catch {
                // Some browsers refuse; the drag still works through our own state.
              }
              onDragStart?.(card.id);
            },
            onDragEnd: () => onDragEnd?.(),
          }
        : {})}
    >
      <span className="cid mono">{card.key}</span>
      {chips.length > 0 && (
        <span className="labels">
          {chips.map((l) => (
            <LabelChip label={l} key={l.id} />
          ))}
        </span>
      )}
      <span className="title">{card.title}</span>
      {hasBadges && (
        <span className="badges">
          {card.due_on && (
            <span className={state ? `b due ${state}` : "b due"} title={dueTitle(card.due_on, state)}>
              <Icon name="cal" />
              <span aria-hidden="true">{formatDue(card.due_on)}</span>
              <span className="sr">{dueTitle(card.due_on, state)}</span>
            </span>
          )}
          {card.has_description && (
            <span className="b" title="Has a description">
              <Icon name="text" />
              <span className="sr">Has a description</span>
            </span>
          )}
          {checkTotal > 0 && (
            <span className={checkDone === checkTotal ? "b done" : "b"} title="Checklist">
              <GlyphIcon name="check" />
              <span aria-hidden="true">{`${checkDone}/${checkTotal}`}</span>
              <span className="sr">{`Checklist: ${checkDone} of ${checkTotal} done`}</span>
            </span>
          )}
          {comments > 0 && (
            <span className="b" title="Comments">
              <GlyphIcon name="chat" />
              <span aria-hidden="true">{comments}</span>
              <span className="sr">{comments === 1 ? "1 comment" : `${comments} comments`}</span>
            </span>
          )}
          {assigned.length > 0 && (
            <>
              <span className="stack" aria-hidden="true">
                {assigned.slice(0, TILE_PEOPLE).map((a) => (
                  <CardAvatar person={a.person} key={a.id} />
                ))}
                {assigned.length > TILE_PEOPLE && (
                  <span className="chip">{`+${assigned.length - TILE_PEOPLE}`}</span>
                )}
              </span>
              <span className="sr">{`Assigned to ${names}`}</span>
            </>
          )}
        </span>
      )}
    </div>
  );
}

/** The "Card title" box at the foot of a lane. Enter adds, Shift+Enter breaks the line, Esc closes. */
export function Composer({
  onAdd,
  onClose,
}: {
  /** Resolves true when the card was added. */
  onAdd?: (title: string) => Promise<boolean>;
  onClose?: () => void;
}) {
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("title") as HTMLTextAreaElement;
    const title = oneLine(input.value);
    if (!title) {
      input.focus();
      return;
    }
    if (await onAdd?.(title)) {
      if (oneLine(input.value) === title) input.value = "";
      input.focus();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose?.();
    }
  }

  return (
    <form className="composer" onSubmit={(e) => void onSubmit(e)}>
      <textarea
        className="input"
        name="title"
        placeholder="Card title"
        maxLength={200}
        aria-label="New card title"
        autoFocus
        onKeyDown={onKeyDown}
      ></textarea>
      <div className="row">
        <button className="btn primary sm" type="submit">
          Add card
        </button>
        <button className="btn ghost sm" type="button" onClick={() => onClose?.()}>
          Cancel
        </button>
        <span className="fine" style={{ marginLeft: "auto" }}>
          Enter to add · Esc to close
        </span>
      </div>
    </form>
  );
}
