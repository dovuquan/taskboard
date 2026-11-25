import { type CSSProperties, type DragEvent, type FormEvent, type KeyboardEvent } from "react";

import type { Card, Label } from "../api";
import { dueState, dueTitle, formatDue } from "../cards/due";
import { oneLine } from "../cards/logic";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";

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
  const hasBadges = card.due_on !== null || card.has_description || assigned.length > 0;
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
