/**
 * Identifier generator. The counter is realigned to the ids already present in
 * the open document, so a loaded file can never collide with elements created
 * afterwards.
 */
let counter = 1;

export function uid(prefix: string): string {
  const n = counter++;
  return `${prefix}${n.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Moves the counter past the number of elements that already exist. */
export function seedIds(existing: number): void {
  counter = Math.max(counter, existing + 1);
}
