import assert from "node:assert/strict";
import { parsePrompts, projectKey, projectName, remove, save, visible } from "./logic.mjs";

assert.equal(projectKey(null, "/home/alex/acme"), "/home/alex/acme");
assert.equal(projectKey("box", "/home/alex/acme"), "box:/home/alex/acme");
assert.equal(projectKey(null, ""), "");
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
assert.deepEqual(visible(ps, "/home/alex/acme").map((p) => p.text), ["acme one", "global one"]);
assert.deepEqual(visible(ps, "").map((p) => p.text), ["global one"]);

// Editing keeps the id and can move a prompt between project and global.
const id = ps.find((p) => p.text === "acme one").id;
ps = save(ps, { id, text: "acme edited", project: "", at: 5 });
assert.equal(ps.length, 3);
assert.deepEqual(visible(ps, "/home/alex/acme").map((p) => p.text), ["acme edited", "global one"]);

ps = remove(ps, id);
assert.deepEqual(ps.map((p) => p.text).sort(), ["global one", "other"]);
console.log("prompts logic ok");
