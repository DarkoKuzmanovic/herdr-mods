import assert from "node:assert/strict";
import { count, groups, keyMachine, matches, parsePrompts, projectKey, projectName, remove, save } from "./logic.mjs";

assert.equal(projectKey(null, "/home/alex/acme"), "/home/alex/acme");
assert.equal(projectKey("box", "/home/alex/acme"), "box:/home/alex/acme");
assert.equal(projectKey(null, ""), "");
assert.equal(keyMachine(null, null, "lap"), null);
assert.equal(keyMachine("box", null, "lap"), "box");
assert.equal(keyMachine("box", "box", "lap"), null);
assert.equal(keyMachine(null, "box", "lap"), "lap");
assert.equal(keyMachine("other", "box", "lap"), "other");
assert.equal(projectName("box:/home/alex/acme"), "acme");

assert.deepEqual(parsePrompts("not json"), []);
assert.deepEqual(parsePrompts('{"a":1}'), []);
assert.deepEqual(parsePrompts('[null, {"id":"a","text":"hi","project":""}, {"id":1,"text":"x","project":""}]'), [{ id: "a", text: "hi", project: "" }]);
assert.deepEqual(parsePrompts(null), []);

let ps = save([], { text: "global one", project: "", at: 1 });
ps = save(ps, { text: "acme one", project: "/home/alex/acme", at: 2 });
ps = save(ps, { text: "other", project: "/home/alex/other", at: 3 });
ps = save(ps, { text: "   ", project: "", at: 4 });
assert.equal(ps.length, 3);
const titles = (gs) => gs.map((g) => `${g.title}: ${g.items.map((p) => p.text).join(", ")}`);
// All: this project first, then Global, then the others.
assert.deepEqual(titles(groups(ps, "/home/alex/acme", "all")), ["acme: acme one", "Global: global one", "other: other"]);
assert.deepEqual(titles(groups(ps, "/home/alex/acme", "project")), ["acme: acme one"]);
assert.deepEqual(titles(groups(ps, "/home/alex/acme", "global")), ["Global: global one"]);
// No project: Global first, then projects by their newest prompt.
assert.deepEqual(titles(groups(ps, "", "all")), ["Global: global one", "other: other", "acme: acme one"]);
assert.deepEqual([count(ps, "/home/alex/acme", "project"), count(ps, "/home/alex/acme", "global"), count(ps, "", "all")], [1, 1, 3]);
// Search: text or project name, any case; empty groups drop out.
assert.deepEqual(titles(groups(ps, "/home/alex/acme", "all", "OTHER")), ["other: other"]);
assert.deepEqual(titles(groups(ps, "/home/alex/acme", "all", "  acme ")), ["acme: acme one"]);
assert.equal(matches({ text: "Hi", project: "" }, "   "), true);
assert.deepEqual(groups(ps, "/home/alex/acme", "all", "zzz"), []);

// Editing keeps the id and can move a prompt between project and global.
const id = ps.find((p) => p.text === "acme one").id;
ps = save(ps, { id, text: "acme edited", project: "", at: 5 });
assert.equal(ps.length, 3);
assert.deepEqual(titles(groups(ps, "/home/alex/acme", "all")), ["Global: acme edited, global one", "other: other"]);

ps = remove(ps, id);
assert.deepEqual(ps.map((p) => p.text).sort(), ["global one", "other"]);
console.log("prompts logic ok");
