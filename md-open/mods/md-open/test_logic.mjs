import assert from 'node:assert/strict';
import { splitTarget, isMarkdown, mdPaths, splitAddress } from './logic.mjs';
const screen = `Recommendation written: /home/alex/acme/.hermes/plans/2026-11-09-plan.md
see README.md:12 and (docs/setup.md), also ~/notes/todo.markdown.
diff a//home/alex/acme/CHANGELOG.md, not a.mdx or https://x.md/page or foo.md5
report: ~/Documents/Reports/q3.html and invoice.PDF, not https://acme.test/page.html or x.htmlx
again: /home/alex/acme/.hermes/plans/2026-11-09-plan.md`;
assert.deepEqual(mdPaths(screen), [
  '/home/alex/acme/.hermes/plans/2026-11-09-plan.md',
  'invoice.PDF',
  '~/Documents/Reports/q3.html',
  'a/home/alex/acme/CHANGELOG.md',
  '~/notes/todo.markdown',
  'docs/setup.md',
  'README.md',
]);
assert.deepEqual(mdPaths(null), []);
assert.equal(isMarkdown('/a/b.MD'), true);
assert.equal(isMarkdown('/a/b.html'), false);
assert.equal(isMarkdown('/a/b.pdf'), false);
assert.deepEqual(splitAddress('t7'), { machine: null, address: 't7' });
assert.deepEqual(splitAddress('box/t7'), { machine: 'box', address: 't7' });
const fr = (pane, tab) => ({ pane, tab, terminal: 't' + pane, program: { name: 'fresh' } });
assert.deepEqual(splitTarget([], 'a', 'p1'), { pane: 'p1', direction: 'right' });
assert.deepEqual(splitTarget([fr('p9', 'b'), { pane: 'p1', tab: 'a', terminal: 't1', program: { name: 'hermes' } }], 'a', 'p1'), { pane: 'p1', direction: 'right' });
assert.deepEqual(splitTarget([fr('p2', 'a'), fr('p3', 'a')], 'a', 'p1'), { pane: 'p3', direction: 'down' });
console.log('md-open logic ok');
