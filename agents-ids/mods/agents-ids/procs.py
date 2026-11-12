#!/usr/bin/env python3
"""Work running in terminals, for "Save & close sessions": `procs.py PID ...` (each a terminal's shell
pid) prints {pid: {"fg": "pi", "runs": ["make ci-wait PR=1118"]}}: the foreground program
(null: the shell itself) and the work under it, `runs` empty when nothing but the agent and its helpers run.
A pid missing from the output couldn't be checked. Read-only: reads /proc, never signals anything.

Work is any process in the terminal except its shell, the foreground agent, and the agent's helpers:
whatever it started within its first minute (TUI runtime, MCP servers) and their children, and
language servers. A process counts as the terminal's when it descends from the shell, or carries the
terminal's HC_TERMINAL_ID/HC_TERMINAL_SOCKET (an agent's tool jobs may run under a separate daemon);
such a process detached to init/systemd (a browser opened from the agent) survives the tab, so it's
not work lost by closing it."""
import json
import os
import re
import sys

HELPER_SECS = 60
IGNORE = re.compile(r'language-server|languageserver|\blsp\b|-lsp|tsserver|typingsInstaller|gopls|rust-analyzer|pyright|clangd', re.I)
SHELLS = {'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh'}

def read(path, binary=False):
    try:
        with open(path, 'rb' if binary else 'r') as f:
            return f.read()
    except OSError:
        return None

def table():
    procs = {}
    for name in os.listdir('/proc'):
        if not name.isdigit():
            continue
        stat = read(f'/proc/{name}/stat')
        if not stat:
            continue
        fields = stat.rsplit(')', 1)[1].split()
        comm = stat[stat.find('(') + 1:stat.rfind(')')]
        env = read(f'/proc/{name}/environ', True) or b''
        key = tuple(next((e.split(b'=', 1)[1] for e in env.split(b'\0') if e.startswith(k + b'=')), b'') for k in (b'HC_TERMINAL_ID', b'HC_TERMINAL_SOCKET'))
        argv = [a.decode('utf-8', 'replace') for a in (read(f'/proc/{name}/cmdline', True) or b'').split(b'\0') if a]
        procs[int(name)] = {'state': fields[0], 'ppid': int(fields[1]), 'pgrp': int(fields[2]), 'tpgid': int(fields[5]),
                            'start': int(fields[19]), 'comm': comm, 'argv': argv or [comm], 'key': key if key[0] else None}
    return procs

def short(argv):
    # An inline script (python3 -c '<many lines>') says nothing; its arguments do.
    words = [os.path.basename(argv[0])] + ['…' if '\n' in a else a for a in argv[1:]]
    text = ' '.join(' '.join(words).split())
    return text if len(text) <= 60 else text[:59] + '…'

def work(procs, shell, hz):
    s = procs[shell]
    kids = {}
    for pid, p in procs.items():
        kids.setdefault(p['ppid'], []).append(pid)

    def tree(root):
        out, todo = [], [root]
        while todo:
            pid = todo.pop()
            out.append(pid)
            todo.extend(kids.get(pid, []))
        return out

    mine = set(tree(shell))
    if s['key']:
        for pid, p in procs.items():
            if pid in mine or p['key'] != s['key']:
                continue
            root = pid
            while procs.get(procs[root]['ppid'], {}).get('key') == s['key']:
                root = procs[root]['ppid']
            parent = procs.get(procs[root]['ppid'])
            if parent and procs[root]['ppid'] != 1 and parent['comm'] not in ('systemd', 'init'):
                mine.update(tree(root))
    skip = {shell, os.getpid(), os.getppid()}
    agent = next((pid for pid, p in procs.items() if p['pgrp'] == s['tpgid'] and pid == p['pgrp']), None)
    if agent and agent != shell:
        skip.add(agent)
        for pid in mine:
            p = procs[pid]
            if pid not in (shell, agent) and p['start'] <= procs[agent]['start'] + HELPER_SECS * hz:
                skip.update(tree(pid))
    for pid in mine:
        if IGNORE.search(' '.join(procs[pid]['argv'][:2])):
            skip.update(tree(pid))
    busy = sorted((pid for pid in mine if pid not in skip and procs[pid]['state'] != 'Z'), key=lambda pid: procs[pid]['start'])
    busy_set = set(busy)
    out = []
    for pid in busy:
        if procs[pid]['ppid'] in busy_set:
            continue  # shown through its topmost busy ancestor
        # A shell wrapper says little: name the first real program under it.
        named = next((q for q in tree(pid) if q in busy_set and procs[q]['comm'] not in SHELLS and q != pid), None)
        best = pid if procs[pid]['comm'] not in SHELLS or named is None else named
        out.append(short(procs[best]['argv']))
    fg = short(procs[agent]['argv']) if agent and agent != shell else None
    return {'fg': fg, 'runs': out}

def main(args):
    procs = table()
    hz = os.sysconf('SC_CLK_TCK')
    out = {}
    for arg in args:
        if arg.isdigit() and int(arg) in procs:
            out[arg] = work(procs, int(arg), hz)
    print(json.dumps(out))

if __name__ == '__main__':
    main(sys.argv[1:])
