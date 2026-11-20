import type { Me } from "../api";

export function initials(user: Pick<Me, "name" | "email">): string {
  const words = (user.name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0][0].toUpperCase();
  return (user.email[0] ?? "?").toUpperCase();
}

/** Overlapping avatars for the people shown, plus a +N chip when the board has more. */
export function AvatarStack({
  people,
  total,
}: {
  people: Pick<Me, "id" | "name" | "email">[];
  total: number;
}) {
  const more = total - people.length;
  return (
    <span className="stack">
      {people.map((p) => (
        <Avatar key={p.id} user={p} />
      ))}
      {more > 0 && (
        <span className="chip" title={`${total} people on this board`}>
          {`+${more}`}
        </span>
      )}
    </span>
  );
}

export function Avatar({
  user,
  large = false,
}: {
  user: Pick<Me, "name" | "email">;
  large?: boolean;
}) {
  return (
    <span className={large ? "avatar lg" : "avatar"} title={user.name ?? user.email}>
      {initials(user)}
    </span>
  );
}
