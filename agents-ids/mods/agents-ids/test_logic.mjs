// Self-check for agents-ids: node mods/agents-ids/test_logic.mjs
import assert from "node:assert/strict";
import { briefName, effStatus, herds, herdSummary, inputBox, thirdLine, agentKey, sessionFromArgv, closeFacts, sameTerminal, doingLine, stalls, hideSession, projectOf, recentSessions, rememberSessions, reopenable, reopenSpace, reopenSummary, resumeArgv, resumeSpace, runningSids, shortSid, snapshotOf, snapshotPath, unloadRows, ICON_SETS, iconSet } from "./extras.mjs";
import { existsSync } from "node:fs";

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

// Save & close: one row per known agent; unsafe when working, blocked, running work, or sharing a busy tab.
assert.equal(agentKey("claude-code"), "claude");
assert.equal(agentKey("__proto__"), null);
assert.equal(snapshotPath("/home/alex", "/home/alex/.config/herdr-app"), "/home/alex/.local/state/herdr-mods/session-snapshot.json");
assert.equal(snapshotPath("/home/alex", "/tmp/demo/home"), "/tmp/demo/home/data/herdr-mods/session-snapshot.json");
const ag = (address, status, tab, app = "pi") => ({ address, status, tab, pane: `p-${address}`, app, space: tab === "lap/tb3" ? "lap/s2" : "s1", space_name: "acme", tab_name: "1" });
const terms = [
  { address: "t1", state: "live", cwd: "/home/alex/acme", labels: { "agent.app": "pi", "agent.session": "sess-0001" } },
  { address: "t2", state: "live", labels: { "agent.doing": "running: npm test" } },
  { address: "t3", state: "live", labels: {} },
  { address: "t4", state: "live", labels: {} },          // a shell beside t3
  { address: "t5", state: "live", labels: {} },
  { address: "t6", state: "live", labels: {} },
  { address: "lap/t1", state: "live", labels: { "agent.session": "lap-0001" } },
  { address: "t8", state: "live", parent: "t6", labels: {} }, // t6's sub-agent
];
const spaceList = [{ id: "s1", machine: null, name: "acme", tabs: [{ id: "tb1", name: "fix", named: true }, { id: "tb2", name: "2", named: false }] }, { id: "lap/s2", machine: "lap", name: "notes", tabs: [{ id: "lap/tb3", name: "1", named: false }] }];
const paneList = [{ tab: "tb2", terminal: "t3" }, { tab: "tb2", terminal: "t4" }];
const procs = new Map([["t1", { fg: "pi", runs: [] }], ["t3", { fg: "pi", runs: [] }], ["t4", { fg: "npm run dev", runs: [] }], ["t5", { fg: "pi", runs: ["make ci-wait PR=1118", "sleep 5"] }], ["t6", { fg: "pi", runs: [] }], ["lap/t1", null]]);
const rows = unloadRows([ag("t1", "idle", "tb1"), ag("t2", "working", "tb1"), ag("t3", "idle", "tb2"), ag("t5", "done", "tb1"), ag("t6", "idle", "tb1"), ag("t7", "idle", "tb1", "vim"), ag("lap/t1", "blocked", "lap/tb3", "hermes"), ag("t9", "idle", "tb1")],
  [...terms, { address: "t7", state: "live", labels: {} }, { address: "t9", state: "live", labels: { "agent.app": "codex" } }], paneList, spaceList, procs);
assert.deepEqual(rows.map((r) => [r.address, r.cause]), [
  ["t1", null],
  ["t2", "working: running: npm test"],
  ["t3", "same tab: t4 runs: npm run dev"],
  ["t5", "runs: make ci-wait PR=1118 +1"],
  ["t6", "1 sub-agent running"],
  ["lap/t1", "waiting for your answer"],
  ["t9", "checking processes…"],
]);
assert.equal(unloadRows([ag("lap/t1", "idle", "lap/tb3", "hermes")], terms, [], spaceList, procs)[0].cause, "couldn't check processes");
assert.deepEqual(rows[0], { address: "t1", pane: "p-t1", machine: null, space: "s1", space_name: "acme", tab: "tb1", tab_label: "fix", tab_name: "fix", folder: "/home/alex/acme",
  app: "pi", session: "sess-0001", argv: ["pi", "--session", "sess-0001"], status: "idle", cause: null });
assert.equal(rows[2].tab_name, null); // an automatic tab number isn't a name to restore
const snap = snapshotOf(rows, 0);
assert.equal(snap.saved_at, "1970-01-01T00:00:00.000Z");
assert.deepEqual(snap.rows.map((r) => [r.address, r.resumable]), [["t1", true], ["t2", false], ["t3", false], ["t5", false], ["t6", false], ["lap/t1", true], ["t9", false]]);
assert.deepEqual(snap.rows[5], { machine: "lap", space: "lap/s2", space_name: "acme", tab_name: null, folder: null, app: "hermes", session: "lap-0001", address: "lap/t1", argv: ["hermes", "--resume", "lap-0001"], resumable: true });
// A reopened agent that hasn't labelled itself yet keeps its id from how it was started.
assert.equal(sessionFromArgv("hermes", ["python3", "-c", "x", "--resume", "local-abcd1"]), "local-abcd1");
assert.equal(sessionFromArgv("codex", ["codex", "resume", "abcd1234"]), "abcd1234");
assert.equal(sessionFromArgv("pi", ["pi", "--session", "x; rm"]), null);
assert.equal(sessionFromArgv("pi", undefined), null);
assert.equal(unloadRows([ag("t30", "idle", "tb1", "hermes")], [{ address: "t30", state: "live", labels: {}, foreground: { argv: ["hermes", "--resume", "local-abcd1"] } }], [], spaceList, new Map())[0].session, "local-abcd1");
// Reopen: skips what runs now, by label or by the id its program was started with.
const later = [{ address: "t20", state: "live", status: "idle", labels: { "agent.session": "sess-0001" } }];
assert.ok(runningSids(later, new Set()).has("sess-0001"));
assert.ok(runningSids([{ address: "t21", state: "live", foreground: { argv: ["hermes", "--resume", "lap-0001"] }, labels: {} }], new Set()).has("lap-0001"));
assert.ok(!runningSids([{ address: "t22", state: "live", argv: ["zsh", "-ic", "pi", "--session", "x-0001"], labels: { "agent.session": "y-0001" } }], new Set()).has("x-0001")); // agent quit: its shell's argv doesn't count
assert.deepEqual(reopenable(snap, new Set()).map((r) => r.address), ["t1", "lap/t1"]);
assert.deepEqual(reopenable(snap, runningSids(later, new Set())).map((r) => r.address), ["lap/t1"]);
assert.deepEqual(reopenable({ rows: [{ ...snap.rows[0], app: "__proto__" }] }, new Set()), []); // the file is input too
assert.deepEqual(reopenable(null, new Set()), []);
const spaceNow = [{ id: "s9", machine: null, name: "acme" }, { id: "lap/s2", machine: "lap", name: "acme" }];
assert.equal(reopenSpace(spaceNow, snap.rows[0]), "s9");          // gone by id, found by name
assert.equal(reopenSpace(spaceNow, snap.rows[5]), "lap/s2");      // by id
assert.equal(reopenSpace([{ id: "lap/s2", machine: "lap", name: "acme" }], snap.rows[0]), null); // another machine's space never
assert.equal(reopenSummary([{ done: "" }, { done: "" }, { skip: "already open" }, { fail: "lap offline" }]), "Reopened 2 · skipped 1 (already open) · failed 1 (lap offline)");
assert.equal(reopenSummary([]), "Nothing to reopen");

// 0.9.0: Next line, waiting, herds, send to several.
assert.equal(closeFacts("idle", 0, 0, 2).at(-1), "Herd: 2 tabs still open (they keep running)");
assert.equal(closeFacts("idle", 0, 0).length, 4);
const asks = { "agent.next": "your go for the test", "agent.needs": "you", "agent.waiting": "gh" };
assert.equal(effStatus("done", asks), "asks");
assert.equal(effStatus("idle", { ...asks, "agent.needs": "no" }), "waiting");
assert.equal(effStatus("working", asks), "working");   // a running turn is Herdr's to say
assert.equal(effStatus("blocked", asks), "blocked");
assert.equal(effStatus("done", { "agent.needs": "you" }), "done"); // needs without a Next line: nothing to show
assert.equal(effStatus("done", undefined), "done");
const t0 = 1000 * 1000;
assert.deepEqual(thirdLine(asks, "done", t0), { text: "→ your go for the test", you: true, stale: false, tip: "Next: your go for the test\nwaiting: gh" });
assert.deepEqual(thirdLine({ "agent.waiting": "make", "agent.doing": "done", "agent.doing.since": "1000" }, "idle", t0 + 4 * 60000),
  { text: "waiting: make · 4m", you: false, stale: false, tip: "background jobs will wake it" });
assert.equal(thirdLine({ ...asks, "agent.doing": "thinking" }, "working", t0).text, "thinking");
assert.equal(thirdLine({ "agent.next": "a\nb\n\nc" }, "done", t0).text, "→ a b c"); // never more lines
assert.equal(thirdLine({}, "done", t0), null);
const live = (address, labels = {}) => ({ address, state: "live", labels });
const h = herds([live("t1"), live("t2", { "agent.lead": "t1" }), live("t3", { "agent.lead": "t1" }), live("t4", { "agent.lead": "t9" }),
  { ...live("t5", { "agent.lead": "t1" }), state: "finished" }, live("box/t6", { "agent.lead": "t1" }), live("t7", { "agent.lead": "t7" })]);
assert.deepEqual([...h.byLead], [["t1", ["t2", "t3"]]]);
assert.deepEqual([...h.gone], ["t4"]);
assert.equal(herdSummary(["working", "asks", "blocked", "done", "idle", "waiting"]), "herd · 1 working · 2 needs you · 1 waiting · 2 done");
assert.equal(herdSummary([]), "herd");
assert.equal(briefName({ "agent.brief": "/home/alex/briefs/2026-11-12-fix.md" }), "fix");
assert.equal(briefName({ "agent.brief": "/home/alex/BRIEF.md" }), "BRIEF");
assert.equal(briefName({}), "");
const BAR = " ─ ready │ opus 5.5 │ 80k/500k\n";
assert.equal(inputBox("hermes", "  ❯ old message in the transcript\n...\n" + BAR + " ❯\n\n"), "");
assert.equal(inputBox("hermes", BAR + " ❯ Ctrl+C to interrupt…"), "");
assert.equal(inputBox("hermes", BAR + " ❯ half a thought"), "half a thought");
assert.equal(inputBox("hermes", BAR + " ❯\n   second line of a draft"), null); // multi-line draft
assert.equal(inputBox("hermes", "  ❯ old message in the transcript\n   reply text"), null); // no composer at the bottom
assert.equal(inputBox("hermes", "no prompt on screen"), null);
assert.equal(inputBox("claude", " ❯"), null); // only agents whose box is known
for (const s of ICON_SETS.slice(1)) for (const k of ["working", "blocked", "asks", "waiting", "idle", "done"]) assert.ok(existsSync(new URL(`icons/${s.icons[k]}.svg`, import.meta.url)), `${s.id} ${k}`);
assert.equal(iconSet("nope").id, "default");
for (const s of ICON_SETS) if (s.scan) assert.ok(existsSync(new URL(`icons/${s.scan}.svg`, import.meta.url)), `${s.id} scan`);
console.log("ok");
