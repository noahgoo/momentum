/**
 * A random v4 UUID, for ids the client mints itself (a batch id kept across
 * retries, a storage object name).
 *
 * `crypto.randomUUID()` does not exist in Hermes, so calling it throws on a
 * device while working in a browser or Node. Math.random is fine here: these
 * ids only need to be unique, never unguessable, and nothing authorizes on them.
 */
export function randomUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
