import { useEffect, useState } from "react";

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="toast" role="status">
      <span>{message}</span>
    </div>
  );
}

/** A message that clears itself after 6 seconds; showing the same text again restarts the timer. */
export function useToast(): [string | null, (text: string) => void] {
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  return [toast?.text ?? null, (text) => setToast((t) => ({ text, id: (t?.id ?? 0) + 1 }))];
}
