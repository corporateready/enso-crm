// A value handed to TypeORM's Like/ILike is a PATTERN, not a literal: '%' and
// '_' are wildcards. An email is user-supplied and '_' in an address is
// ordinary — 'cretu_dumitru@hotmail.com' is a real contact — so an unescaped
// ILike on it also matches 'cretuXdumitru@hotmail.com', i.e. a different human.
// Postgres LIKE treats backslash as the escape character by default.
export const escapeLikePattern = (value: string): string =>
  value.replace(/[\\%_]/g, '\\$&');
