import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, props, theme } from "herdr";
import { parse, busiest, tooltip } from "./logic.mjs";

export default class Usage extends View {
  init(_props, cx) {
    const config = props() || {};
    this.command = Array.isArray(config.command) && config.command.length && config.command.every((s) => typeof s === "string") && config.command[0] ? config.command : null;
    this.on = typeof config.on === "string" && config.on ? config.on : null;
    this.providers = null;
    this.error = null;
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
    const tip = [this.providers && tooltip(this.providers), this.error && `Update failed: ${this.error}`].filter(Boolean).join("\n");
    return h_flex().id("usage").size_full().bg(t.chrome).border_t(1).border_color(t.border).items_center().text_size(11.8)
      .when(Boolean(this.command), (el) => el.px(14).gap(6).tooltip(tip || "Loading usage…")
        .child(svg("mods/usage/gauge.svg").size(13).flex_none().text_color(t.muted))
        .child(div().text_color(best?.percent >= 90 ? t.blocked : t.muted).child(best ? `${best.id} ${best.percent}%` : "usage —"))
        .when(Boolean(this.error), (el) => el.child(div().text_color(t.dim).child("!"))));
  }
}
