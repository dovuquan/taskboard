import { describe, expect, it } from "vitest";

import { REFUSAL_CODES, refusalText } from "./refusal";

const FALLBACK = "The sign-in did not go through";

const TABLE: [string, string][] = [
  ["wrong_domain", "Not an example.com Workspace account"],
  ["missing_hd", "Not an example.com Workspace account"],
  ["email_unverified", "Google has not verified this email"],
  ["state_mismatch", "The sign-in request did not match; nobody was signed in"],
  ["nonce_mismatch", "The sign-in request did not match; nobody was signed in"],
  ["expired_token", "The sign-in took too long"],
  ["oauth_error", "Google sign-in was cancelled or did not finish"],
  ["bad_token", "Google's answer could not be checked; nobody was signed in"],
  ["wrong_aud", "Google's answer could not be checked; nobody was signed in"],
  ["email_conflict", "This email is already linked to another Google account"],
];

describe("REFUSAL_CODES", () => {
  it("lists exactly the ten codes the server emits", () => {
    expect([...REFUSAL_CODES].sort()).toEqual(TABLE.map(([code]) => code).sort());
  });
});

describe("refusalText", () => {
  it.each(TABLE)("maps %s", (code, text) => {
    expect(refusalText(code, "example.com")).toBe(text);
  });

  it.each([null, "", "something_new", "<script>"])("falls back for %j", (code) => {
    expect(refusalText(code, "example.com")).toBe(FALLBACK);
  });

  it("covers every listed code with a non-fallback text", () => {
    for (const code of REFUSAL_CODES) {
      expect(refusalText(code, "example.com")).not.toBe(FALLBACK);
    }
  });
});
