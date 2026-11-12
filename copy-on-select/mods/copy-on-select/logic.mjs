// Pure logic for copy-on-select (no herdr / gpui-kit imports, so test_logic.mjs runs under node).
//
// Mods see presses but never releases, and Linux has no way to ask whether a button is still down.
// So a Shift-press is watched by pointer position alone: once the pointer has dragged and then held
// still for SETTLE_MS, the selection is copied. A pause mid-drag copies the partial selection, and the
// final one is copied again when the pointer settles at the end.

export const DRAG_PX = 4; // movement that counts as a drag, not a click
export const SETTLE_MS = 250; // pointer still this long after a drag = copy
export const LINGER_MS = 1500; // still this much longer after that = done
export const MAX_MS = 30000; // never watch one press longer than this

export function start(down, now) {
  return { down, last: down, movedAt: now, startedAt: now, dragged: false, copied: false };
}

// One timer tick. Returns 'copy', 'wait' or 'stop'.
export function tick(s, p, now) {
  if (now - s.startedAt > MAX_MS) return 'stop';
  if (p.x !== s.last.x || p.y !== s.last.y) {
    s.last = p;
    s.movedAt = now;
    s.copied = false;
    if (Math.abs(p.x - s.down.x) > DRAG_PX || Math.abs(p.y - s.down.y) > DRAG_PX) s.dragged = true;
    return 'wait';
  }
  const still = now - s.movedAt;
  if (still >= SETTLE_MS + LINGER_MS) return 'stop';
  if (s.dragged && !s.copied && still >= SETTLE_MS) {
    s.copied = true;
    return 'copy';
  }
  return 'wait';
}
