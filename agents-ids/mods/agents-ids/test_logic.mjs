// Self-check for agents-ids: node mods/agents-ids/test_logic.mjs
import assert from "node:assert/strict";
import { closeFacts, sameTerminal, doingLine, stalls, hideSession, projectOf, recentSessions, rememberSessions, resumeArgv, resumeSpace, shortSid } from "./extras.mjs";

const identity = { address: "t1", state: "live", created_ms: 7, labels: { "agent.session": "one" } };
assert.equal(sameTerminal(identity, identity), true);
assert.equal(sameTerminal(identity, null), false);
assert.equal(sameTerminal(identity, { ...identity, labels: { "agent.session": "two" } }), false);
assert.equal(sameTerminal(identity, { ...identity, created_ms: 8 }), false);
assert.equal(sameTerminal({ ...identity, created_ms: undefined }, { ...identity, created_ms: undefined }), true);
assert.equal(sameTerminal({ ...identity, created_ms: undefined, labels: {} }, { ...identity, created_ms: undefined, labels: {} }), false);

assert.deepEqual(closeFacts("working", 2, null), ["Agent: working", "Git: 2 uncommitted changes", "Sub-agents: unknown", "Background processes: unknown"]);
assert.deepEqual(closeFacts("idle", 0, 0), ["Agent: idle", "Git: no uncommitted changes", "Sub-agents: none", "Background processes: unknown"]);
assert.equal(closeFacts(null, null, 1)[1], "Git: unknown");

const doing = { "agent.doing": "running tests", "agent.doing.since": "1000" };
assert.deepEqual(doingLine(doing, "working", 1000 * 1000 + 42 * 60000), { text: "running tests · 42m", stale: true, tip: "no change for 42m" });
assert.equal(doingLine(doing, "idle", 1000 * 1000 + 42 * 60000).stale, false);
assert.equal(doingLine({}, "working", 0), null);

const at = 1000 * 1000 + 42 * 60000;
const labelsOf = (addr) => (addr === "t1" ? doing : {});
const stuck = stalls([{ address: "t1", status: "working" }, { address: "t2", status: "blocked" }, { address: "t3", status: "blocked" }, { address: "t4", status: "idle" }],
  labelsOf, { t2: { s: "blocked", at: at - 6 * 60000 }, t3: { s: "blocked", at: at - 60000 } }, at);
assert.deepEqual(stuck.map((x) => [x.key, x.text]), [["t1 working 1000", "running tests · 42m"], [`t2 blocked ${at - 6 * 60000}`, "blocked for 6m"]]);
assert.deepEqual(doingLine({ "agent.doing": "thinking", "agent.doing.since": "bad" }, "working", 5000000), { text: "thinking", stale: false, tip: "" });

assert.equal(shortSid("local-e257df53a91b0666d3c2470352eebf013ed731f57b3b98d1f7314aea1783db1d"), "e257df53");
assert.equal(shortSid("d00d75b6-815e-4fca-b4b0-637a75b0ffd9"), "d00d75b6");        // Claude Code (v4)
assert.equal(shortSid("01a1a2fa-1f31-7890-b970-031ba094b970"), "01a1a2fa-1f31");   // Codex, Pi, PiG (v7)
assert.equal(shortSid("ses_e5d03aa98ffezZtVyF4DviEcOM"), "4DviEcOM");             // OpenCode
assert.equal(shortSid(undefined), "");

assert.deepEqual(resumeArgv("claude", "d00d75b6-815e-4fca"), ["claude", "--resume", "d00d75b6-815e-4fca"]);
assert.deepEqual(resumeArgv("claude-code", "abcd1234"), ["claude", "--resume", "abcd1234"]);
assert.deepEqual(resumeArgv("/usr/bin/codex", "abcd1234"), ["codex", "resume", "abcd1234"]);
assert.deepEqual(resumeArgv("opencode", "ses_e5d03aa98ffe"), ["opencode", "--session", "ses_e5d03aa98ffe"]);
assert.deepEqual(resumeArgv("hermes", "local-e257df53"), ["hermes", "--resume", "local-e257df53"]);
assert.equal(resumeArgv("vim", "abcd1234"), null);
assert.equal(resumeArgv("claude", "x; rm -rf ~"), null); // never typed into a shell
assert.equal(resumeArgv("claude", "$(id)"), null);
assert.equal(resumeArgv(undefined, "abcd1234"), null);
assert.equal(resumeArgv("__proto__", "abcd1234"), null); // labels are untrusted
assert.equal(resumeArgv("constructor", "abcd1234"), null);

const all = [
  { address: "t1", state: "live", agent: "zsh", labels: { "agent.app": "claude", "agent.session": "aaaa1111" }, status_ms: 10 },
  { address: "t3", state: "live", agent: "codex", labels: { "agent.app": "codex", "agent.session": "cccc3333" }, status_ms: 20 },
  { address: "t4", state: "live", labels: { "agent.session": "dddd4444" } },            // no app: can't resume
  { address: "t5", state: "live", labels: {} },
  { address: "t6", state: "live", agent: "opencode", status: "idle", labels: { "agent.app": "opencode", "agent.session": "ses_x1234" } }, // a sub-agent, running
  { address: "t7", state: "live", agent: "vim", labels: { "agent.app": "claude", "agent.session": "eeee5555" }, status_ms: 5 },          // agent quit, vim open
];
const listed = new Set(["t3"]);
const gone = { bbbb2222: { sid: "bbbb2222", app: "pi", address: "t2", cwd: "/w", space: "s1", seen: 30 } }; // its terminal closed
let store = rememberSessions(gone, all, listed, 100);
assert.deepEqual(Object.keys(store).sort(), ["aaaa1111", "bbbb2222", "cccc3333", "eeee5555", "ses_x1234"]);
assert.equal(store.cccc3333.seen, 100);                       // running: seen now
assert.equal(store.aaaa1111.seen, 10);                        // ended: its last report
assert.equal(rememberSessions(store, all, listed, 100), store); // unchanged: same object, no write
assert.equal(rememberSessions(store, all, listed, 30000), store); // running, but seen < 1 min ago: no write
assert.equal(rememberSessions(store, all, listed, 70000).cccc3333.seen, 70000);
const recent = recentSessions(all, listed, store);
assert.deepEqual(recent.map((r) => r.address), ["t2", "t1", "t7"]); // codex and opencode run now; newest first
assert.deepEqual(recent[0], { sid: "bbbb2222", app: "pi", address: "t2", cwd: "/w", space: "s1", seen: 30, argv: ["pi", "--session", "bbbb2222"] });
assert.equal(recentSessions(all, listed, store, 1).length, 1);
// Resumed in a new terminal: the same id runs again, so it leaves the list.
const resumed = [...all, { address: "t9", state: "live", agent: "pi", status: "working", labels: { "agent.app": "pi", "agent.session": "bbbb2222" } }];
assert.ok(!recentSessions(resumed, listed, rememberSessions(store, resumed, listed, 200)).some((r) => r.sid === "bbbb2222"));
// X hides one; the shell still carrying its label doesn't bring it back; running it again does.
const hid = hideSession(store, "aaaa1111");
assert.equal(hideSession(store, "nope"), store);
assert.ok(!recentSessions(all, listed, rememberSessions(hid, all, listed, 200)).some((r) => r.sid === "aaaa1111"));
const again = [{ ...all[0], agent: "claude", status: "working" }, ...all.slice(1)];
assert.ok(!rememberSessions(hid, again, listed, 70000).aaaa1111.hidden);
// A hidden one stays hidden when its labelled shell changes folder (it didn't run again).
const moved = [{ ...all[0], cwd: "/elsewhere", labels: { ...all[0].labels, "herdr.space": "s9" } }, ...all.slice(1)];
assert.ok(rememberSessions(hid, moved, listed, 200).aaaa1111.hidden);
// A remote terminal's space label gets its machine prefix, as spaces() ids have.
const remote = [{ address: "lap/t2", state: "live", agent: "zsh", labels: { "agent.app": "pi", "agent.session": "ffff6666", "herdr.space": "s3" }, status_ms: 9 }];
assert.equal(rememberSessions({}, remote, new Set(), 100).ffff6666.space, "lap/s3");
// Resume opens on the session's own machine: its space, else any space there, never a local one.
const sps = [{ id: "s3", active: true }, { id: "lap/s1", machine: "lap" }, { id: "lap/s3", machine: "lap" }];
assert.equal(resumeSpace(sps, { address: "lap/t2", space: "lap/s3" }), "lap/s3");
assert.equal(resumeSpace(sps, { address: "lap/t2", space: "s3" }), "lap/s1"); // saved before 0.4.2, unprefixed
assert.equal(resumeSpace(sps, { address: "vps/t1", space: "s3" }), null);      // no space on vps here
assert.equal(resumeSpace(sps, { address: "t2", space: "gone" }), "s3");
// Old ones age out; at most 20 are kept.
assert.deepEqual(rememberSessions({ old1: { sid: "old1", app: "pi", address: "t0", seen: 0 } }, [], new Set(), 15 * 86400000), {});
const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`ssss${i}xx`, { sid: `ssss${i}xx`, app: "pi", address: `t${i}`, seen: 1000 + i }]));
assert.equal(Object.keys(rememberSessions(many, [], new Set(), 2000)).length, 20);
// A worktree and its main repo are one project; a folder outside git is its own, home shown as ~.
const main = projectOf(null, "/home/alex/code/acme", "/home/alex/code/acme/.git");
assert.deepEqual(main, { key: ":/home/alex/code/acme", name: "acme" });
assert.deepEqual(projectOf(null, "/home/alex/code/acme/.worktrees/fix-1", "/home/alex/code/acme/.git"), main);
assert.equal(projectOf(null, "/srv/acme.git", "/srv/acme.git").name, "acme");
assert.deepEqual(projectOf(null, "/home/alex/notes/", null), { key: ":/home/alex/notes", name: "~/notes" });
assert.equal(projectOf(null, "/home/alex", null).name, "~");
assert.equal(projectOf(null, "/", null).name, "/");
assert.equal(projectOf(null, null, null).name, "unknown folder");
assert.deepEqual(projectOf("vps", "/home/alex/code/acme", "/home/alex/code/acme/.git"), { key: "vps:/home/alex/code/acme", name: "vps: acme" });
console.log("ok");
