import { type DragEvent, type FormEvent, type KeyboardEvent } from "react";

import type { Card } from "../api";
import { oneLine } from "../cards/logic";

/** One card in a lane. A click does nothing yet: the card dialog arrives with T12. */
export function CardTile({
  card,
  editor,
  dragging,
  dropBefore,
  onDragStart,
  onDragEnd,
}: {
  card: Card;
  editor: boolean;
  dragging: boolean;
  dropBefore: boolean;
  onDragStart?: (id: number) => void;
  onDragEnd?: () => void;
}) {
  const classes = ["card"];
  if (dragging) classes.push("dragging");
  if (dropBefore) classes.push("drop-before");
  return (
    <div
      className={classes.join(" ")}
      data-card={card.id}
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
      <span className="title">{card.title}</span>
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
