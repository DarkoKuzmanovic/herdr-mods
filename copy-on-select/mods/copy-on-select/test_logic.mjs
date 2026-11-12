import assert from 'node:assert/strict';
import { start, tick, SETTLE_MS, LINGER_MS, MAX_MS } from './logic.mjs';

// Feed (x, y, t) samples; return what each tick said.
const run = (s, samples) => samples.map(([x, y, t]) => tick(s, { x, y }, t));

// Shift-drag, hold still (released): one copy once the pointer settles, then stop.
let s = start({ x: 0, y: 0 }, 0);
let out = run(s, [[50, 0, 40], [100, 0, 80], [100, 0, 80 + SETTLE_MS], [100, 0, 80 + SETTLE_MS + LINGER_MS]]);
assert.deepEqual(out, ['wait', 'wait', 'copy', 'stop']);

// A pause mid-drag copies the partial selection; the drag goes on and the final one is copied too.
s = start({ x: 0, y: 0 }, 0);
out = run(s, [[50, 0, 40], [50, 0, 40 + SETTLE_MS], [120, 5, 600], [120, 5, 600 + SETTLE_MS]]);
assert.deepEqual(out, ['wait', 'copy', 'wait', 'copy']);

// Shift-click without moving past the drag threshold: never copies.
s = start({ x: 10, y: 10 }, 0);
out = run(s, [[12, 11, 40], [12, 11, 40 + SETTLE_MS], [12, 11, 40 + SETTLE_MS + LINGER_MS]]);
assert.deepEqual(out, ['wait', 'wait', 'stop']);

// Pointer that never settles: give up after MAX_MS.
s = start({ x: 0, y: 0 }, 0);
assert.equal(tick(s, { x: 1000, y: 0 }, MAX_MS + 1), 'stop');

console.log('copy-on-select logic ok');
