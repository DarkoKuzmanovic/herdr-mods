// Self-check for sysstat's helpers: node mods/sysstat/test_logic.mjs
import assert from "node:assert/strict";
import { SAMPLES, cpuPercent, cpuTimes, gib, gpu, memory, push, spread } from "./logic.mjs";
assert.deepEqual(spread([10, 20, 31]), { avg: 20, peak: 31 });
assert.equal(spread([]), null);

const a = cpuTimes("cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1 2 3 4\n");
assert.deepEqual(a, [200, 1000]);
const b = cpuTimes("cpu  150 0 150 750 150 0 0 0 0 0\n");
assert.equal(cpuPercent(a, b), 50); // 100 busy of 200
assert.equal(cpuPercent(null, b), null);
assert.equal(cpuPercent(b, a), null); // counter went backwards
assert.equal(cpuTimes("garbage"), null);

assert.deepEqual(memory("MemTotal:  1048576 kB\nMemFree: 1 kB\nMemAvailable:  524288 kB\n"), { used: 2 ** 29, total: 2 ** 30 });
assert.equal(memory("MemTotal: 10 kB\nMemAvailable: 20 kB\n"), null);
assert.equal(gib(2 ** 30 * 1.25), "1.3");

assert.deepEqual(gpu("7\n", "2147483648\n", "8589934592\n"), { busy: 7, used: 2 ** 31, total: 2 ** 33 });
assert.deepEqual(gpu("3", null, null), { busy: 3, used: null, total: null });
assert.equal(gpu(null, "1", "2"), null);

let h = [];
for (let i = 0; i < SAMPLES + 5; i++) h = push(h, i);
assert.equal(h.length, SAMPLES);
assert.equal(h[0], 5);
console.log("ok");
