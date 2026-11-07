/** Every Anchor token prefix the guard must catch (`anc_<kind>_`). */
export const TOKEN_KINDS = ["s", "st", "inv", "rst", "oat", "ort", "oac", "dc"] as const;
/** An Anchor token of any kind at real length (placeholders like `anc_st_...` do not match). */
export const SECRET_LIKE = new RegExp(`anc_(${TOKEN_KINDS.join("|")})_[A-Za-z0-9_-]{20,}`);
/** A PEM private key block. */
export const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
