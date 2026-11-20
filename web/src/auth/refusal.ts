export const REFUSAL_CODES = [
  "wrong_domain",
  "missing_hd",
  "email_unverified",
  "state_mismatch",
  "nonce_mismatch",
  "expired_token",
  "oauth_error",
  "bad_token",
  "wrong_aud",
  "email_conflict",
] as const;

const FALLBACK = "The sign-in did not go through";
const NOT_VERIFIED = "Google's answer could not be checked; nobody was signed in";
const MISMATCH = "The sign-in request did not match; nobody was signed in";

/** Map a server refusal code to text. The input is never echoed back. */
export function refusalText(code: string | null, domain: string | null): string {
  const workspace = domain ? `${domain} Workspace` : "Workspace";
  switch (code) {
    case "wrong_domain":
    case "missing_hd":
      return domain ? `Not an ${workspace} account` : "Not a Workspace account of the allowed domain";
    case "email_unverified":
      return "Google has not verified this email";
    case "state_mismatch":
    case "nonce_mismatch":
      return MISMATCH;
    case "expired_token":
      return "The sign-in took too long";
    case "oauth_error":
      return "Google sign-in was cancelled or did not finish";
    case "bad_token":
    case "wrong_aud":
      return NOT_VERIFIED;
    case "email_conflict":
      return "This email is already linked to another Google account";
    default:
      return FALLBACK;
  }
}
