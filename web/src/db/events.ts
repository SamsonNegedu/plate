/** Fired after every local write so the sync engine can schedule a drain. */
const target = new EventTarget();

export function emitLocalWrite(): void {
  target.dispatchEvent(new Event("write"));
}

export function onLocalWrite(cb: () => void): () => void {
  target.addEventListener("write", cb);
  return () => target.removeEventListener("write", cb);
}
