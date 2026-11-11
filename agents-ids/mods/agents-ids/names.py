#!/usr/bin/env python3
"""Session names for Recent sessions: `names.py [--root DIR] app:sid ...` prints {sid: name}.
Reads each agent's own history read-only; a session without a name, or an unreadable store, is left out."""
import json
import os
from pathlib import Path
import re
import sqlite3
import sys

ID = re.compile(r'^[\w.-]{4,128}$', re.ASCII)

def sql(path, query, sid):
    if not path.is_file():
        return None
    db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=0.5)
    try:
        row = db.execute(query, (sid,)).fetchone()
        return row[0] if row else None
    finally:
        db.close()

def last(path, pick):
    """The last non-empty value `pick` finds in a JSON-lines file."""
    found = None
    with path.open(encoding='utf-8', errors='replace') as f:
        for line in f:
            if 'title' in line or 'name' in line:
                try:
                    found = pick(json.loads(line)) or found
                except (ValueError, AttributeError):
                    pass
    return found

def name(root, app, sid):
    if app == 'hermes':
        return sql(root / '.hermes/state.db', 'SELECT title FROM sessions WHERE id=?', sid)
    if app == 'opencode':
        return sql(root / '.local/share/opencode/opencode.db', 'SELECT title FROM session WHERE id=?', sid)
    if app in ('pi', 'pig'):
        for p in (root / f'.{app}/agent/sessions').glob(f'*/*_{sid}.jsonl'):
            return last(p, lambda e: e.get('type') == 'session_info' and e.get('name'))
    if app == 'codex':
        p = root / '.codex/session_index.jsonl'
        return last(p, lambda e: e.get('id') == sid and e.get('thread_name')) if p.is_file() else None
    if app == 'claude':
        # A /rename title wins over the one Claude Code writes itself.
        for p in (root / '.claude/projects').glob(f'*/{sid}.jsonl'):
            custom = last(p, lambda e: e.get('type') == 'custom-title' and e.get('customTitle'))
            return custom or last(p, lambda e: e.get('type') == 'ai-title' and e.get('aiTitle'))
    return None

def main(args):
    root = Path(os.path.expanduser('~'))
    if args[:1] == ['--root']:
        root, args = Path(args[1]), args[2:]
    out = {}
    for arg in args:
        app, _, sid = arg.partition(':')
        if not ID.fullmatch(sid):
            continue
        try:
            n = name(root, app, sid)
        except (OSError, sqlite3.Error):
            continue
        if isinstance(n, str) and n.strip():
            out[sid] = ' '.join(n.split())[:120]
    print(json.dumps(out))

if __name__ == '__main__':
    main(sys.argv[1:])
