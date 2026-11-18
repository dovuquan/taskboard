import type { Me } from "../api";
import { Avatar } from "./Avatar";
import { BrandMark } from "./BrandMark";

export function AppBar({
  user,
  screen = "boards",
}: {
  user: Me;
  screen?: "boards" | "members";
}) {
  return (
    <header className="appbar gutter">
      <a className="brand" href="/boards">
        <BrandMark />
        Taskboard
      </a>
      <nav className="crumbs" aria-label="Breadcrumb">
        <span>/</span>
        <span>{screen === "members" ? "Members" : "Boards"}</span>
      </nav>
      <span className="spacer"></span>
      <a className={screen === "boards" ? "navlink on" : "navlink"} href="/boards">
        Boards
      </a>
      {user.role === "admin" && (
        <a className={screen === "members" ? "navlink on" : "navlink"} href="/members">
          Members
        </a>
      )}
      <span className="me">
        <Avatar user={user} large />
        <span>
          {user.name ?? user.email}
          <small>{user.role === "admin" ? "Workspace admin" : "Workspace member"}</small>
        </span>
      </span>
    </header>
  );
}
