# Terminal labels

The mods read plain herdr-app terminal labels. Anything running in a terminal can set them, and every
feature that needs one shows nothing when it is missing, so no agent integration is required:

```sh
hc label "$HC_TERMINAL_ID" agent.session=<id> agent.app=claude
hc label t7 agent.next=        # an empty value removes a label
```

`integrations/` sets them for the agents listed in the README. Values are untrusted text: the mods show
them on one line, cut to length, and run nothing from them except Resume's checked session ID.

| Label | Meaning | Set by | Read by |
|---|---|---|---|
| `agent.session` | The agent's session ID | every integration | agents-ids (second line, Resume, Save & close) |
| `agent.app` | Which program it is: `claude`, `codex`, `pi`, `pig`, `opencode`, `hermes` | every integration | agents-ids (Resume command; Send to several) |
| `agent.doing` | What it is doing now, a short plain line: `thinking`, `running: terminal git`, `waiting for you`, `done`. Never command arguments or paths. | Hermes, Pi, PiG | agents-ids (third line, stall alert) |
| `agent.doing.since` | Epoch seconds of the last `agent.doing` change | Hermes, Pi, PiG | agents-ids (age, 30-minute stall) |
| `agent.next` | After a turn: the reply's `Next:` line, what happens next. Cleared when the next turn starts. | Hermes | agents-ids (third line of a finished agent) |
| `agent.needs` | `you` when that Next line asks the person for something, else `no` | Hermes | agents-ids (the agent sorts with Needs you and shows *Your turn*) |
| `agent.waiting` | Background jobs that will wake the agent when they finish: `gh`, `make`, `2 jobs`. Cleared when the next turn starts. | Hermes | agents-ids (*Waiting* section, `waiting: gh · 4m`) |
| `agent.lead` | The terminal (`t7`) of the agent that started this one and directs it: a herd lead | whatever starts the worker | agents-ids (herd view) |
| `agent.brief` | Path of the brief the worker carries out | whatever starts the worker | agents-ids (brief name on the row; click opens it) |

Notes:

- `agent.next` follows a convention, not a standard: a reply line starting with `Next:` (bold or not). An
  agent whose replies have no such line simply shows no Next line. `agent.needs` is a guess from the
  wording: `you`, `your` or `me` in the line means yes, unless it says nothing needs you.
- `agent.lead` names a terminal on the same machine. A herd only nests on this computer; a remote worker's
  row shows normally.
- herdr-app's own labels (`herdr.*`) belong to herdr-app.
