import type { Me } from "../api";
import { Avatar } from "./Avatar";
import { BrandMark } from "./BrandMark";

export function AppBar({ user }: { user: Me }) {
  return (
    <header className="appbar gutter">
      <a className="brand" href="/boards">
        <BrandMark />
        Taskboard
      </a>
      <span className="spacer"></span>
      <a className="navlink on" href="/boards">
        Boards
      </a>
      <span className="me">
        <Avatar user={user} />
        <span>
          {user.name ?? user.email}
          <small>{user.role === "admin" ? "Workspace admin" : "Workspace member"}</small>
        </span>
      </span>
    </header>
  );
}
