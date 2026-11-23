import { type DragEvent, type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";

import {
  type BoardList,
  type ListError,
  archiveList,
  createList,
  getLists,
  moveList,
  renameList,
  restoreList,
} from "../api";
import {
  archiveIn,
  arrange,
  canAddList,
  planDrop,
  reinsertAt,
  renameIn,
  revert,
} from "../lists/logic";
import {
  LIST_LIMIT_TEXT,
  SEEDED_TEXT,
  addedText,
  archivedText,
  changeFailureText,
  movedText,
  renamedText,
  restoreFailureText,
  restoredText,
} from "../lists/text";
import { Icon } from "./Icon";

/** What the lanes show and do. Every field is optional so a page can render them statically. */
export type LanesControls = {
  menu: number | null;
  renaming: number | null;
  adding: boolean;
  seeding: boolean;
  dragId: number | null;
  /** The index the dragged list would land before; the list count means the end. */
  dropIndex: number | null;
  onMenu: (id: number | null) => void;
  onStartRename: (id: number) => void;
  onFinishRename: (id: number, name: string, keep: boolean) => void;
  onArchive: (id: number) => void;
  onStartAdd: () => void;
  onCancelAdd: () => void;
  onAdd: (name: string) => Promise<boolean>;
  onSeed: () => void;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
  onDragOver: (index: number) => void;
  onDrop: (index: number) => void;
};

/** The index of the list the pointer is left of, or the list count when it is right of all. */
function targetIndex(e: DragEvent<HTMLElement>, lists: BoardList[]): number {
  const lanes = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(".lane:not(.dragging)"));
  const over = lanes.find((lane) => {
    const r = lane.getBoundingClientRect();
    return e.clientX < r.left + r.width / 2;
  });
  if (!over) return lists.length;
  return lists.findIndex((l) => String(l.id) === over.dataset.lane);
}

function LaneMenu({ list, c }: { list: BoardList; c: Partial<LanesControls> }) {
  return (
    <div className="pop" role="menu" style={{ right: 6, top: 36 }}>
      <span className="head">{list.name}</span>
      <button className="item" type="button" role="menuitem" onClick={() => c.onStartRename?.(list.id)}>
        Rename list
      </button>
      <hr />
      <button
        className="item danger"
        type="button"
        role="menuitem"
        onClick={() => c.onArchive?.(list.id)}
      >
        Archive list
      </button>
    </div>
  );
}

function RenameInput({ list, c }: { list: BoardList; c: Partial<LanesControls> }) {
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      c.onFinishRename?.(list.id, e.currentTarget.value, true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      c.onFinishRename?.(list.id, e.currentTarget.value, false);
    }
  }
  return (
    <input
      className="input lane-rename"
      defaultValue={list.name}
      maxLength={80}
      aria-label="List name"
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={onKeyDown}
      onBlur={(e) => c.onFinishRename?.(list.id, e.currentTarget.value, true)}
    />
  );
}

function AddForm({ c }: { c: Partial<LanesControls> }) {
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("name") as HTMLInputElement;
    const name = input.value.trim();
    if (!name) {
      input.focus();
      return;
    }
    if (await c.onAdd?.(name)) {
      input.value = "";
      input.focus();
    }
  }
  return (
    <form
      className="lane-form"
      onSubmit={(e) => void onSubmit(e)}
      onKeyDown={(e) => {
        if (e.key === "Escape") c.onCancelAdd?.();
      }}
    >
      <input
        className="input"
        name="name"
        placeholder="List name"
        maxLength={80}
        aria-label="New list name"
        autoFocus
      />
      <div className="row">
        <button className="btn primary sm" type="submit">
          Add list
        </button>
        <button className="btn ghost sm" type="button" onClick={() => c.onCancelAdd?.()}>
          Cancel
        </button>
        <span className="fine" style={{ marginLeft: "auto" }}>
          Enter · Esc
        </span>
      </div>
    </form>
  );
}

export function LanesView({
  lists,
  editor,
  controls = {},
}: {
  lists: BoardList[];
  editor: boolean;
  controls?: Partial<LanesControls>;
}) {
  const c = controls;
  const dragging = c.dragId ?? null;
  const dropIndex = c.dropIndex ?? null;
  const atEnd = dragging !== null && dropIndex === lists.length;

  return (
    <div className="lanes-wrap gutter">
      <div
        className={atEnd ? "lanes lane-drop-end" : "lanes"}
        onDragOver={(e) => {
          if (dragging === null) return;
          e.preventDefault();
          c.onDragOver?.(targetIndex(e, lists));
        }}
        onDrop={(e) => {
          if (dragging === null) return;
          e.preventDefault();
          c.onDrop?.(targetIndex(e, lists));
        }}
      >
        {lists.map((list, index) => {
          const renaming = editor && c.renaming === list.id;
          const classes = ["lane"];
          if (dragging === list.id) classes.push("dragging");
          if (dragging !== null && dropIndex === index) classes.push("lane-drop-before");
          return (
            <section className={classes.join(" ")} data-lane={list.id} aria-label={list.name} key={list.id}>
              <div
                className="lane-head"
                {...(editor && !renaming
                  ? {
                      draggable: true,
                      title: "Drag to move the list",
                      onDragStart: (e: DragEvent<HTMLDivElement>) => {
                        e.dataTransfer.effectAllowed = "move";
                        try {
                          e.dataTransfer.setData("text/plain", String(list.id));
                        } catch {
                          // Some browsers refuse; the drag still works through our own state.
                        }
                        c.onDragStart?.(list.id);
                      },
                      onDragEnd: () => c.onDragEnd?.(),
                    }
                  : {})}
              >
                {editor && (
                  <span className="grip" aria-hidden="true">
                    <Icon name="grip" />
                  </span>
                )}
                {renaming ? (
                  <RenameInput list={list} c={c} />
                ) : (
                  <h3
                    {...(editor
                      ? { title: "Click to rename", onClick: () => c.onStartRename?.(list.id) }
                      : {})}
                  >
                    {list.name}
                  </h3>
                )}
                {editor && (
                  <button
                    className="icon-btn"
                    type="button"
                    data-pop="lane"
                    aria-haspopup="menu"
                    aria-expanded={c.menu === list.id}
                    aria-label={`List actions for ${list.name}`}
                    onClick={() => c.onMenu?.(c.menu === list.id ? null : list.id)}
                  >
                    <Icon name="dots" />
                  </button>
                )}
                {editor && c.menu === list.id && <LaneMenu list={list} c={c} />}
              </div>
              <div className="lane-body"></div>
            </section>
          );
        })}
        {editor &&
          (canAddList(lists.length) ? (
            c.adding ? (
              <AddForm c={c} />
            ) : (
              <button className="add-lane" type="button" onClick={() => c.onStartAdd?.()}>
                <Icon name="plus" /> Add list
              </button>
            )
          ) : (
            <p className="fine lane-form">{LIST_LIMIT_TEXT}</p>
          ))}
      </div>
    </div>
  );
}

type Setup = {
  boardId: number;
  lists: BoardList[];
  setLists: (update: (lists: BoardList[]) => BoardList[]) => void;
  notify: (text: string, undo?: () => void) => void;
  /** The server said 403: the caller's role changed, so the board is fetched again. */
  onForbidden: () => void;
  /** The server said the board is gone. */
  onGone: () => void;
};

const SEED = ["To do", "Doing", "Done"];

/** The state and server calls behind the lanes. Pass the result to `LanesView` as `controls`. */
export function useLanes({
  boardId,
  lists,
  setLists,
  notify,
  onForbidden,
  onGone,
}: Setup): LanesControls {
  const [menu, setMenu] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // Handlers run after awaits, so they read the newest lists and flags from refs.
  const current = useRef(lists);
  current.current = lists;
  const renamingNow = useRef<number | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (menu === null) return;
    const close = (e: Event) => {
      if (e.target instanceof Element && e.target.closest(".pop, [data-pop]")) return;
      setMenu(null);
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);

  async function reloadLists() {
    const res = await getLists(boardId);
    if (res.kind === "ok") setLists(() => res.data);
    else react(res.kind);
  }

  /** What every failed call does besides telling the person. */
  function react(kind: ListError) {
    if (kind === "expired") window.location.reload();
    else if (kind === "forbidden") onForbidden();
    else if (kind === "not_found") onGone();
    else if (kind === "conflict" || kind === "list_not_found") void reloadLists();
  }

  function fail(kind: ListError, text: string) {
    if (kind !== "not_found" && kind !== "expired") notify(text);
    react(kind);
  }

  async function add(name: string): Promise<boolean> {
    if (busy.current) return false;
    if (!canAddList(current.current.length)) {
      notify(LIST_LIMIT_TEXT);
      return false;
    }
    busy.current = true;
    try {
      const res = await createList(boardId, name);
      if (res.kind !== "ok") {
        fail(res.kind, changeFailureText(res.kind, false));
        return false;
      }
      setLists((ls) => [...ls, res.data]);
      notify(addedText(res.data.name));
      return true;
    } finally {
      busy.current = false;
    }
  }

  async function seed() {
    if (busy.current) return;
    busy.current = true;
    setSeeding(true);
    try {
      for (const name of SEED) {
        const res = await createList(boardId, name);
        if (res.kind !== "ok") {
          fail(res.kind, changeFailureText(res.kind, false));
          return;
        }
        setLists((ls) => [...ls, res.data]);
      }
      notify(SEEDED_TEXT);
    } finally {
      busy.current = false;
      setSeeding(false);
    }
  }

  function finishRename(id: number, raw: string, keep: boolean) {
    // Enter or Escape unmounts the field and may blur it too; only the first call counts.
    if (renamingNow.current !== id) return;
    renamingNow.current = null;
    setRenaming(null);
    const name = raw.trim();
    const list = current.current.find((l) => l.id === id);
    if (!keep || !list || !name || name === list.name) return;
    const previous = list.name;
    const set = (to: string, from: string) => setLists((ls) => renameIn(ls, id, from, to));
    set(name, previous);
    void renameList(boardId, id, name).then((res) => {
      if (res.kind === "ok") {
        set(res.data.name, name);
        notify(renamedText(res.data.name));
        return;
      }
      set(previous, name);
      fail(res.kind, changeFailureText(res.kind, true));
    });
  }

  function archive(id: number) {
    setMenu(null);
    const archived = archiveIn(current.current, id);
    if (!archived) return;
    const { index, list } = archived;
    setLists((ls) => archiveIn(ls, id)?.next ?? ls);
    void archiveList(boardId, id).then((res) => {
      if (res.kind === "ok") {
        notify(archivedText(list.name), () => void undoArchive(list));
        return;
      }
      setLists((ls) => reinsertAt(ls, list, index));
      fail(res.kind, changeFailureText(res.kind, true));
    });
  }

  async function undoArchive(list: BoardList) {
    const res = await restoreList(boardId, list.id);
    if (res.kind !== "ok") {
      fail(res.kind, restoreFailureText(res.kind));
      return;
    }
    notify(restoredText(res.data.name));
    await reloadLists();
  }

  function endDrag() {
    setDragId(null);
    setDropIndex(null);
  }

  function drop(index: number) {
    const id = dragId;
    endDrag();
    if (id === null) return;
    const ids = current.current.map((l) => l.id);
    const plan = planDrop(ids, id, index);
    if (!plan) return;
    const from = ids.indexOf(id);
    const name = current.current[from].name;
    setLists((ls) => arrange(ls, plan.next));
    void moveList(boardId, id, plan.after_id).then((res) => {
      if (res.kind === "ok") {
        notify(movedText(name));
        return;
      }
      setLists((ls) =>
        arrange(
          ls,
          revert(
            ls.map((l) => l.id),
            id,
            from,
          ),
        ),
      );
      fail(res.kind, changeFailureText(res.kind, true));
    });
  }

  return {
    menu,
    renaming,
    adding,
    seeding,
    dragId,
    dropIndex,
    onMenu: setMenu,
    onStartRename: (id) => {
      setMenu(null);
      renamingNow.current = id;
      setRenaming(id);
    },
    onFinishRename: finishRename,
    onArchive: archive,
    onStartAdd: () => setAdding(true),
    onCancelAdd: () => setAdding(false),
    onAdd: add,
    onSeed: () => void seed(),
    onDragStart: setDragId,
    onDragEnd: endDrag,
    onDragOver: setDropIndex,
    onDrop: drop,
  };
}
