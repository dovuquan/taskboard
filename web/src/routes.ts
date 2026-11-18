import type { MeResult } from "./api";

export type Screen = "signin" | "refused" | "expired" | "boards" | "members" | "error";

export function resolveScreen(path: string, me: MeResult["kind"]): Screen {
  if (path === "/signin/refused") return "refused";
  switch (me) {
    case "error":
      return "error";
    case "user":
      return path === "/members" ? "members" : "boards";
    case "expired":
      return path === "/signin" ? "signin" : "expired";
    case "signed_out":
      return "signin";
  }
}
