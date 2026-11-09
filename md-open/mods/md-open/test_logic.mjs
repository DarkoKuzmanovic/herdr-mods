import assert from 'node:assert/strict';
import { mdPaths, splitAddress } from './logic.mjs';
const screen = `Recommendation written: /home/alex/acme/.hermes/plans/2026-11-09-plan.md
see README.md:12 and (docs/setup.md), also ~/notes/todo.markdown.
diff a//home/alex/acme/CHANGELOG.md, not a.mdx or https://x.md/page or foo.md5
again: /home/alex/acme/.hermes/plans/2026-11-09-plan.md`;
assert.deepEqual(mdPaths(screen), [
  '/home/alex/acme/.hermes/plans/2026-11-09-plan.md',
  'a/home/alex/acme/CHANGELOG.md',
  '~/notes/todo.markdown',
  'docs/setup.md',
  'README.md',
]);
assert.deepEqual(mdPaths(null), []);
assert.deepEqual(splitAddress('t7'), { machine: null, address: 't7' });
assert.deepEqual(splitAddress('box/t7'), { machine: 'box', address: 't7' });
console.log('md-open logic ok');
