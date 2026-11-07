/** The loaded secrets, `{ KEY: value }` with typed values decoded. */
export const ANCHOR_SECRETS: unique symbol = Symbol.for("@anchor-secrets/nestjs:secrets");
/** The options the module was configured with. */
export const ANCHOR_OPTIONS: unique symbol = Symbol.for("@anchor-secrets/nestjs:options");
