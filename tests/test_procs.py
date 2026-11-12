import json
import os
import subprocess
import sys
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'agents-ids/mods/agents-ids/procs.py'

class ProcsTest(unittest.TestCase):
    def test_names_work_under_a_shell(self):
        # No terminal: the shell is its own foreground, so everything under it is work.
        # Without HC_* vars: run inside a herdr terminal, the test would see that terminal's processes too.
        env = {k: v for k, v in os.environ.items() if not k.startswith('HC_')}
        sh = subprocess.Popen(['sh', '-c', 'sleep 30; true'], start_new_session=True, env=env)
        try:
            time.sleep(0.3)
            out = json.loads(subprocess.run([sys.executable, '-I', str(SCRIPT), str(sh.pid), '999999999', 'x'],
                                            capture_output=True, text=True, check=True).stdout)
            self.assertEqual(out, {str(sh.pid): {'fg': None, 'runs': ['sleep 30']}})
        finally:
            sh.kill()
            sh.wait()

    def test_short_command(self):
        sys.path.insert(0, str(SCRIPT.parent))
        import procs
        self.assertEqual(procs.short(['/usr/bin/python3', '-c', 'import os\nprint(1)', 'chat']), 'python3 -c … chat')
        self.assertEqual(len(procs.short(['make'] + ['x' * 10] * 10)), 60)

if __name__ == '__main__':
    unittest.main()
