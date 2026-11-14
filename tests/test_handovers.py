import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'handovers/mods/handovers/handovers.py'

NOTE = """---
title: API connector
app: hermes
session: local-abcd1234
---
# Handover: acme connector

## You
- [ ] Send Robin the guide
- Rotate the `old` key

## Agent
- Test sign-in from the **desktop** app
- Close #12

## Notes
- not an item
"""


def run(home, *args):
    env = {**os.environ, 'HOME': str(home)}
    r = subprocess.run(['python3', str(SCRIPT), *args], text=True, capture_output=True, env=env)
    return r


class HandoversTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name) / 'alex'
        self.plans = self.home / 'code/acme/.hermes/plans'
        self.plans.mkdir(parents=True)
        self.note = self.plans / '2026-01-02-connector-handover.md'
        self.note.write_text(NOTE)
        (self.plans / '2026-01-01-pilot-handovers.md').write_text('# not a note\n')
        (self.plans / 'other.md').write_text('# plan\n')
        (self.home / 'code/acme/.worktrees/x').mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def notes(self, *folders):
        r = run(self.home, 'list', *folders)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_list_finds_note_from_worktree_once(self):
        acme = self.home / 'code/acme'
        notes = self.notes(str(acme / '.worktrees/x'), str(acme), str(self.home))
        self.assertEqual(len(notes), 1)
        n = notes[0]
        self.assertEqual(n['title'], 'API connector')
        self.assertEqual((n['app'], n['session']), ('hermes', 'local-abcd1234'))
        self.assertEqual(n['root'], str(acme.resolve()))
        self.assertEqual(n['you'], [{'text': 'Send Robin the guide', 'done': False}, {'text': 'Rotate the old key', 'done': False}])
        self.assertEqual(n['agent'], ['Test sign-in from the desktop app', 'Close #12'])

    def test_home_and_outside_folders_are_not_scanned(self):
        (self.home / '.hermes/plans').mkdir(parents=True)
        (self.home / '.hermes/plans/x-handover.md').write_text('# home\n')
        self.assertEqual(self.notes(str(self.home), '/'), [])

    def test_tick_toggles_and_done_hides(self):
        self.assertEqual(run(self.home, 'tick', str(self.note), '1').returncode, 0)
        self.assertIn('- [x] Rotate the `old` key', self.note.read_text())
        self.assertEqual(self.notes(str(self.plans))[0]['you'][1]['done'], True)
        run(self.home, 'tick', str(self.note), '1')
        self.assertIn('- [ ] Rotate the `old` key', self.note.read_text())
        self.assertEqual(run(self.home, 'done', str(self.note)).returncode, 0)
        text = self.note.read_text()
        self.assertTrue(text.startswith('---\ntitle: API connector'))
        self.assertIn('status: done\n---\n# Handover', text)
        self.assertEqual(self.notes(str(self.plans)), [])

    def test_done_adds_front_matter_and_title_falls_back_to_heading(self):
        bare = self.plans / 'handover.md'
        bare.write_text('# Handover: Plain note\n\n## You\n- [ ] one\n')
        self.assertEqual(sorted(n['title'] for n in self.notes(str(self.plans))), ['API connector', 'Plain note'])
        run(self.home, 'done', str(bare))
        self.assertEqual(bare.read_text(), '---\nstatus: done\n---\n# Handover: Plain note\n\n## You\n- [ ] one\n')

    def test_refuses_files_that_are_not_notes(self):
        other = self.plans / 'other.md'
        for args in (('tick', str(other), '0'), ('done', str(other)), ('done', '/etc/passwd'), ('tick', str(self.note), 'x')):
            self.assertNotEqual(run(self.home, *args).returncode, 0, args)
        self.assertEqual(other.read_text(), '# plan\n')


if __name__ == '__main__':
    unittest.main()
