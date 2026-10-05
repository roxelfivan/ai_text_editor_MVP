import { diffLines } from 'diff';

export interface DiffLine {
  kind: 'add' | 'remove' | 'context';
  text: string;
}

/**
 * Produce a simple line-based diff. Returns a flat list suitable for
 * rendering. Removed lines come before added lines at each change site,
 * so the UI can keep a stable line order.
 */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const parts = diffLines(oldText, newText, { newlineIsToken: false });
  const out: DiffLine[] = [];
  for (const part of parts) {
    const lines = part.value.split('\n');
    // diffLines usually ends with a trailing \n producing an empty last entry.
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    for (const text of lines) {
      if (part.added) out.push({ kind: 'add', text });
      else if (part.removed) out.push({ kind: 'remove', text });
      else out.push({ kind: 'context', text });
    }
  }
  return out;
}

export interface SplitRow {
  /** Original-side line. `null` means a placeholder row (an addition with
   *  no matching removal on the left). */
  left: DiffLine | null;
  /** Proposed-side line. `null` means a placeholder row (a removal with
   *  no matching addition on the right). */
  right: DiffLine | null;
}

/**
 * Convert a flat line-based diff into a list of side-by-side rows.
 *
 * Adjacent remove + add parts at the same change site are paired up by
 * index, so a removed line on the left lines up with an added line on the
 * right. When one side has fewer lines than its counterpart, the shorter
 * side gets `null` placeholders so the rows stay vertically aligned.
 * Context lines appear on both sides with the same text.
 */
export function splitDiff(flat: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < flat.length) {
    const cur = flat[i];
    if (cur.kind === 'context') {
      rows.push({ left: cur, right: cur });
      i++;
      continue;
    }
    // Collect a run of removes immediately followed by a run of adds.
    const removes: DiffLine[] = [];
    while (i < flat.length && flat[i].kind === 'remove') {
      removes.push(flat[i]);
      i++;
    }
    const adds: DiffLine[] = [];
    while (i < flat.length && flat[i].kind === 'add') {
      adds.push(flat[i]);
      i++;
    }
    const max = Math.max(removes.length, adds.length);
    for (let j = 0; j < max; j++) {
      rows.push({
        left: removes[j] ?? null,
        right: adds[j] ?? null,
      });
    }
  }
  return rows;
}
