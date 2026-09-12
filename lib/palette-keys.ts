// Vendored from yozora/js/palette-keys.ts. Refresh with `node scripts/vendor.mjs` there,
// never edit here.
/**
 * Arrow keys, one tab stop, and Escape, for a palette picker built without a framework.
 *
 * The React component in palette.tsx has this behaviour built in. Two pages here are plain
 * TypeScript and cannot use it, and the behaviour is the part worth sharing: which colours a
 * page paints its swatches in is its own business, but "fifteen tab stops to get past a
 * preference" and "trying one is a one-way door" are wrong everywhere.
 *
 * The markup stays the caller's. This only reads the options out of a container and wires the
 * keys, so a page can lay them out however it likes.
 *
 *   const options = [...list.querySelectorAll<HTMLButtonElement>("button[data-theme]")];
 *   const picker = wirePalette(list, options, { select, current: () => chosen });
 */

export interface PaletteKeysOptions {
  /** Apply a palette. Called as focus moves, so this is the preview as well as the choice. */
  select: (id: string) => void;
  /** The palette in effect right now, for deciding which option is the single tab stop. */
  current: () => string;
  /** Called after Escape has put the previous palette back. For a disclosure to close on. */
  onEscape?: () => void;
}

const ID = (el: HTMLElement) => el.dataset.theme ?? "";

export function wirePalette(
  group: HTMLElement,
  options: HTMLElement[],
  { select, current, onEscape }: PaletteKeysOptions,
): { refresh: () => void } {
  group.setAttribute("role", "radiogroup");
  if (!group.getAttribute("aria-label")) group.setAttribute("aria-label", "Palette");

  /** What to put back if this is abandoned rather than decided. */
  let committed = current();

  /**
   * One tab stop for the whole group, on whichever option is chosen.
   *
   * Fifteen tab stops to get past a preference is fifteen too many, and it is the standard
   * radio-group behaviour, so nothing about it has to be explained.
   */
  const refresh = () => {
    const chosen = current();
    for (const option of options) {
      const mine = ID(option) === chosen;
      option.setAttribute("role", "radio");
      option.setAttribute("aria-checked", String(mine));
      option.tabIndex = mine ? 0 : -1;
      // aria-pressed and aria-checked on one element say two different things about it.
      option.removeAttribute("aria-pressed");
    }
  };

  const focusAt = (index: number) => {
    const option = options[(index + options.length) % options.length];
    if (!option) return;
    // Selection follows focus, which is what makes arrowing a preview rather than a survey.
    select(ID(option));
    refresh();
    option.focus();
  };

  group.addEventListener("keydown", (e) => {
    const at = options.indexOf(e.target as HTMLElement);
    if (at < 0) return;
    const moves: Record<string, number> = {
      ArrowRight: at + 1, ArrowDown: at + 1,
      ArrowLeft: at - 1, ArrowUp: at - 1,
      Home: 0, End: options.length - 1,
    };
    if (e.key in moves) {
      e.preventDefault();
      focusAt(moves[e.key]!);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      // Back to what was on the page when this group was reached. Without it, sweeping through
      // fifteen palettes to look at them leaves you on whichever one you stopped at.
      select(committed);
      refresh();
      onEscape?.();
    }
  });

  // What Escape puts back is whatever was on the page when the group was REACHED, not when the
  // page loaded: with a mouse, a list can be open long before anything is tried.
  group.addEventListener("focusin", (e) => {
    if (!group.contains(e.relatedTarget as Node | null)) committed = current();
  });

  for (const option of options) {
    option.addEventListener("click", () => {
      select(ID(option));
      refresh();
    });
  }

  refresh();
  return { refresh };
}
