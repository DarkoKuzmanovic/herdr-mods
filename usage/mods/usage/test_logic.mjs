import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse, busiest, resetIn, card, level } from "./logic.mjs";

const sample = JSON.stringify({ schemaVersion: 2, providers: [
  { id: "claude", state: "ok", windows: [{ id: "weekly-all", label: "Weekly (all)", usedPercent: 7, resetAt: "2030-01-03T04:00:00Z" }] },
  { id: "codex", state: "ok", windows: [{ id: "primary", label: "Primary", usedPercent: 31, resetAt: "2030-01-02T04:00:00Z" }] },
  { id: "kimi", state: "auth-needed", windows: [] }
] });
const providers = parse(sample);
assert.deepEqual(busiest(providers), { id: "codex", percent: 31 });
assert.equal(resetIn("2030-01-03T04:00:00Z", Date.parse("2030-01-01T00:00:00Z")), "2d 4h");
assert.equal(resetIn("bad", 0), null);
assert.equal(resetIn("2030-01-01T00:00:00Z", Date.parse("2030-01-02T00:00:00Z")), "now");
const c = card(providers, Date.parse("2030-01-01T00:00:00Z"));
assert.deepEqual(c.rows.map((p) => p.id), ["codex", "claude"], "busiest provider first");
assert.deepEqual(c.rows[0].windows[0], { label: "Primary", percent: 31, reset: "resets in 1d 4h" });
assert.deepEqual(c.footer, ["needs login: kimi"]);
assert.deepEqual(card(parse('{"providers":[{"id":"a","state":"auth-needed"},{"id":"b","state":"auth-needed"},{"id":"c","state":"auth-needed"},{"id":"d","state":"auth-needed"},{"id":"e","state":"error"}]}')).footer, ["needs login: a, b, c +1", "unavailable: e"]);
assert.deepEqual([59, 60, 84, 85].map(level), ["done", "working", "working", "blocked"]);
assert.throws(() => parse("invalid secret"), /Invalid collector output/);
assert.throws(() => parse('{"providers":{}}'));
assert.equal(busiest(parse('{"providers":[{"id":"x","state":"ok","windows":[{"usedPercent":null}]}]}')), null);
// Exercise the actual view's polling with a controllable exec, without a running window.
const source = (await readFile(new URL("./main.js", import.meta.url), "utf8"))
  .replace('import { View, div, svg } from "gpui-kit";', 'const { View, div, svg } = globalThis.usageMock;')
  .replace('import { h_flex, v_flex, HoverCard } from "gpui-base";', 'const { h_flex, v_flex, HoverCard } = globalThis.usageMock;')
  .replace('import { exec, props, theme } from "herdr";', 'const { exec, props, theme } = globalThis.usageMock;')
  .replace('"./logic.mjs"', JSON.stringify(new URL("./logic.mjs", import.meta.url).href));
let config = { command: ["cat", "fixture"], on: "workstation", every: 5 }, resolve, reject, calls = [], pending, interval, tick;
globalThis.usageMock = {
  View: class {}, div: () => {}, svg: () => {}, h_flex: () => {}, theme: () => ({}), props: () => config,
  exec: (...args) => { calls.push(args); return new Promise((yes, no) => { resolve = yes; reject = no; }); }
};
const { default: Usage } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const cx = { notify() {}, spawn(fn) { pending = fn(cx); }, timer: { every(ms, fn) { interval = ms; tick = fn; } } };
const view = new Usage();
view.init(undefined, cx);
assert.equal(interval, 5000);
assert.deepEqual(calls[0], ["cat", ["fixture"], { on: "workstation" }]);
tick(cx);
assert.equal(calls.length, 1, "refresh must not overlap a pending exec");
resolve({ code: 0, stdout: sample });
await pending;
assert.equal(busiest(view.providers).id, "codex");
tick(cx);
reject(new Error("timed out"));
await pending;
assert.equal(view.error, "timed out");
assert.equal(busiest(view.providers).id, "codex", "failure retains the last good snapshot");
tick(cx);
resolve({ code: 2, stdout: sample });
await pending;
assert.match(view.error, /exit 2/);
tick(cx);
resolve({ code: 0, stdout: "bad JSON" });
await pending;
assert.ok(view.error);
assert.equal(busiest(view.providers).id, "codex");
tick(cx);
resolve({ code: 0, stdout: sample });
await pending;
assert.equal(view.error, null);
config = {};
const empty = new Usage();
empty.init(undefined, cx);
assert.equal(empty.command, null);
assert.equal(calls.length, 5);
console.log("usage logic and polling ok");
