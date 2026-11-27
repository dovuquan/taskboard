import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type PollDoc, type PollWin, startBoardPoller } from "./poller";

const INTERVAL = 30_000;

function fakeTarget() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    listeners,
    addEventListener: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => {
      listeners.get(type)?.delete(fn);
    },
    fire: (type: string) => listeners.get(type)?.forEach((fn) => fn()),
    count: (type: string) => listeners.get(type)?.size ?? 0,
  };
}

function setup(options: { canApply?: (start: number) => boolean; epoch?: () => number } = {}) {
  const docTarget = fakeTarget();
  const winTarget = fakeTarget();
  const doc = {
    hidden: false,
    addEventListener: docTarget.addEventListener,
    removeEventListener: docTarget.removeEventListener,
  } as PollDoc;
  const win = {
    addEventListener: winTarget.addEventListener,
    removeEventListener: winTarget.removeEventListener,
  } as PollWin;
  const resolvers: ((value: string | null) => void)[] = [];
  const load = vi.fn(() => new Promise<string | null>((resolve) => resolvers.push(resolve)));
  const onResult = vi.fn();
  const clear = vi.fn((timer: number) => clearInterval(timer));
  const poller = startBoardPoller<string>({
    load,
    onResult,
    epoch: options.epoch ?? (() => 0),
    canApply: options.canApply ?? (() => true),
    setInterval: (tick, ms) => setInterval(tick, ms) as unknown as number,
    clearInterval: clear,
    doc,
    win,
    intervalMs: INTERVAL,
  });
  return { doc, docTarget, winTarget, load, onResult, clear, poller, resolvers };
}

/** Lets the promise chains of a settled load run. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("startBoardPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads on every tick", async () => {
    const { load, resolvers } = setup();
    expect(load).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(load).toHaveBeenCalledTimes(1);
    resolvers[0]("a");
    await settle();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("skips the tick while the page is hidden", async () => {
    const { doc, load } = setup();
    doc.hidden = true;
    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(load).toHaveBeenCalledTimes(0);
    doc.hidden = false;
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("loads when the page becomes visible but not when it becomes hidden", async () => {
    const { doc, docTarget, load } = setup();
    doc.hidden = true;
    docTarget.fire("visibilitychange");
    await settle();
    expect(load).toHaveBeenCalledTimes(0);
    doc.hidden = false;
    docTarget.fire("visibilitychange");
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("loads when the window gets focus", async () => {
    const { winTarget, load } = setup();
    winTarget.fire("focus");
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not start a second load while one is in flight", async () => {
    const { winTarget, docTarget, load, resolvers } = setup();
    winTarget.fire("focus");
    docTarget.fire("visibilitychange");
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(load).toHaveBeenCalledTimes(1);
    resolvers[0]("a");
    await settle();
    winTarget.fire("focus");
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("runs once more after an explicit refresh that arrived during a load", async () => {
    const { poller, load, resolvers, onResult } = setup();
    void poller.refresh();
    void poller.refresh();
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    resolvers[0]("old");
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    resolvers[1]("new");
    await settle();
    expect(onResult.mock.calls).toEqual([["old"], ["new"]]);
  });

  it("applies a result when canApply is true", async () => {
    const { winTarget, onResult, resolvers } = setup({ canApply: () => true });
    winTarget.fire("focus");
    await settle();
    resolvers[0]("fresh");
    await settle();
    expect(onResult.mock.calls).toEqual([["fresh"]]);
  });

  it("drops a result when canApply is false", async () => {
    const { winTarget, onResult, resolvers } = setup({ canApply: () => false });
    winTarget.fire("focus");
    await settle();
    resolvers[0]("stale");
    await settle();
    expect(onResult).toHaveBeenCalledTimes(0);
  });

  it("hands canApply the epoch from when the load started", async () => {
    let epoch = 3;
    const seen: number[] = [];
    const { winTarget, onResult, resolvers } = setup({
      epoch: () => epoch,
      canApply: (start) => {
        seen.push(start);
        return start === epoch;
      },
    });
    winTarget.fire("focus");
    await settle();
    epoch = 4;
    resolvers[0]("stale");
    await settle();
    expect(seen).toEqual([3]);
    expect(onResult).toHaveBeenCalledTimes(0);
  });

  it("ignores a load that resolves to null", async () => {
    const { winTarget, onResult, resolvers } = setup();
    winTarget.fire("focus");
    await settle();
    resolvers[0](null);
    await settle();
    expect(onResult).toHaveBeenCalledTimes(0);
  });

  it("removes both listeners and stops the timer on stop", async () => {
    const { poller, docTarget, winTarget, load, clear, onResult, resolvers } = setup();
    expect(docTarget.count("visibilitychange")).toBe(1);
    expect(winTarget.count("focus")).toBe(1);
    winTarget.fire("focus");
    await settle();
    poller.stop();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(docTarget.count("visibilitychange")).toBe(0);
    expect(winTarget.count("focus")).toBe(0);
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(load).toHaveBeenCalledTimes(1);
    resolvers[0]("late");
    await settle();
    expect(onResult).toHaveBeenCalledTimes(0);
  });
});
