// Vendored from yozora/js/palette-keys.test.ts. Refresh with `node scripts/vendor.mjs` there,
// never edit here.
// @vitest-environment happy-dom
//
// Declared per file rather than in the host project's vitest config, so vendoring this brings
// its own requirement with it: the only thing a project has to do is have happy-dom installed.
// happy-dom rather than jsdom, because jsdom reaches into undici and blows up on Node 20
// with "webidl.util.markAsUncloneable is not a function" - which is a CI failure about a
// keyboard test that has nothing to do with the network.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wirePalette } from "./palette-keys.js";

/**
 * The keyboard behaviour, without a browser.
 *
 * jsdom is enough for every claim here: which element is focused, which carries the tab stop,
 * and what `select` is called with. What it cannot check is that the page repaints, and that
 * is checked in a real browser by the vendored e2e spec.
 */

const ids = ["a", "b", "c"];

function build() {
  document.body.innerHTML = `<div id="g">${ids
    .map((id) => `<button data-theme="${id}" aria-pressed="false">${id}</button>`)
    .join("")}</div>`;
  const group = document.getElementById("g")!;
  const options = [...group.querySelectorAll<HTMLElement>("button[data-theme]")];
  let chosen = "a";
  const select = vi.fn((id: string) => {
    chosen = id;
  });
  const onEscape = vi.fn();
  const picker = wirePalette(group, options, { select, current: () => chosen, onEscape });
  return { group, options, select, onEscape, picker, chosen: () => chosen };
}

const key = (el: Element, k: string) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

describe("wirePalette", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("gives the group one tab stop, on the chosen option", () => {
    const { options } = build();
    expect(options.map((o) => o.tabIndex)).toEqual([0, -1, -1]);
    expect(options.map((o) => o.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
  });

  it("drops aria-pressed, which says something different from aria-checked", () => {
    const { options } = build();
    expect(options.some((o) => o.hasAttribute("aria-pressed"))).toBe(false);
  });

  it("moves the tab stop with the selection", () => {
    const { options } = build();
    options[0]!.focus();
    key(options[0]!, "ArrowRight");
    expect(options.map((o) => o.tabIndex)).toEqual([-1, 0, -1]);
    expect(document.activeElement).toBe(options[1]);
  });

  it("applies each palette as focus passes it, which is the preview", () => {
    const { options, select } = build();
    options[0]!.focus();
    key(options[0]!, "ArrowRight");
    key(options[1]!, "ArrowRight");
    expect(select.mock.calls.map((c) => c[0])).toEqual(["b", "c"]);
  });

  it("wraps at both ends rather than stopping", () => {
    const { options, select } = build();
    options[0]!.focus();
    key(options[0]!, "ArrowLeft");
    expect(select).toHaveBeenLastCalledWith("c");
    key(options[2]!, "ArrowRight");
    expect(select).toHaveBeenLastCalledWith("a");
  });

  it("jumps to either end", () => {
    const { options, select } = build();
    options[0]!.focus();
    key(options[0]!, "End");
    expect(select).toHaveBeenLastCalledWith("c");
    key(options[2]!, "Home");
    expect(select).toHaveBeenLastCalledWith("a");
  });

  it("puts back the palette that was on when the group was reached, not the one it loaded with", () => {
    const { group, options, select, onEscape } = build();
    // Reach the group, choose something, leave, come back, then try things and give up.
    options[0]!.dispatchEvent(new FocusEvent("focusin", { bubbles: true, relatedTarget: null }));
    options[0]!.focus();
    key(options[0]!, "ArrowRight"); // now on "b"
    group.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    options[1]!.dispatchEvent(new FocusEvent("focusin", { bubbles: true, relatedTarget: null }));
    key(options[1]!, "ArrowRight"); // trying "c"
    key(options[2]!, "Escape");

    expect(select).toHaveBeenLastCalledWith("b");
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("ignores a key pressed on something that is not an option", () => {
    const { group, select } = build();
    key(group, "ArrowRight");
    expect(select).not.toHaveBeenCalled();
  });

  it("still selects on a plain click", () => {
    const { options, select } = build();
    options[2]!.click();
    expect(select).toHaveBeenLastCalledWith("c");
    expect(options.map((o) => o.tabIndex)).toEqual([-1, -1, 0]);
  });
});
