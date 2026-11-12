// Self-check for spaces-plus' pure helpers (no window needed): node mods/spaces-plus/test_logic.mjs
import assert from "node:assert/strict";
import * as extras from "./extras.mjs";
import { assignPorts, changedCount, cpuPercent, cpuTimes, duration, isWsl, memPercent, parseListeners, portUrl, prsByBranch, spaceName, tabLabel, tilde } from "./extras.mjs";

assert.equal(tilde("/home/alex/code/x"), "~/code/x");
assert.equal(changedCount("# branch.head main\n1 .M N... a b\n? new.txt\nu UU x\n2 R. y\n# branch.ab +0 -0\n"), 4);
assert.equal(changedCount("# branch.head main\n"), 0);
assert.equal(duration(90 * 60000), "1h");

const ps = [{ tab: "t1", terminal: "t1n", title: "⠋ Open herdr-app session", program: { name: "Hermes", agent: true } }];
assert.equal(tabLabel({ id: "t1", index: 1, name: "1", named: false }, ps), "1 · Open herdr-app session");
assert.equal(tabLabel({ id: "t1", index: 1, name: "fix", named: true }, ps), "fix");
assert.equal(tabLabel({ id: "t2", index: 2, name: "2", named: false }, ps), "2");
assert.equal(spaceName({ name: "~", named: false, tabs: [{ id: "t1" }] }, ps), "hermes");
assert.equal(spaceName({ name: "~", named: true, tabs: [{ id: "t1" }] }, ps), "~");
assert.equal(spaceName({ name: "api", named: false, tabs: [{ id: "t1" }] }, ps), "api");

// Ports: what PORTS_SCRIPT prints (ss on Linux; lsof on macOS prints the same shape).
const out = [
  "127.0.0.1:5173\t11\tnode\t/home/alex/code/web",
  "[::1]:5173\t11\tnode\t/home/alex/code/web",               // the same server on IPv6: once
  "*:8000\t12\tuvicorn\t/home/alex/code/api/.worktrees/fix",  // a worktree inside the checkout
  "0.0.0.0:3000\t13\tnode\t/home/alex/code/api/web",
  "100.64.0.2%tailscale0:9000\t14\tpython3\t/home/alex/code/api",
  "127.0.0.1:41234\t15\tnode\t/home/alex/code/web",            // ephemeral: left out
  "127.0.0.1:4096\t16\topencode\t/home/alex/code/web",         // an agent's own server: left out
  "127.0.0.1:2222\t17\tsshd-ish\t/home/alex",                  // under home only: no space
  "garbage",
].join("\n");
const listeners = parseListeners(out);
assert.equal(listeners.length, 6);
assert.deepEqual(listeners[4], { host: "100.64.0.2", port: 9000, pid: 14, name: "python3", cwd: "/home/alex/code/api" });
const ports = assignPorts(listeners, ["/home/alex/code/web", "/home/alex/code/api", "/home/alex/code/api/.worktrees/fix/", "/home/alex", null]);
assert.deepEqual(ports.get("/home/alex/code/web"), [{ host: "localhost", port: 5173, name: "node" }]);
assert.deepEqual(ports.get("/home/alex/code/api").map((p) => p.port), [3000, 9000]);   // web/ is inside api
assert.deepEqual(ports.get("/home/alex/code/api/.worktrees/fix").map((p) => p.port), [8000]); // the closest folder wins
assert.equal(ports.get("/home/alex"), undefined);
assert.equal(portUrl({ host: "localhost", port: 5173 }, null), "http://localhost:5173");
assert.equal(portUrl({ host: "localhost", port: 5173 }, "vps"), "http://vps:5173");
assert.equal(portUrl({ host: "100.64.0.2", port: 9000 }, "vps"), "http://100.64.0.2:9000");
// A WSL machine seen from a Windows app: its localhost is forwarded, its Herdr name resolves nowhere.
assert.equal(portUrl({ host: "localhost", port: 5173 }, "dev", true), "http://localhost:5173");
assert.equal(portUrl({ host: "172.20.1.5", port: 5173 }, "dev", true), "http://172.20.1.5:5173");
assert.equal(isWsl("6.6.87.2-microsoft-standard-WSL2\n"), true);
assert.equal(isWsl("4.4.0-19041-Microsoft\n"), true); // WSL1
assert.equal(isWsl("6.8.0-45-generic\n"), false);
assert.equal(isWsl(null), false);

// Pull requests: the newest per branch; closed-unmerged ones go.
const prs = prsByBranch(JSON.stringify([
  { number: 12, headRefName: "fix", state: "OPEN", isDraft: true, url: "https://github.com/o/r/pull/12" },
  { number: 9, headRefName: "fix", state: "MERGED", isDraft: false, url: "u9" },
  { number: 8, headRefName: "old", state: "CLOSED", isDraft: false, url: "u8" },
  { number: 7, headRefName: "done", state: "MERGED", isDraft: false, url: "u7" },
]));
assert.deepEqual(prs.get("fix"), { number: 12, state: "OPEN", draft: true, url: "https://github.com/o/r/pull/12" });
assert.equal(prs.get("old"), undefined);
assert.equal(prs.get("done").state, "MERGED");
assert.equal(prsByBranch("not json").size, 0);

// CI: failures beat stuck queues; no alert for normal running or passing checks.
assert.equal(typeof extras.ciStatus, "function");
assert.deepEqual(extras.ciStatus([{ name: "tests", status: "COMPLETED", conclusion: "FAILURE" }], 1), { tone: "error", text: "Failed: tests" });
const minute = 60000, now = Date.parse("2026-01-01T01:00:00Z");
const check = (status, time) => ({ name: "build", status, startedAt: time });
assert.equal(extras.ciStatus([check("IN_PROGRESS", "2026-01-01T00:00:00Z")], now), null);
assert.equal(extras.ciStatus([check("QUEUED", "2026-01-01T00:15:00Z")], now), null);
assert.deepEqual(extras.ciStatus([check("QUEUED", "2026-01-01T00:08:00Z")], now), { tone: "warning", text: "queued 52m" });
assert.deepEqual(extras.ciStatus([{ context: "lint", state: "ERROR" }, check("QUEUED", "2026-01-01T00:00:00Z")], now), { tone: "error", text: "Failed: lint" });
const queueJson = JSON.stringify([{ number: 42, headRefName: "work", state: "OPEN", statusCheckRollup: [{ name: "build", status: "QUEUED", startedAt: "0001-01-01T00:00:00Z", detailsUrl: "https://example.com/job/1" }] }]);
const firstQueue = prsByBranch(queueJson, new Map(), now);
assert.equal(extras.ciStatus(firstQueue.get("work").checks, now), null);
const stillQueued = prsByBranch(queueJson, firstQueue, now + 52 * minute);
assert.deepEqual(extras.ciStatus(stillQueued.get("work").checks, now + 52 * minute), { tone: "warning", text: "queued 52m" });
const changedRun = prsByBranch(queueJson.replace("job/1", "job/2"), stillQueued, now + 52 * minute);
assert.equal(extras.ciStatus(changedRun.get("work").checks, now + 52 * minute), null);
assert.equal(extras.ciStatus([{ status: "COMPLETED", conclusion: "SKIPPED" }, { status: "COMPLETED", conclusion: "SUCCESS" }], now), null);
assert.deepEqual(extras.ciStatus([{ name: "build", conclusion: "FAILURE" }, { context: "lint", state: "FAILURE" }], now), { tone: "error", text: "Failed: build, lint" });

// Disconnected state uses the first observed outage, and resets on reconnect.
assert.equal(typeof extras.machineStatus, "function");
assert.deepEqual(extras.machineStatus({ state: "unreachable", why: "ssh: connect: Connection timed out" }, now - 52 * minute, now), { text: "ssh timeout · 52m", tooltip: "ssh: connect: Connection timed out\nNot connected for 52m (observed)" });
assert.equal(extras.machineStatus({ state: "connected" }, now, now), null);
assert.deepEqual(extras.machineStatus({ state: "unreachable", why: "connection refused", since_ms: now - 2 * minute }, now - minute, now), { text: "connection refused · 2m", tooltip: "connection refused\nNot connected for 2m" });
assert.equal(extras.machineStatus({ state: "unreachable", why: "Host key verification failed" }, null, now).text, "host key");
assert.equal(extras.machineStatus({ state: "needs_login" }, null, now).text, "not connected");
assert.equal(typeof extras.offlineTimes, "function");
assert.deepEqual(extras.offlineTimes([{ name: "box", state: "unreachable" }], {}, now), { box: now });
assert.deepEqual(extras.offlineTimes([{ name: "box", state: "unreachable" }], { box: now }, now + minute), { box: now });
assert.deepEqual(extras.offlineTimes([{ name: "box", state: "connected" }], { box: now }, now + minute), {});
assert.deepEqual(extras.offlineTimes([], { box: now }, now + minute), {});

// Machine load.
const a = cpuTimes("cpu  100 0 100 700 100 0 0 0\n");
assert.equal(cpuPercent(a, cpuTimes("cpu  150 0 150 750 150 0 0 0\n")), 50);
assert.equal(cpuPercent(null, a), null);
assert.equal(memPercent("MemTotal: 1000 kB\nMemAvailable: 250 kB\n"), 75);
assert.equal(memPercent(null), null);
console.log("ok");
