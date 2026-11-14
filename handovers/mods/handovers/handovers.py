"""Handover notes for the handovers mod. Sent to each machine as source (`python3 -c`), stdlib only.

  list <folder>...      JSON: every open `.hermes/plans/*-handover.md` (or `handover.md`) found in each
                        folder or a folder above it (below home)
  tick <file> <n>       toggle the n-th item (from 0) of the note's `## You` list
  done <file>           mark the note done (`status: done` in its front matter)

Paths come in as arguments; a file is touched only when it is a handover note in a `.hermes/plans` folder.
"""
import json, os, re, sys

NAME = re.compile(r'^(.+-)?handover\.md$')
ITEM = re.compile(r'^(\s*)[-*] (\[[ xX]\] )?(.*)$')


def is_note(path):
    p = os.path.realpath(path)
    return (NAME.match(os.path.basename(p)) and os.path.basename(os.path.dirname(p)) == 'plans'
            and os.path.basename(os.path.dirname(os.path.dirname(p))) == '.hermes' and os.path.isfile(p))


def split(text):
    """(front matter dict, its lines or None, body lines)."""
    lines = text.split('\n')
    if lines and lines[0].strip() == '---':
        for i in range(1, len(lines)):
            if lines[i].strip() == '---':
                fm = {}
                for ln in lines[1:i]:
                    k, _, v = ln.partition(':')
                    if _:
                        fm[k.strip().lower()] = v.strip()
                return fm, lines[:i + 1], lines[i + 1:]
    return {}, None, lines


def sections(body):
    """{'you': [(line index in body, match)], 'agent': [...]}: top-level list items under `## You` / `## Agent`."""
    out, cur = {'you': [], 'agent': []}, None
    for i, ln in enumerate(body):
        if ln.startswith('#'):
            name = ln.lstrip('#').strip().lower()
            cur = 'you' if name.startswith('you') else 'agent' if name.startswith('agent') else None
        elif cur and (m := ITEM.match(ln)) and not m.group(1):
            out[cur].append((i, m))
    return out


def clean(s):
    return re.sub(r'[`*_]', '', s).strip()


def note(path):
    with open(path, encoding='utf-8') as f:
        text = f.read(256 * 1024)
    fm, _, body = split(text)
    if fm.get('status', 'open').lower() == 'done':
        return None
    sec = sections(body)
    heading = next((ln.lstrip('#').strip() for ln in body if ln.startswith('# ')), '')
    title = fm.get('title') or re.sub(r'^handover:\s*', '', heading, flags=re.I) or os.path.basename(path)[:-3]
    you = [{'text': clean(m.group(3)), 'done': (m.group(2) or '').lower() == '[x] '} for _, m in sec['you']]
    return {'path': path, 'root': os.path.dirname(os.path.dirname(os.path.dirname(path))), 'title': clean(title)[:80],
            'app': fm.get('app', ''), 'session': fm.get('session', ''), 'you': you,
            'agent': [clean(m.group(3)) for _, m in sec['agent']][:4],
            'mtime': int(os.path.getmtime(path))}


def roots(folder, home):
    """`folder` and each folder above it, stopping before home (worktrees under a repo reach the repo)."""
    d = os.path.realpath(os.path.expanduser(folder))
    while d not in (home, '/') and d.startswith(home + '/'):
        yield d
        d = os.path.dirname(d)


def list_notes(folders):
    home, seen, out = os.path.realpath(os.path.expanduser('~')), set(), []
    for folder in folders:
        for r in roots(folder, home):
            plans = os.path.join(r, '.hermes', 'plans')
            if r in seen or not os.path.isdir(plans):
                seen.add(r)
                continue
            seen.add(r)
            for name in sorted(os.listdir(plans)):
                p = os.path.join(plans, name)
                if is_note(p):
                    try:
                        n = note(p)
                    except (OSError, UnicodeDecodeError):
                        continue
                    if n:
                        out.append(n)
    return sorted(out, key=lambda n: -n['mtime'])


def write(path, old, new):
    # Re-read right before writing: an agent editing the note meanwhile wins, and this edit is dropped.
    with open(path, encoding='utf-8') as f:
        if f.read() != old:
            raise SystemExit('changed meanwhile')
    tmp = path + '.tmp-handovers'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(new)
    os.replace(tmp, path)


def tick(path, n):
    with open(path, encoding='utf-8') as f:
        text = f.read()
    fm, fm_lines, body = split(text)
    i, m = sections(body)['you'][n]
    box = '[ ] ' if (m.group(2) or '').lower() == '[x] ' else '[x] '
    body[i] = body[i][:2] + box + m.group(3)
    write(path, text, '\n'.join((fm_lines or []) + body))


def done(path):
    with open(path, encoding='utf-8') as f:
        text = f.read()
    fm, fm_lines, body = split(text)
    if fm_lines is None:
        fm_lines = ['---', '---']
    fm_lines = [ln for ln in fm_lines if ln.partition(':')[0].strip().lower() != 'status']
    write(path, text, '\n'.join(fm_lines[:-1] + ['status: done', '---'] + body))


def main(argv):
    cmd, args = argv[0], argv[1:]
    if cmd == 'list':
        print(json.dumps(list_notes(args)))
        return
    if not args or not is_note(args[0]):
        raise SystemExit('not a handover note')
    path = os.path.realpath(args[0])
    if cmd == 'tick' and len(args) == 2 and args[1].isdigit():
        tick(path, int(args[1]))
    elif cmd == 'done':
        done(path)
    else:
        raise SystemExit('usage: list <folder>... | tick <file> <n> | done <file>')


if __name__ == '__main__':
    main(sys.argv[1:])
