import json
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'agents-ids/mods/agents-ids/names.py'

def lines(path, *entries):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('\n'.join(json.dumps(e) for e in entries) + '\n')

class NamesTest(unittest.TestCase):
    def test_reads_each_agents_own_name(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / '.hermes').mkdir()
            db = sqlite3.connect(root / '.hermes/state.db')
            db.execute('CREATE TABLE sessions(id TEXT, title TEXT)')
            db.execute("INSERT INTO sessions VALUES('local-abc1', 'Fix the  acme\nbuild')")
            db.commit(); db.close()
            (root / '.local/share/opencode').mkdir(parents=True)
            db = sqlite3.connect(root / '.local/share/opencode/opencode.db')
            db.execute('CREATE TABLE session(id TEXT, title TEXT)')
            db.execute("INSERT INTO session VALUES('ses_abc1', 'OpenCode one')")
            db.commit(); db.close()
            lines(root / '.pi/agent/sessions/p/2024_pi-abc1.jsonl', {'type': 'session', 'id': 'pi-abc1'},
                  {'type': 'session_info', 'name': 'old'}, {'type': 'session_info', 'name': 'Pi renamed'})
            lines(root / '.codex/session_index.jsonl', {'id': 'cx-abc1', 'thread_name': 'Codex one'}, {'id': 'other', 'thread_name': 'no'})
            lines(root / '.claude/projects/p/cl-abc1.jsonl', {'type': 'ai-title', 'aiTitle': 'Auto'}, {'type': 'custom-title', 'customTitle': 'Mine'})
            lines(root / '.claude/projects/p/cl-abc2.jsonl', {'type': 'ai-title', 'aiTitle': 'Auto only'})
            args = ['hermes:local-abc1', 'opencode:ses_abc1', 'pi:pi-abc1', 'codex:cx-abc1', 'claude:cl-abc1', 'claude:cl-abc2',
                    'claude:missing1', 'claude:../../x', 'pig:pi-abc1']
            out = json.loads(subprocess.check_output(['python3', str(SCRIPT), '--root', d, *args], text=True))
            self.assertEqual(out, {'local-abc1': 'Fix the acme build', 'ses_abc1': 'OpenCode one', 'pi-abc1': 'Pi renamed',
                                   'cx-abc1': 'Codex one', 'cl-abc1': 'Mine', 'cl-abc2': 'Auto only'})

if __name__ == '__main__': unittest.main()
