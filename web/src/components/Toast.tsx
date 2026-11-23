import { useEffect, useState } from "react";

export function Toast({ message, onUndo }: { message: string | null; onUndo?: (() => void) | null }) {
  if (!message) return null;
  return (
    <div className="toast" role="status">
      <span>{message}</span>
      {onUndo && (
        <button type="button" onClick={onUndo}>
          Undo
        </button>
      )}
    </div>
  );
}

type Shown = { text: string; id: number; undo: (() => void) | null };

/**
 * A message that clears itself after 6 seconds; showing the same text again restarts the timer.
 * With an `undo` function the third value is a handler that runs it and clears the message.
 */
export function useToast(): [
  string | null,
  (text: string, undo?: () => void) => void,
  (() => void) | null,
] {
  const [toast, setToast] = useState<Shown | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const undo = toast?.undo ?? null;
  return [
    toast?.text ?? null,
    (text, fn) => setToast((t) => ({ text, id: (t?.id ?? 0) + 1, undo: fn ?? null })),
    undo
      ? () => {
          setToast(null);
          undo();
        }
      : null,
  ];
}
