import { View, div } from 'gpui-kit';
import { v_flex, h_flex } from 'gpui-base';
import { closeOverlay, exec, focused, props, run, theme } from 'herdr';
import { mdPaths, splitAddress } from './logic.mjs';

// Prints the machine's home, then the paths that are files there, made absolute: relative ones against
// the terminal's folder, ~/ against home. Paths travel as arguments, never as script.
const RESOLVE = 'printf "%s\\n" "$HOME"; cd -- "$1" 2>/dev/null || cd; shift; for f; do case $f in "~/"*) f=$HOME/${f#"~/"};; /*) ;; *) f=$PWD/$f;; esac; [ -f "$f" ] && printf "%s\\n" "$f"; done; :';

export default class MdOpen extends View {
  init(_props, cx) {
    this.rows = [];
    this.at = 0;
    this.note = 'Looking…';
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(300, () => this.handle.focus());
    const f = focused();
    this.pane = f?.pane ?? null;
    const terminal = f?.shown ?? f?.terminal;
    if (!terminal) { this.note = 'Focus a terminal first.'; return; }
    const { machine, address } = splitAddress(terminal);
    cx.spawn(async cx => {
      try {
        const screen = await exec('hc', ['read', '--lines', '2000', address], { on: machine });
        const found = mdPaths(screen.stdout);
        const real = found.length ? await exec('sh', ['-c', RESOLVE, 'sh', f.cwd ?? '', ...found], { on: machine }) : { stdout: '\n' };
        const [home, ...files] = real.stdout.split('\n');
        this.home = home;
        this.rows = [...new Set(files.filter(Boolean))];
        this.note = this.rows.length ? '' : 'No markdown files in this terminal.';
      } catch { this.note = 'Could not read this terminal.'; }
      cx.notify();
    });
  }

  open(path) {
    if (!path) return;
    closeOverlay(props().overlay);
    const argv = ['fresh', path];
    // A layout terminal block has no pane to split; a tab is the next best place.
    if (this.pane) run('pane.split', { direction: 'right', pane: this.pane, argv });
    else run('tab.new', { argv });
  }

  render() {
    const t = theme();
    const start = Math.max(0, this.at - 9);
    return v_flex().id('md-open').track_focus(this.handle).size_full().min_h(0).p(18).gap(12).bg(t.popover).text_size(12)
      .on_key_down((e, cx) => {
        if (e.key === 'escape') return closeOverlay(props().overlay);
        if (e.key === 'enter') return this.open(this.rows[this.at]);
        if (e.key === 'down' || e.key === 'up') {
          this.at = Math.max(0, Math.min(this.rows.length - 1, this.at + (e.key === 'down' ? 1 : -1)));
          cx.stop_propagation(); cx.notify();
        }
      })
      .child(h_flex().justify_between().child(div().text_size(15).font_semibold().text_color(t.foreground).child('Open markdown')).child(div().text_color(t.dim).child('↑ ↓  Enter  Esc')))
      .when(Boolean(this.note), el => el.child(div().text_color(t.dim).child(this.note)))
      .child(v_flex().flex_1().min_h(0).gap(3).children(this.rows.slice(start, start + 10).map((path, offset) => {
        const i = start + offset;
        return v_flex().id(`md-${i}`).px(10).py(6).rounded(7).gap(2).cursor_pointer().when(i === this.at, el => el.bg(t.hover)).hover(s => s.bg(t.hover)).on_click(() => this.open(path))
          .child(div().text_color(t.foreground).child(path.split('/').pop()))
          .child(div().text_color(t.muted).child((this.home && path.startsWith(`${this.home}/`) ? `~${path.slice(this.home.length)}` : path).slice(0, 120)));
      })));
  }
}
