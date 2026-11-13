import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, HoverCard } from "gpui-base";
import { exec, props, theme } from "herdr";
import { parse, busiest, card, level } from "./logic.mjs";

export default class Usage extends View {
  init(_props, cx) {
    const config = props() || {};
    this.command = Array.isArray(config.command) && config.command.length && config.command.every((s) => typeof s === "string") && config.command[0] ? config.command : null;
    this.on = typeof config.on === "string" && config.on ? config.on : null;
    this.providers = null;
    this.error = null;
    this.at = null;
    if (!this.command) return;
    this.refresh(cx);
    const seconds = typeof config.every === "number" && Number.isFinite(config.every) && config.every > 0 ? config.every : 300;
    cx.timer.every(Math.max(1000, seconds * 1000), (cx) => this.refresh(cx));
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        // Herdr exec runs this configured argv directly, without a shell.
        const result = await exec(this.command[0], this.command.slice(1), { on: this.on });
        if (result.code !== 0) throw new Error(`Command failed (exit ${result.code})`);
        this.providers = parse(result.stdout);
        this.error = null;
        this.at = Date.now();
      } catch (err) {
        this.error = String(err?.message || err);
      } finally {
        this.busy = false;
      }
      cx.notify();
    });
  }

  render() {
    const t = theme(), best = busiest(this.providers || []);
    return h_flex().id("usage").size_full().bg(t.chrome).border_t(1).border_color(t.border).items_center().text_size(11.8)
      .when(Boolean(this.command), (el) => el.px(14).child(HoverCard.new("usage-card").open_delay(250).anchor("bottom_center")
        .trigger(h_flex().h_full().gap(6).items_center()
          .child(svg("mods/usage/gauge.svg").size(13).flex_none().text_color(t.muted))
          .child(div().text_color(best?.percent >= 90 ? t.blocked : t.muted).child(best ? `${best.id} ${best.percent}%` : "usage —"))
          .when(Boolean(this.error), (el) => el.child(div().text_color(t.dim).child("!"))))
        .content(this.card(t))));
  }

  card(t) {
    const { rows, footer } = card(this.providers || []);
    // A time, not "2m ago": the view only re-renders on refresh, so a relative age would stay stale.
    const at = this.at ? new Date(this.at).toTimeString().slice(0, 5) : null;
    const notes = [...footer, this.error && `update failed: ${this.error}`].filter(Boolean);
    return v_flex().w(300).text_size(11.8).bg(t.popover ?? t.chrome).border(1).border_color(t.border).rounded(8).shadow_lg()
      .child(h_flex().px(14).py(10).gap(8).items_center().border_b(1).border_color(t.border)
        .child(svg("mods/usage/gauge.svg").size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().font_bold().text_color(t.foreground).child("AI usage"))
        .child(div().text_size(11).text_color(t.dim).child(at ? `updated ${at}` : "loading…")))
      .child(v_flex().px(14).py(10).gap(10)
        .when(!rows.length, (el) => el.child(div().text_color(t.dim).child(this.providers ? "No usage to show" : "Loading usage…")))
        .children(rows.map((p) => v_flex().gap(6)
          .child(div().font_bold().text_color(t.foreground).child(p.id))
          .children(p.windows.map((w) => v_flex().gap(3)
            .child(h_flex().justify_between().child(div().text_size(11).text_color(t.muted).child(w.label)).child(div().text_size(11).font_bold().text_color(t[level(w.percent)]).child(`${w.percent}%`)))
            .child(div().h(4).w_full().rounded(2).bg(t.border).child(div().h_full().rounded(2).bg(t[level(w.percent)]).w(Math.max(4, Math.round(272 * w.percent / 100)))))
            .when(Boolean(w.reset), (el) => el.child(div().text_size(10.5).text_color(t.dim).child(w.reset))))))))
      .when(notes.length > 0, (el) => el.child(v_flex().px(14).py(8).border_t(1).border_color(t.border)
        .children(notes.map((n) => div().text_size(11).text_color(t.dim).child(n)))));
  }
}
