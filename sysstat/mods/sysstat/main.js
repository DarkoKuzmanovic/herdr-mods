// CPU (with a one-minute sparkline), memory and, on amdgpu, GPU load and VRAM of the machine the
// shown space lives on, read from its /proc and /sys every 2 s (a remote space's through herdr-core).
// Click: btop (else htop, else top) in a new tab of the shown space.
import { View, div } from "gpui-kit";
import { h_flex, v_flex, HoverCard } from "gpui-base";
import { exec, readTextFile, run, spaces, theme } from "herdr";
import { SAMPLES, cpuPercent, cpuTimes, gib, gpu, memory, push, spread } from "./logic.mjs";

const read = (path, on) => readTextFile(path, { on }).catch(() => null);

// The amdgpu card's sysfs folder on that machine, or null (other GPUs: not shown).
async function findGpu(on) {
  for (let n = 0; n < 4; n++) {
    const dir = `/sys/class/drm/card${n}/device`;
    if ((await read(`${dir}/gpu_busy_percent`, on)) !== null) return dir;
  }
  return null;
}

export default class Sysstat extends View {
  init(_props, cx) {
    this.machine = undefined;
    this.refresh(cx);
    cx.timer.every(2000, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    const on = spaces().find((s) => s.active)?.machine ?? null;
    if (on !== this.machine) {
      Object.assign(this, { machine: on, previous: null, cpu: null, hist: [], mem: null, gpu: null, gpuDir: undefined, error: false });
      cx.notify();
    }
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const [stat, mem] = await Promise.all([read("/proc/stat", on), read("/proc/meminfo", on)]);
        if (on !== this.machine) return; // the shown space moved to another machine while reading
        const now = cpuTimes(stat);
        this.mem = memory(mem);
        this.error = !now || !this.mem;
        this.cpu = cpuPercent(this.previous, now);
        this.previous = now;
        if (this.cpu !== null) this.hist = push(this.hist, this.cpu);
        if (this.gpuDir === undefined) this.gpuDir = await findGpu(on);
        if (this.gpuDir) {
          const d = this.gpuDir;
          const [b, u, t] = await Promise.all([read(`${d}/gpu_busy_percent`, on), read(`${d}/mem_info_vram_used`, on), read(`${d}/mem_info_vram_total`, on)]);
          this.gpu = gpu(b, u, t);
        }
      } finally {
        this.busy = false;
      }
      cx.notify();
    });
  }

  openMonitor() {
    const space = spaces().find((s) => s.active);
    // herdr's exec takes an argument list (no shell from us); the sh -c script is a constant.
    exec("sh", ["-c", "command -v btop || command -v htop || echo top"], { on: this.machine })
      .then((r) => run("tab.new", { space: space?.id, name: "monitor", argv: [r.stdout.trim().split("\n")[0] || "top"] }))
      .catch(() => {});
  }

  render() {
    const t = theme();
    const label = (s) => div().flex_none().text_color(t.dim).child(s);
    // Red at 90% or more, like the sparkline bars.
    const value = (s, pct = 0) => div().flex_none().text_color(pct >= 90 ? t.blocked : t.muted).child(s);
    const spark = h_flex().flex_none().w(SAMPLES * 3).h(14).gap(1).items_end()
      .children(this.hist.map((v, i) => div().id(`s${i}`).w(2).h(Math.max(1, Math.round((v * 14) / 100))).bg(v >= 90 ? t.blocked : t.accent)));
    const g = this.gpu;
    const m = this.mem;
    return h_flex().id("sysstat").size_full().px(14).items_center().bg(t.chrome).border_t(1).border_color(t.border)
      .text_size(11.8).hover((s) => s.bg(t.hover))
      .on_click(() => this.openMonitor())
      .child(HoverCard.new("sysstat-card").open_delay(250).anchor("bottom_center").content(this.card(t)).trigger(h_flex().h_full().gap(6).items_center()
      .when(Boolean(this.machine), (el) => el.child(div().flex_shrink(1).min_w(0).truncate().text_color(t.accent).child(this.machine)))
      .when(this.error, (el) => el.child(value("CPU / MEM unavailable")))
      .when(!this.error, (el) => el
        .child(label("CPU")).child(value(this.cpu === null ? "—" : `${this.cpu}%`, this.cpu ?? 0)).child(spark)
        .child(label("MEM")).child(value(m ? `${gib(m.used)}/${gib(m.total)}G` : "—", m ? (100 * m.used) / m.total : 0))
        .when(Boolean(g), (el) => el.child(label("GPU")).child(value(`${g.busy}%${g.used !== null && g.total ? ` ${gib(g.used)}/${gib(g.total)}G` : ""}`, Math.max(g.busy, g.used !== null && g.total ? (100 * g.used) / g.total : 0)))))));
  }

  // The hover card, styled as the usage mod's: a bigger CPU graph, then a bar per memory and GPU figure.
  card(t) {
    const tone = (pct) => (pct >= 90 ? t.blocked : t.accent);
    const s = spread(this.hist), m = this.mem, g = this.gpu;
    const bar = (label, pct, text) => v_flex().gap(3)
      .child(h_flex().justify_between().child(div().text_size(11).text_color(t.muted).child(label)).child(div().text_size(11).font_bold().text_color(pct >= 90 ? t.blocked : t.foreground).child(text)))
      .child(div().h(4).w_full().rounded(2).bg(t.border).child(div().h_full().rounded(2).bg(tone(pct)).w(Math.max(4, Math.round(272 * Math.min(pct, 100) / 100)))));
    const bars = [];
    if (m) bars.push(bar("Memory", (100 * m.used) / m.total, `${gib(m.used)} / ${gib(m.total)} G`));
    if (g) bars.push(bar("GPU", g.busy, `${g.busy}%`));
    if (g && g.used !== null && g.total) bars.push(bar("VRAM", (100 * g.used) / g.total, `${gib(g.used)} / ${gib(g.total)} G`));
    return v_flex().w(300).text_size(11.8).bg(t.popover ?? t.chrome).border(1).border_color(t.border).rounded(8).shadow_lg()
      .child(h_flex().px(14).py(10).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().font_bold().text_color(t.foreground).child(this.machine ?? "This computer"))
        .child(div().text_size(11).text_color(t.dim).child("every 2 s")))
      .child(v_flex().px(14).py(10).gap(10)
        .when(this.error, (el) => el.child(div().text_color(t.dim).child("CPU and memory unavailable")))
        .when(!this.error, (el) => el
          .child(v_flex().gap(4)
            .child(h_flex().justify_between().child(div().text_size(11).text_color(t.muted).child("CPU, last minute")).child(div().text_size(11).font_bold().text_color(tone(this.cpu ?? 0)).child(this.cpu === null ? "—" : `${this.cpu}%`)))
            .child(h_flex().w_full().h(40).gap(1).items_end().bg(t.canvas ?? t.chrome).rounded(3)
              .children(this.hist.map((v, i) => div().id(`c${i}`).w(8).h(Math.max(1, Math.round((v * 40) / 100))).rounded_t(1).bg(tone(v)))))
            .when(Boolean(s), (el) => el.child(div().text_size(10.5).text_color(t.dim).child(`average ${s?.avg}% · peak ${s?.peak}%`))))
          .children(bars)))
      .child(div().px(14).py(8).border_t(1).border_color(t.border).text_size(11).text_color(t.dim).child("click: open btop in a new tab"));
  }
}
