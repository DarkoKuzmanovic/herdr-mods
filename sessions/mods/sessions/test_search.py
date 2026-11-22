import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('search.py')

class SearchTest(unittest.TestCase):
    def test_new_sources(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            claude = root / '.claude/projects/project/claude-123.jsonl'
            codex = root / '.codex/sessions/2026/01/02/rollout-one.jsonl'
            for path in (claude, codex):
                path.parent.mkdir(parents=True, exist_ok=True)
            claude.write_text('\n'.join(map(json.dumps, [
                {'type': 'user', 'cwd': d, 'message': {'role': 'user', 'content': 'Claude first'}},
                {'type': 'assistant', 'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': 'needle Claude answer'}]}},
            ])))
            codex.write_text('\n'.join(map(json.dumps, [
                {'type': 'session_meta', 'payload': {'session_id': 'codex-123', 'cwd': d}},
                {'type': 'response_item', 'payload': {'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': '# AGENTS.md instructions\n\n<INSTRUCTIONS>not the user</INSTRUCTIONS>'}]}},
                {'type': 'response_item', 'payload': {'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': 'Codex first'}]}},
                {'type': 'response_item', 'payload': {'type': 'message', 'role': 'assistant', 'content': [{'type': 'output_text', 'text': 'needle Codex answer'}]}},
            ])))
            # Scripted runs are left out: Claude SDK / `claude -p`, `codex exec`.
            (root / '.claude/projects/project/claude-sdk1.jsonl').write_text(json.dumps(
                {'type': 'user', 'entrypoint': 'sdk-cli', 'cwd': d, 'message': {'role': 'user', 'content': 'needle scripted'}}))
            (codex.parent / 'rollout-two.jsonl').write_text('\n'.join(map(json.dumps, [
                {'type': 'session_meta', 'payload': {'id': 'codex-exec1', 'cwd': d, 'originator': 'codex_exec'}},
                {'type': 'response_item', 'payload': {'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': 'needle scripted'}]}},
            ])))
            dbpath = root / '.local/share/opencode/opencode.db'
            dbpath.parent.mkdir(parents=True)
            db = sqlite3.connect(dbpath)
            db.executescript('''
                CREATE TABLE session_v2(id TEXT, title TEXT, directory TEXT, time_updated INTEGER);
                CREATE TABLE session_message(id TEXT, session_id TEXT, type TEXT, seq INTEGER, data TEXT);
                CREATE TABLE session(id TEXT, title TEXT, directory TEXT, time_updated INTEGER);
                CREATE TABLE message(id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
                CREATE TABLE part(message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
            ''')
            db.execute('INSERT INTO session_v2 VALUES(?,?,?,?)', ('open-v2', 'Open v2', d, 1700000000000))
            db.execute('INSERT INTO session_message VALUES(?,?,?,?,?)', ('msg-v2', 'open-v2', 'user', 1, json.dumps({'text':'needle v2'})))
            db.execute('INSERT INTO session VALUES(?,?,?,?)', ('open-v1', 'Open legacy', d, 1700000001000))
            db.execute('INSERT INTO message VALUES(?,?,?,?)', ('msg-v1', 'open-v1', 1, json.dumps({'role':'user'})))
            db.execute('INSERT INTO part VALUES(?,?,?,?)', ('msg-v1', 'open-v1', 1, json.dumps({'type':'text','text':'needle legacy'})))
            db.commit()
            db.close()
            env = {**os.environ, 'HERDR_SESSIONS_ROOT': d}
            rows = json.loads(subprocess.check_output(['python3', str(SCRIPT), '--', 'needle'], env=env, text=True))
            by_id = {r['id']: r for r in rows}
            self.assertEqual(set(by_id), {'claude-123', 'codex-123', 'open-v1', 'open-v2'})
            self.assertEqual(by_id['claude-123']['title'], 'Claude first')
            self.assertEqual(by_id['codex-123']['title'], 'Codex first')
            self.assertEqual(by_id['open-v1']['title'], 'Open legacy')
            self.assertEqual(by_id['open-v2']['timestamp'], 1700000000)
            self.assertTrue(all(r['cwd'] == d and r['folder_exists'] and 'needle' in r['snippet'] for r in rows))
            self.assertAlmostEqual(by_id['claude-123']['timestamp'], claude.stat().st_mtime)
            self.assertAlmostEqual(by_id['codex-123']['timestamp'], codex.stat().st_mtime)
            title_rows = json.loads(subprocess.check_output(['python3', str(SCRIPT), '--', 'Open legacy'], env=env, text=True))
            self.assertEqual(title_rows[0]['id'], 'open-v1')
            self.assertIn('Open legacy', title_rows[0]['snippet'])

if __name__ == '__main__': unittest.main()
