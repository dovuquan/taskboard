import { type Ref, useEffect, useRef, useState } from "react";

import { type Me, signOut } from "../api";
import { type MenuEvent, menuAfter, signOutAndLeave } from "../auth/signOut";
import { Avatar } from "./Avatar";
import { BrandMark } from "./BrandMark";

type Screen = "boards" | "members";

type AppBarViewProps = {
  user: Me;
  screen: Screen;
  open: boolean;
  onToggle: () => void;
  onSignOut: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
  menuRef?: Ref<HTMLSpanElement>;
  itemRef?: Ref<HTMLButtonElement>;
};

export function AppBarView({
  user,
  screen,
  open,
  onToggle,
  onSignOut,
  buttonRef,
  menuRef,
  itemRef,
}: AppBarViewProps) {
  const label = user.name ?? user.email;
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
      <span className="me-wrap" ref={menuRef}>
        <button
          ref={buttonRef}
          type="button"
          className="me"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? "account-menu" : undefined}
          aria-label={`Account menu for ${label}`}
          onClick={onToggle}
        >
          <Avatar user={user} large />
          <span>
            {label}
            <small>{user.role === "admin" ? "Workspace admin" : "Workspace member"}</small>
          </span>
        </button>
        {open && (
          <div id="account-menu" className="pop account-menu" role="menu">
            <button ref={itemRef} type="button" className="item" role="menuitem" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        )}
      </span>
    </header>
  );
}

export function AppBar({ user, screen = "boards" }: { user: Me; screen?: Screen }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);
  const send = (event: MenuEvent) => setOpen((now) => menuAfter(now, event));

  useEffect(() => {
    if (!open) return;
    itemRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        send("escape");
        buttonRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) send("outside");
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <AppBarView
      user={user}
      screen={screen}
      open={open}
      onToggle={() => send("toggle")}
      onSignOut={() => {
        send("choose");
        void signOutAndLeave(signOut, (path) => window.location.assign(path));
      }}
      buttonRef={buttonRef}
      menuRef={menuRef}
      itemRef={itemRef}
    />
  );
}
