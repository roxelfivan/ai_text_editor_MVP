// Standalone harness for PR #9's heading-section parser. Runs the
// REAL source in `src/hooks/useDocumentMentions.ts` (pure helpers
// only — the React hook is never invoked) so editing the source is
// the only thing you need to do to re-test.
//
// Usage:
//   node scripts/test-heading-sections.mjs
// or
//   npm run test:heading-sections

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'src/hooks/useDocumentMentions.ts');
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'hd-test-'));

// Stub files for modules the source imports but the test never
// exercises. These are written first so the bundler can resolve them.
const REACT_STUB = path.join(TMP_DIR, 'react-stub.js');
const STORE_STUB = path.join(TMP_DIR, 'store-stub.js');
const TYPES_STUB = path.join(TMP_DIR, 'types-stub.js');

await fs.writeFile(REACT_STUB, `export default {}; export const useState=()=>{},useMemo=(f)=>f(),useEffect=()=>{};`);
await fs.writeFile(STORE_STUB, `export const useStore = () => ({ documents: [], currentDocumentId: null });`);
// Provide a minimal DocumentRecord shape so the type-only import is
// resolved. (The source file imports types as `import type {...}`,
// which esbuild elides — but having a stub here is cheap insurance.)
await fs.writeFile(TYPES_STUB, `export {};`);

const TMP_SRC = path.join(TMP_DIR, 'entry.ts');
const PARSE_MENTIONS = path.join(ROOT, 'src/components/mentions/parseMentions.ts');
const ENTRY = `
import {
  buildParagraphs,
  buildHeadingSections,
  sectionsMatchingSelection,
  descendantSectionIndexes,
} from '${SOURCE}';
import {
  plainTextDiff,
  parseRawWithMentions,
  serializeRawWithMentions,
} from '${PARSE_MENTIONS}';
export {
  buildParagraphs,
  buildHeadingSections,
  sectionsMatchingSelection,
  descendantSectionIndexes,
  plainTextDiff,
  parseRawWithMentions,
  serializeRawWithMentions,
};
`;
await fs.writeFile(TMP_SRC, ENTRY);

await build({
  entryPoints: [TMP_SRC],
  outfile: path.join(TMP_DIR, 'bundle.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  alias: {
    '@': path.join(ROOT, 'src'),
  },
  plugins: [
    {
      name: 'stub-react',
      setup(b) {
        b.onResolve({ filter: /^react$/ }, () => ({ path: REACT_STUB }));
      },
    },
    {
      name: 'stub-store',
      setup(b) {
        b.onResolve({ filter: /useStore/ }, () => ({ path: STORE_STUB }));
      },
    },
  ],
  loader: { '.ts': 'ts', '.tsx': 'tsx', '.js': 'js' },
  logLevel: 'silent',
});

const mod = await import(pathToFileURL(path.join(TMP_DIR, 'bundle.mjs')).href);
const {
  buildHeadingSections,
  sectionsMatchingSelection,
  buildParagraphs,
  descendantSectionIndexes,
  plainTextDiff,
  parseRawWithMentions,
  serializeRawWithMentions,
} = mod;

// Tiny test framework ----------------------------------------------------

let totalFailures = 0;
let totalChecks = 0;
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function fmt(v) { return JSON.stringify(v); }

function eq(label, actual, expected) {
  totalChecks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) totalFailures++;
  const colour = ok ? GREEN : RED;
  console.log(
    `  ${colour}${ok ? 'PASS' : 'FAIL'}${RESET}  ${label}\n` +
      `        expected: ${fmt(expected)}\n` +
      `        actual:   ${fmt(actual)}`
  );
}

function group(label, fn) {
  console.log(`\n${DIM}── ${label} ──${RESET}`);
  fn();
}

function sectionsOf(label, content) {
  const sections = buildHeadingSections({ content });
  console.log(
    `    sections: ${sections
        .map((s) => `[L${s.level} ${JSON.stringify(s.title)} paras=${JSON.stringify(s.paragraphIndexes)}]`)
        .join(', ')}`
  );
  return sections;
}

// Test cases -------------------------------------------------------------

group('Bug 1: indented # is NOT a heading', () => {
  const content = `  # indented-looking but not a heading
Real body.

# Real heading
body
`;
  const sections = sectionsOf('indented #', content);
  // The indented line is demoted to plain prose (folded into a
  // level-0 block). The only heading-level section should be the
  // second, legitimate "# Real heading".
  eq('only one heading section', sections.filter((s) => s.level >= 1).length, 1);
  eq('that heading is "Real heading"', sections.find((s) => s.level >= 1)?.title, 'Real heading');
});

group('Bug 1: 4-space-indented # (code-block territory) is NOT a heading', () => {
  const content = `    # inside a code block
still code

# Real heading
body
`;
  const sections = sectionsOf('4-space indented #', content);
  eq('only one heading section', sections.filter((s) => s.level >= 1).length, 1);
  eq('that heading is "Real heading"', sections.find((s) => s.level >= 1)?.title, 'Real heading');
});

group('Bug 1: tab-indented # is NOT a heading', () => {
  const content = `\t# tab-indented not a heading
body

# Real heading
body
`;
  const sections = sectionsOf('tab indented #', content);
  eq('only one heading section', sections.filter((s) => s.level >= 1).length, 1);
});

group('ATX headings still work', () => {
  const content = `# Title
body A

## Sub one
body B
`;
  const sections = sectionsOf('basic ATX', content);
  eq('first section L1', sections[0].level, 1);
  eq('first section title', sections[0].title, 'Title');
  eq('second section L2', sections[1].level, 2);
  eq('second section title', sections[1].title, 'Sub one');
});

group('ATX with trailing closing hashes', () => {
  const content = `## Title ##
body
`;
  const sections = sectionsOf('ATX trailing hashes', content);
  eq('single L2 section', sections.length, 1);
  eq('title stripped of trailing #', sections[0].title, 'Title');
});

group('7-hash (over max) is not a heading', () => {
  const content = `####### Too deep
body
`;
  const sections = sectionsOf('7-hash', content);
  eq('no heading detected', sections.every((s) => s.level === 0), true);
});

group('Setext H1 still works', () => {
  const content = `Setext Title
=============

Body line one.
Body line two.
`;
  const sections = sectionsOf('setext H1', content);
  eq('one L1 section', sections.length, 1);
  eq('setext title', sections[0].title, 'Setext Title');
  eq('underline paragraph included', sections[0].paragraphIndexes.includes(1), true);
});

group('Bug 2: setext underline immediately after ATX heading does NOT steal the body', () => {
  const content = `# Title
Sub-line
===

More body.
`;
  const sections = sectionsOf('ATX + setext', content);
  eq('first section is the ATX Title', sections[0].level, 1);
  eq('first section title is Title', sections[0].title, 'Title');
  eq('Sub-line paragraph is in section 0', sections[0].paragraphIndexes.includes(1), true);
  eq(
    'no phantom second L1 heading',
    sections.filter((s) => s.level === 1).length,
    1
  );
});

group('Setext underline preceded by a blank line still falls back safely', () => {
  const content = `# Top

prev

prev
===

body
`;
  const sections = sectionsOf('ATX + blank + setext', content);
  // Line 4 ("prev") is immediately preceded by line 2 ("prev"),
  // which is plain prose (not an ATX heading). The setext rule
  // promotes line 4 → setext H1 with title "prev". So we expect
  // TWO L1 sections: ATX "Top" + setext "prev".
  eq('two L1 sections (ATX Top + setext prev)', sections.filter((s) => s.level === 1).length, 2);
});

group('Setext underline preceded by prose still works', () => {
  const content = `Real prose
============

body
`;
  const sections = sectionsOf('prose + setext', content);
  eq('setext H1 promoted', sections.length, 1);
  eq('setext title', sections[0].title, 'Real prose');
  eq('setext level', sections[0].level, 1);
});

group('Preamble + heading', () => {
  const content = `Leading paragraph.
Another preamble line.

# Heading One

Body.
`;
  const sections = sectionsOf('preamble + heading', content);
  eq('preamble section present', sections[0].level, 0);
  eq('heading section second', sections[1].level, 1);
  eq('heading title', sections[1].title, 'Heading One');
});

group('Empty preamble is skipped', () => {
  const content = `

# Heading
body
`;
  const sections = sectionsOf('empty preamble', content);
  eq('only one section', sections.length, 1);
  eq('that section is the heading', sections[0].level, 1);
});

group('No headings → blank-line fallback', () => {
  const content = `Soft-wrapped paragraph one
continues on next line.

Another block here
spans multiple lines.
`;
  const sections = sectionsOf('no headings', content);
  eq('two fallback blocks', sections.length, 2);
  eq('both level 0', sections.every((s) => s.level === 0), true);
});

group('Empty doc → empty sections', () => {
  const sections = sectionsOf('empty doc', '');
  eq('no sections', sections.length, 0);
});

group('Whitespace-only doc → single (empty) section', () => {
  const sections = sectionsOf('whitespace only', '   \n   \n   ');
  eq('one (empty) section', sections.length, 1);
  eq('title is (empty)', sections[0].title, '(empty)');
});

group('sectionsMatchingSelection restores fully-covered sections', () => {
  const sections = [
    { index: 0, level: 1, title: 'A', paragraphIndexes: [0, 1, 2] },
    { index: 1, level: 1, title: 'B', paragraphIndexes: [3, 4] },
  ];
  eq('full cover A+B', sectionsMatchingSelection(sections, [0, 1, 2, 3, 4]), [0, 1]);
  eq('full cover A only', sectionsMatchingSelection(sections, [0, 1, 2]), [0]);
  eq('partial cover (A fully + B partially)', sectionsMatchingSelection(sections, [0, 1, 2, 3]), [0]);
  eq('no overlap', sectionsMatchingSelection(sections, [10, 11]), []);
  eq('empty selection', sectionsMatchingSelection(sections, []), []);
});

group('buildParagraphs still produces stable offsets', () => {
  const doc = { content: 'a\nb\nc\n' };
  const paras = buildParagraphs(doc);
  eq('three paragraphs', paras.length, 3);
  eq('first para index 0', paras[0].index, 0);
  eq('first para text', paras[0].preview, 'a');
});

// ----- Cascade tests for descendantSectionIndexes ---------------------

group('Cascade: descendants of an H2 covers its H3/H4/H5 children', () => {
  // 7. Next Steps  ← H2 (setext, but we feed our own list to test the helper in isolation)
  const sections = [
    { index: 0, level: 2, title: 'A', paragraphIndexes: [0] },
    { index: 1, level: 3, title: 'A.1', paragraphIndexes: [1] },
    { index: 2, level: 4, title: 'A.1.a', paragraphIndexes: [2] },
    { index: 3, level: 4, title: 'A.1.b', paragraphIndexes: [3] },
    { index: 4, level: 3, title: 'A.2', paragraphIndexes: [4] },
    { index: 5, level: 2, title: 'B', paragraphIndexes: [5] },
  ];
  eq('descendants of A are A.1, A.1.a, A.1.b, A.2', descendantSectionIndexes(sections, 0), [1, 2, 3, 4]);
  eq('descendants of A.1 are A.1.a, A.1.b', descendantSectionIndexes(sections, 1), [2, 3]);
  eq('descendants of A.1.a are []', descendantSectionIndexes(sections, 2), []);
  eq('descendants of B (last heading) are []', descendantSectionIndexes(sections, 5), []);
});

group('Cascade: H1 → H2', () => {
  const sections = [
    { index: 0, level: 1, title: 'Top', paragraphIndexes: [0] },
    { index: 1, level: 2, title: 'A', paragraphIndexes: [1] },
    { index: 2, level: 2, title: 'B', paragraphIndexes: [2] },
    { index: 3, level: 1, title: 'Other', paragraphIndexes: [3] },
  ];
  eq('Top cascades to A and B but not Other', descendantSectionIndexes(sections, 0), [1, 2]);
  eq('A has no descendants', descendantSectionIndexes(sections, 1), []);
  eq('Other has no descendants', descendantSectionIndexes(sections, 3), []);
});

group('Cascade: level-0 (preamble / fallback) sections never have descendants', () => {
  const sections = [
    { index: 0, level: 0, title: 'preamble', paragraphIndexes: [0] },
    { index: 1, level: 0, title: 'fallback block', paragraphIndexes: [1] },
  ];
  eq('preamble cascades to nothing', descendantSectionIndexes(sections, 0), []);
  eq('fallback cascades to nothing', descendantSectionIndexes(sections, 1), []);
});

group('Cascade: out-of-range index returns []', () => {
  const sections = [{ index: 0, level: 1, title: 'A', paragraphIndexes: [0] }];
  eq('negative index', descendantSectionIndexes(sections, -1), []);
  eq('beyond end', descendantSectionIndexes(sections, 5), []);
  eq('empty sections list', descendantSectionIndexes([], 0), []);
});

group('Cascade: ticks then unticks round-trip back to original', () => {
  // Simulate the toggle logic: tick parent → cascade; untick parent
  // → cascade-untick all descendants, leaving other selections alone.
  const sections = [
    { index: 0, level: 2, title: 'A', paragraphIndexes: [0] },
    { index: 1, level: 3, title: 'A.1', paragraphIndexes: [1] },
    { index: 2, level: 3, title: 'A.2', paragraphIndexes: [2] },
    { index: 3, level: 2, title: 'B', paragraphIndexes: [3] },
  ];
  let selected = new Set();
  // Tick A.
  selected.add(0);
  for (const d of descendantSectionIndexes(sections, 0)) selected.add(d);
  eq('after tick A', Array.from(selected).sort(), [0, 1, 2]);
  // Tick B.
  selected.add(3);
  for (const d of descendantSectionIndexes(sections, 3)) selected.add(d);
  eq('after tick B too', Array.from(selected).sort(), [0, 1, 2, 3]);
  // Untick A → cascades remove A.1, A.2.
  selected.delete(0);
  for (const d of descendantSectionIndexes(sections, 0)) selected.delete(d);
  eq('after untick A', Array.from(selected).sort(), [3]);
  // Ticking a child (A.1) does NOT re-add the parent.
  selected.add(1);
  eq('ticking a child does not affect the parent', selected.has(0), false);
});

group('Cascade: real Collateral Full Memo structure (H2 → H3 → H4 → H5)', () => {
  // Mirror the actual doc structure: ATX H2 → H3 → H4 → H5. Ticking
  // the H2 should select all descendants in one operation. We use
  // ATX here (not setext) because setext needs a real `===`/`---`
  // underline — and the cascade logic doesn't care which.
  const content = `
## 2. Purpose
Purpose body.

### 2.1 Sub A
Sub A body.

#### 2.1.1 Detail 1
Detail body.

#### 2.1.2 Detail 2
Detail body.

### 2.2 Sub B
Sub B body.
`;
  const sections = buildHeadingSections({ content });
  // Find the "2. Purpose" section.
  const purpose = sections.find((s) => s.title === '2. Purpose');
  eq('found 2. Purpose', !!purpose, true);
  if (purpose) {
    const desc = descendantSectionIndexes(sections, purpose.index);
    const descTitles = desc.map((d) => sections[d].title);
    eq('cascades through 2.1, 2.1.1, 2.1.2, 2.2', descTitles, [
      '2.1 Sub A',
      '2.1.1 Detail 1',
      '2.1.2 Detail 2',
      '2.2 Sub B',
    ]);
  }
});

// ----- plainTextDiff tests -------------------------------------------

group('plainTextDiff: pure insertion in the middle', () => {
  eq('insert "XYZ" at offset 5', plainTextDiff('hello world', 'helloXYZ world'), {
    prefixLen: 5,
    oldEnd: 5,
    newEnd: 8,
  });
});

group('plainTextDiff: pure deletion in the middle', () => {
  eq('delete chars 5..8', plainTextDiff('helloXYZ world', 'hello world'), {
    prefixLen: 5,
    oldEnd: 8,
    newEnd: 5,
  });
});

group('plainTextDiff: replacement', () => {
  eq('replace "fox" with "cat"', plainTextDiff('the quick fox', 'the quick cat'), {
    prefixLen: 10,
    oldEnd: 13,
    newEnd: 13,
  });
});

group('plainTextDiff: empty / identity', () => {
  eq('empty to empty', plainTextDiff('', ''), { prefixLen: 0, oldEnd: 0, newEnd: 0 });
  eq('empty to non-empty', plainTextDiff('', 'abc'), { prefixLen: 0, oldEnd: 0, newEnd: 3 });
  eq('non-empty to empty', plainTextDiff('abc', ''), { prefixLen: 0, oldEnd: 3, newEnd: 0 });
  eq('identical strings', plainTextDiff('abc', 'abc'), { prefixLen: 3, oldEnd: 3, newEnd: 3 });
});

group('plainTextDiff: prefix-only change (append)', () => {
  // When the change is purely at the end, prefix grows to the full length
  // of the shorter string and suffix is 0.
  eq('append "!"', plainTextDiff('abc', 'abc!'), { prefixLen: 3, oldEnd: 3, newEnd: 4 });
});

group('plainTextDiff: change spans the full string', () => {
  eq('completely different', plainTextDiff('abc', 'xyz'), {
    prefixLen: 0,
    oldEnd: 3,
    newEnd: 3,
  });
});

// ----- roundtrip tests for serializeRawWithMentions / parseRawWithMentions

group('Roundtrip: empty', () => {
  const { plain, mentions, positions } = parseRawWithMentions('');
  eq('plain empty', plain, '');
  eq('no mentions', mentions.length, 0);
  eq('no positions', positions.size, 0);
  // Empty round-trip.
  const out = serializeRawWithMentions(plain, positions, mentions);
  eq('serialize empty == empty', out, '');
});

group('Roundtrip: prose only (no sentinels)', () => {
  const input = 'Hello, world! How are you?';
  const { plain, mentions, positions } = parseRawWithMentions(input);
  eq('plain text preserved', plain, input);
  eq('no mentions', mentions.length, 0);
  const out = serializeRawWithMentions(plain, positions, mentions);
  eq('serialize round-trips', out, input);
});

group('Roundtrip: prose + 1 mention in the middle', () => {
  // Build a token with a stable id and a fake but well-formed
  // sentinel via buildSentinel? No — we don't have access to it
  // here. So we construct the raw value manually and verify that
  // parse + serialize reproduce it exactly.
  const sentinel = '\u200B[[mention:abc-123|doc-section|Test Doc|5,6,7|doc-id-1|context|]]\u200B';
  const input = 'Before ' + sentinel + ' after';
  const { plain, mentions, positions } = parseRawWithMentions(input);
  eq('plain strips sentinel', plain, 'Before  after');
  eq('one mention', mentions.length, 1);
  eq('mention id', mentions[0].id, 'abc-123');
  eq('mention title', mentions[0].documentTitle, 'Test Doc');
  eq('mention kind', mentions[0].kind, 'doc-section');
  eq('paragraph indexes', mentions[0].paragraphIndexes, [5, 6, 7]);
  // Re-serialise with the same plain + positions + mentions.
  const out = serializeRawWithMentions(plain, positions, mentions);
  eq('round-trip preserves input', out, input);
});

group('Roundtrip: prose + 2 mentions at different positions', () => {
  const s1 = '\u200B[[mention:id-1|doc|Doc One||d1||]]\u200B';
  const s2 = '\u200B[[mention:id-2|doc-section|Doc Two|1,2,3|d2||]]\u200B';
  const input = s1 + ' middle ' + s2;
  const { plain, mentions, positions } = parseRawWithMentions(input);
  eq('plain strips both sentinels', plain, ' middle ');
  eq('two mentions', mentions.length, 2);
  eq('first mention id', mentions[0].id, 'id-1');
  eq('second mention id', mentions[1].id, 'id-2');
  const out = serializeRawWithMentions(plain, positions, mentions);
  eq('round-trip preserves two-mention input', out, input);
});

group('Roundtrip: simulating a real user reproduction', () => {
  // The exact scenario from the bug screenshot: prose + a doc-section
  // mention with 47 paragraph indexes. The textarea should show ONLY
  // the prose, not the raw sentinel.
  const paraCSV = Array.from({ length: 47 }, (_, i) => i + 35).join(',');
  const sentinel = `\u200B[[mention:44b3c2ac-0481-4f11-81ae-7c28c8e3c9c4|doc-section|Collateral Full Memo|${paraCSV}|doc-uuid||]]\u200B`;
  const prose = 'For each New Requirements, elaborate more into how the new requirements can mitigate what risk. ';
  const input = prose + sentinel;
  const { plain, mentions, positions } = parseRawWithMentions(input);
  // The textarea should display ONLY the prose.
  eq('textarea-visible text is the prose only', plain, prose);
  eq('mention count is 1', mentions.length, 1);
  eq('mention title', mentions[0].documentTitle, 'Collateral Full Memo');
  // The serialize round-trip keeps the raw value identical so the
  // parent's existing data model is unchanged.
  const out = serializeRawWithMentions(plain, positions, mentions);
  eq('raw value round-trips intact', out, input);
});

group('Roundtrip: inline caption + ZWSP marker in the prose', () => {
  // The textarea-visible text is the user's prose plus the inline
  // caption plus a single trailing ZWSP marker. The mention's
  // `plainStart`/`plainEnd` cover that whole range. When we
  // serialise to raw, the inline caption + ZWSP are stripped and
  // replaced by the sentinel so the LLM sees clean prose without
  // duplicated text. The mention metadata (paragraph indexes,
  // kind, doc id) is preserved.
  const prose = 'Adjust the paragraph by referencing ';
  const caption = '§ 4.1 (A) Structural and Format Reorganization';
  const inline = prose + caption + '\u200B';
  const mention = {
    id: 'm1',
    kind: 'doc-section',
    documentId: 'd1',
    documentTitle: 'Collateral Full Memo',
    paragraphIndexes: [10, 11, 12, 13],
    createdAt: 0,
  };
  const positions = new Map([
    ['m1', { plainStart: prose.length, plainEnd: inline.length }],
  ]);
  // The raw value (what the parent stores) is prose + sentinel,
  // with the inline caption + ZWSP stripped.
  const raw = serializeRawWithMentions(inline, positions, [mention]);
  // The raw must start with the prose (no inline caption in the
  // wire format) and contain the sentinel.
  eq('raw starts with the prose', raw.startsWith(prose), true);
  eq('raw contains the sentinel', raw.includes('[[mention:m1|'), true);
  // The raw must NOT contain the inline caption (otherwise the
  // LLM would see duplicated text).
  eq(
    'raw does not duplicate the inline caption',
    raw.includes(caption),
    false
  );

  // Re-parse what the parent would store.
  const reparsed = parseRawWithMentions(raw);
  eq('reparsed mention count is 1', reparsed.mentions.length, 1);
  eq(
    'reparsed mention paragraph indexes are intact',
    reparsed.mentions[0].paragraphIndexes,
    [10, 11, 12, 13]
  );
  // Re-serialising should be idempotent.
  const again = serializeRawWithMentions(
    reparsed.plain,
    reparsed.positions,
    reparsed.mentions
  );
  eq('re-serialise is idempotent', again, raw);
});

group('Range diff: deleting the ZWSP marker drops the mention', () => {
  // Setup: prose + inline caption + ZWSP at positions [ms, me).
  const prose = 'Hello ';
  const caption = '§ 4.1 (A)';
  const inline = prose + caption + '\u200B';
  const mention = {
    id: 'm1',
    kind: 'doc-section',
    documentId: 'd1',
    documentTitle: 'Doc',
    paragraphIndexes: [0],
    createdAt: 0,
  };
  const positions = new Map([
    ['m1', { plainStart: prose.length, plainEnd: inline.length }],
  ]);
  // Simulate the user selecting the ZWSP + a trailing character and
  // deleting them. The diff is [me-1, me+1) -> [me-1, me-1).
  const zwspAt = inline.length - 1;
  const oldEnd = zwspAt + 1; // deletion includes ZWSP and one char after
  const newEnd = zwspAt; // new range is empty (no insertion)
  const prefixLen = zwspAt;
  const delta = newEnd - oldEnd; // -1
  // Apply the same logic the component uses.
  const next = new Map();
  for (const [id, p] of positions.entries()) {
    if (oldEnd > p.plainEnd - 1) continue; // ZWSP removed → drop
    if (p.plainStart >= oldEnd) {
      next.set(id, { plainStart: p.plainStart + delta, plainEnd: p.plainEnd + delta });
    } else {
      next.set(id, p);
    }
  }
  eq('mention is dropped when ZWSP is deleted', next.size, 0);
});

group('Range diff: editing within the caption range preserves the mention', () => {
  // Setup: prose + inline caption + ZWSP.
  const prose = 'Hello ';
  const caption = '§ 4.1 (A)';
  const inline = prose + caption + '\u200B';
  const mention = {
    id: 'm1',
    kind: 'doc-section',
    documentId: 'd1',
    documentTitle: 'Doc',
    paragraphIndexes: [0],
    createdAt: 0,
  };
  const positions = new Map([
    ['m1', { plainStart: prose.length, plainEnd: inline.length }],
  ]);
  // User edits a character inside the caption (between ms and
  // me-1). The ZWSP survives.
  const editPos = prose.length + 4; // somewhere inside the caption
  const newInline = inline.slice(0, editPos) + 'X' + inline.slice(editPos + 1);
  // Diff: [editPos, editPos+1) -> [editPos, editPos+2)
  const oldEnd = editPos + 1;
  const newEnd = editPos + 2;
  const prefixLen = editPos;
  const delta = 1;
  const next = new Map();
  for (const [id, p] of positions.entries()) {
    if (oldEnd > p.plainEnd - 1) continue;
    if (p.plainStart >= oldEnd) {
      next.set(id, { plainStart: p.plainStart + delta, plainEnd: p.plainEnd + delta });
    } else if (oldEnd > p.plainStart) {
      next.set(id, { plainStart: prefixLen, plainEnd: p.plainEnd + delta });
    } else {
      next.set(id, p);
    }
  }
  eq('mention survives an in-range edit', next.size, 1);
  const updated = next.get('m1');
  // The new range starts at the edit point and ends at the original
  // end shifted by delta.
  eq('plainStart moves to edit point', updated.plainStart, prefixLen);
  eq('plainEnd shifts by delta', updated.plainEnd, inline.length + delta);
});

// Summary ----------------------------------------------------------------

await fs.rm(TMP_DIR, { recursive: true, force: true });
console.log(`\n${DIM}── summary ──${RESET}`);
console.log(
  totalFailures === 0
    ? `${GREEN}All ${totalChecks} checks passed.${RESET}`
    : `${RED}${totalFailures} of ${totalChecks} checks failed.${RESET}`
);
process.exit(totalFailures === 0 ? 0 : 1);