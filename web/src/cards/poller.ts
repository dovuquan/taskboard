/** The part of `document` the poller uses. */
export type PollDoc = {
  hidden: boolean;
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
};

/** The part of `window` the poller uses. */
export type PollWin = {
  addEventListener: (type: "focus", listener: () => void) => void;
  removeEventListener: (type: "focus", listener: () => void) => void;
};

export type BoardPoller = {
  stop: () => void;
  /**
   * Loads now. A call that arrives while a load is in flight asks for one more load after it, since
   * the running one may have started before a local change.
   */
  refresh: () => Promise<void>;
};

export type PollerOptions<T> = {
  /** Fetches the board. Resolve to `null` when the result was already dealt with or must be ignored. */
  load: () => Promise<T | null>;
  onResult: (result: T) => void;
  /** The local change counter; read when a load starts and handed to `canApply` when it ends. */
  epoch: () => number;
  canApply: (startEpoch: number) => boolean;
  /** False while there is nothing to reload yet. */
  enabled?: () => boolean;
  setInterval: (tick: () => void, ms: number) => number;
  clearInterval: (timer: number) => void;
  doc: PollDoc;
  win: PollWin;
  intervalMs: number;
};

/**
 * Reloads the board every `intervalMs` while the page is visible, when it becomes visible and when
 * the window gets focus. One load at a time; a result is used only if `canApply` still allows it.
 */
export function startBoardPoller<T>(options: PollerOptions<T>): BoardPoller {
  const { load, onResult, epoch, canApply, enabled, doc, win } = options;
  let live = true;
  let inflight = false;
  let again = false;

  async function run(explicit: boolean): Promise<void> {
    if (!live || (enabled && !enabled())) return;
    if (inflight) {
      if (explicit) again = true;
      return;
    }
    inflight = true;
    const start = epoch();
    try {
      const result = await load();
      if (live && result !== null && canApply(start)) onResult(result);
    } finally {
      inflight = false;
    }
    if (again && live) {
      again = false;
      await run(false);
    }
  }

  const onTick = () => {
    if (!doc.hidden) void run(false);
  };
  const onFocus = () => void run(false);
  const timer = options.setInterval(onTick, options.intervalMs);
  doc.addEventListener("visibilitychange", onTick);
  win.addEventListener("focus", onFocus);

  return {
    stop: () => {
      live = false;
      options.clearInterval(timer);
      doc.removeEventListener("visibilitychange", onTick);
      win.removeEventListener("focus", onFocus);
    },
    refresh: () => run(true),
  };
}
