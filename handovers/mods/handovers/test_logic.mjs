import assert from "node:assert/strict";
import { age, agentOf, badge, continueTab, folders, parseNotes, resumeArgv, spaceFor, yourTurn } from "./logic.mjs";

const note = (o = {}) => ({ path: "/home/alex/acme/.hermes/plans/x-handover.md", root: "/home/alex/acme", title: "X", you: [], agent: [], mtime: 0, machine: null, ...o });

assert.equal(agentOf(note({ app: "Claude" })), "claude");
assert.equal(agentOf(note({ app: "__proto__" })), "hermes");
assert.deepEqual(continueTab(note()).argv.slice(0, 4), ["hermes", "chat", "--tui", "-q"]);
assert.match(continueTab(note()).argv[4], /^Read \/home\/alex\/acme\/.hermes\/plans\/x-handover.md, .* wait for my go/);
assert.equal(continueTab(note()).task, undefined);
assert.deepEqual(continueTab(note({ app: "claude" })).argv, ["claude"]);
assert.match(continueTab(note({ app: "claude" })).task, /^Read /);
assert.deepEqual(resumeArgv(note({ session: "local-abcd1234" })), ["hermes", "--tui", "--resume", "local-abcd1234"]);
assert.deepEqual(resumeArgv(note({ app: "pi", session: "abcd" })), ["pi", "--session", "abcd"]);
assert.equal(resumeArgv(note({ session: "x; rm -rf ~" })), null);
assert.equal(resumeArgv(note()), null);

const notes = parseNotes(JSON.stringify([note(), { path: 1 }, null, note({ you: "x" })]), "box");
assert.equal(notes.length, 1);
assert.equal(notes[0].machine, "box");
assert.deepEqual(parseNotes("nope"), []);

assert.equal(yourTurn(note({ you: [{ text: "a", done: true }] })), false);
assert.equal(yourTurn(note({ you: [{ text: "a", done: false }] })), true);
assert.equal(badge([]), "0");
assert.equal(badge([note(), note({ you: [{ text: "a", done: false }] })]), "2 · 1 yours");
assert.equal(badge([note()]), "1");

const spaces = [
  { id: "s1", machine: null, folder: "/home/alex/web", active: true, tabs: [{ id: "a" }] },
  { id: "s2", machine: null, folder: "/home/alex/acme/.worktrees/b", active: false, tabs: [{ id: "b" }] },
  { id: "box/s3", machine: "box", folder: "", active: false, tabs: [{ id: "box/c" }] },
];
const panes = [{ tab: "a", cwd: "/home/alex/web/src" }, { tab: "box/c", cwd: "/srv/acme" }, { tab: "gone", cwd: "/x" }];
assert.deepEqual(folders(spaces, panes), [
  { machine: null, dirs: ["/home/alex/web", "/home/alex/acme/.worktrees/b", "/home/alex/web/src"] },
  { machine: "box", dirs: ["/srv/acme"] },
]);
assert.equal(spaceFor(note(), spaces).id, "s2");
assert.equal(spaceFor(note({ root: "/home/alex/other" }), spaces).id, "s1");
assert.equal(spaceFor(note({ machine: "box" }), spaces).id, "box/s3");
assert.equal(spaceFor(note({ machine: "far" }), spaces), null);

assert.equal(age(0, 30), "1m");
assert.equal(age(0, 2 * 3600), "2h");
assert.equal(age(0, 3 * 86400), "3d");
console.log("handovers logic ok");
