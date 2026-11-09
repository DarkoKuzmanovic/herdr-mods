import { View, div } from 'gpui-kit';
import { v_flex, h_flex, InputState, Input } from 'gpui-base';
import { appHome, closeOverlay, exec, props, readTextFile, run, spaces, theme } from 'herdr';
import { age, parseRows, resumeArgv } from './logic.mjs';

export default class Sessions extends View {
  init(_props, cx) {
    this.rows = [];
    this.at = 0;
    this.query = '';
    this.seq = 0;
    this.loading = true;
    this.error = '';
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: 'Search past sessions…' });
    this.input.on('change', (_e, cx) => {
      this.query = this.input.value();
      this.at = 0;
      this.rows = [];
      const seq = ++this.seq;
      this.loading = true;
      cx.notify();
      cx.timer.after(200, (cx) => { if (seq === this.seq) this.search(cx, seq); });
    });
    this.input.on('submit', (_e, cx) => this.go(this.rows[this.at], cx));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.search(cx, ++this.seq);
  }

  search(cx, seq) {
    // One scan at a time: a query typed meanwhile runs once this one ends, not alongside it.
    if (this.running) { this.pending = true; return; }
    this.running = true;
    const on = spaces().find(s => s.active)?.machine ?? null;
    const extra = Array.isArray(props()?.machines) ? props().machines.filter(m => typeof m === 'string' && m) : [];
    const targets = [...new Set([on, ...extra])];
    const query = this.query;
    cx.spawn(async cx => {
      try {
        const script = await readTextFile(`${appHome()}/mods/sessions/search.py`);
        if (!script) throw new Error('Search helper is missing');
        const results = await Promise.all(targets.map(async machine => {
          try {
            const result = await exec('python3', ['-c', script, '--', query], { on: machine });
            if (result.code !== 0) throw new Error('Search failed');
            return { rows: parseRows(result.stdout).map(row => ({ ...row, machine })), error: false };
          } catch { return { rows: [], error: true }; }
        }));
        // A stale result is dropped but must still reach `running = false` below, or search stalls.
        if (seq === this.seq) {
          this.rows = results.flatMap(r => r.rows).sort((a, b) => b.timestamp - a.timestamp).slice(0, 50);
          this.error = results.some(r => r.error) ? 'Some machines could not be searched.' : '';
        }
      } catch { if (seq === this.seq) this.error = 'Could not load the session search helper.'; }
      this.running = false;
      if (this.pending) { this.pending = false; return this.search(cx, this.seq); }
      if (seq === this.seq) { this.loading = false; cx.notify(); }
    });
  }

  go(row, cx) {
    if (!row) return;
    const argv = resumeArgv(row.app, row.id);
    const all = spaces();
    // A local space has no machine field; rows from this computer carry null.
    const here = s => (s.machine ?? null) === row.machine;
    const space = all.find(s => s.active && here(s)) ?? all.find(here);
    if (!argv || !space) { this.error = 'Open a space on that machine first.'; cx.notify(); return; }
    closeOverlay(props().overlay);
    run('tab.new', { space: space.id, argv, ...(row.folder_exists ? { folder: row.cwd } : {}) });
  }

  render() {
    const t = theme();
    const start = Math.max(0, this.at - 7);
    return v_flex().id('sessions').track_focus(this.handle).size_full().min_h(0).p(18).gap(12).bg(t.popover).text_size(12)
      .on_key_down((e, cx) => {
        if (e.key === 'escape') return closeOverlay(props().overlay);
        if (e.key === 'down' || e.key === 'up') {
          this.at = Math.max(0, Math.min(this.rows.length - 1, this.at + (e.key === 'down' ? 1 : -1)));
          cx.stop_propagation(); cx.notify();
        }
      })
      .child(h_flex().justify_between().child(div().text_size(15).font_semibold().text_color(t.foreground).child('Past sessions')).child(div().text_color(t.dim).child('↑ ↓  Enter  Esc')))
      .child(Input.new(this.input).h(36).flex_none().px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_color(t.foreground))
      .when(Boolean(this.error), el => el.child(div().text_color(t.dim).child(this.error)))
      .when(this.loading, el => el.child(div().text_color(t.dim).child('Searching…')))
      .when(!this.loading && !this.rows.length, el => el.child(div().text_color(t.dim).child('No sessions found.')))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().gap(3).on_scroll_wheel((e, cx) => {
        this.at = Math.max(0, Math.min(this.rows.length - 1, this.at + (e.delta.y < 0 ? 1 : -1)));
        cx.notify();
      }).children(this.rows.slice(start, start + 8).map((r, offset) => {
        const i = start + offset;
        return v_flex().id(`session-${i}`).px(10).py(7).rounded(7).gap(3).cursor_pointer().when(i === this.at, el => el.bg(t.hover)).hover(s => s.bg(t.hover)).on_click((_e, cx) => this.go(r, cx))
          .child(h_flex().gap(8).child(div().text_color(t.accent).child(r.app === 'hermes' ? 'Hermes' : r.app === 'pig' ? 'PiG' : 'Pi')).child(div().flex_1().text_color(t.foreground).child(String(r.title || 'Untitled').slice(0, 90))).child(div().text_color(t.dim).child(age(r.timestamp))))
          .child(div().text_color(t.muted).child(`${String(r.cwd || 'Unknown folder').split('/').filter(Boolean).pop() || 'Unknown folder'}${r.machine ? ` · ${r.machine}` : ''}  —  ${String(r.snippet || '').slice(0, 160)}`));
      })));
  }
}
