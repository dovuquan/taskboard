export type MenuEvent = "toggle" | "escape" | "outside" | "choose";

/** The account menu's next open state after an event. */
export function menuAfter(open: boolean, event: MenuEvent): boolean {
  return event === "toggle" ? !open : false;
}

/** Ends the session, then always leaves for the Sign in page. */
export async function signOutAndLeave(
  post: () => Promise<void>,
  go: (path: string) => void,
): Promise<void> {
  try {
    await post();
  } catch {
    // Leave anyway: an unreachable server must not keep someone on a page they asked to leave.
  }
  go("/signin");
}
