/* eslint-disable no-console */
// Smoke-test the @-mention prompt pipeline with a realistic fixture.
// Run with:  npx vite-node scripts/measure-prompt.ts
//            (or `node --import tsx scripts/measure-prompt.ts`)
//
// Emits char + token counts for three scenarios:
//   1. Plain chat (no mentions)
//   2. Single doc mentioned (whole-doc)
//   3. Comment-batch with two referenced docs (section + whole)
//
// Verifies:
//   - Self-reference suppression saves the expected chunk.
//   - The composite dedupe key keeps both a section + whole-doc
//     mention of the same source.
//   - The cross-reference map is emitted only when ≥ 2 comments
//     have mentions.
//   - The turn-wide cap downgrades the trailing doc when the
//     verbatim payload would exceed 8 KB.
//
// Token estimation uses the rough rule of thumb of 1 token ≈ 4
// characters (English prose), which matches OpenAI's tokenizer
// approximation for GPT-3.5/4 content blocks.

import {
  buildRequestMessages,
  REFERENCED_DOCS_TOTAL_CHARS_CAP,
} from '../src/api/chat';
import type {
  ChatMessage,
  DocumentRecord,
  MentionToken,
} from '../src/types';

// --- Fixture -----------------------------------------------------------------

function makeDoc(
  id: string,
  title: string,
  paragraphs: number
): DocumentRecord {
  const body = Array.from({ length: paragraphs })
    .map(
      (_, i) =>
        `Paragraph ${i + 1}. This is filler for the document titled "${title}". ` +
        `It contains some reasonably long prose so that the outline preview ` +
        `and the section slice are both meaningful sizes to measure against.`
    )
    .join('\n');
  return {
    id,
    title,
    content: body,
    createdAt: 0,
    updatedAt: 0,
  };
}

const docs: DocumentRecord[] = [
  makeDoc('doc-current', 'Current Policy', 50), // 50 paras ~ 6 KB
  makeDoc('doc-ref-style', 'Style Guide', 30), // 30 paras ~ 3.6 KB
  makeDoc('doc-ref-glossary', 'Glossary', 25), // 25 paras ~ 3 KB
];

const lookup = (id: string) => docs.find((d) => d.id === id) ?? null;

// --- Helpers -----------------------------------------------------------------

function approxTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function summarize(label: string, msgs: ChatMessage[]): void {
  const totalChars = msgs.reduce((acc, m) => acc + m.content.length, 0);
  const totalTokens = approxTokens(totalChars);
  console.log(
    `${label}: ${msgs.length} messages, ${totalChars} chars, ~${totalTokens} tokens`
  );
}

function findSysMessage(
  msgs: ChatMessage[],
  prefix: string
): ChatMessage | undefined {
  return msgs.find((m) => m.id.startsWith(prefix));
}

// --- Scenario 1: plain chat, no mentions ------------------------------------

console.log('\n== Scenario 1: plain chat ==');
{
  const history: ChatMessage[] = [];
  const messages = buildRequestMessages(
    history,
    undefined,
    { title: 'Current Policy', content: docs[0].content, id: 'doc-current' },
    undefined,
    undefined,
    lookup
  );
  summarize('plain chat', messages);
  // Sanity: no referenced-doc messages
  const refCount = messages.filter((m) =>
    m.id.startsWith('sys-referenced-doc-')
  ).length;
  console.log(`  referenced-doc messages: ${refCount}`);
}

// --- Scenario 2: mention the doc you are editing (whole-doc) ----------------

console.log('\n== Scenario 2: self-reference (mention current doc) ==');
{
  const ref: MentionToken = {
    id: 'm1',
    kind: 'doc',
    documentId: 'doc-current',
    documentTitle: 'Current Policy',
    paragraphIndexes: [],
    createdAt: 0,
  };
  const messages = buildRequestMessages(
    [],
    undefined,
    { title: 'Current Policy', content: docs[0].content, id: 'doc-current' },
    undefined,
    [ref],
    lookup
  );
  summarize('self-ref', messages);
  const refCount = messages.filter((m) =>
    m.id.startsWith('sys-referenced-doc-')
  ).length;
  console.log(`  referenced-doc messages (should be 0): ${refCount}`);
}

// --- Scenario 3: comment batch with two external referenced docs ------------

console.log('\n== Scenario 3: comment batch + 2 ref docs ==');
{
  const mentionA: MentionToken = {
    id: 'ma',
    kind: 'doc-section',
    documentId: 'doc-ref-style',
    documentTitle: 'Style Guide',
    paragraphIndexes: [0, 1, 2],
    createdAt: 0,
    reason: 'style',
    referrerId: 'c1',
  };
  const mentionB: MentionToken = {
    id: 'mb',
    kind: 'doc',
    documentId: 'doc-ref-glossary',
    documentTitle: 'Glossary',
    paragraphIndexes: [],
    createdAt: 0,
    reason: 'terminology',
    referrerId: 'c2',
  };
  // Build a comment-batch user message manually.
  const commentBatchUserMessage: ChatMessage = {
    id: 'u1',
    role: 'user',
    content:
      '[c1] (paragraph 5/50, doc offset 0–20)\n' +
      '"Old wording here."\n' +
      'Before: """leading context word wrap"""\n' +
      'After: """trailing context word wrap"""\n' +
      'Comment: please sharpen the prose here.\n\n' +
      '[c2] (paragraph 12/50, doc offset 400–420)\n' +
      '"Another phrase."\n' +
      'Before: """context x"""\n' +
      'After: """context y"""\n' +
      'Comment: add a glossary link here.\n',
    createdAt: 0,
  };
  const mentionsByCommentId: Record<string, MentionToken[]> = {
    c1: [mentionA],
    c2: [mentionB],
  };
  const messages = buildRequestMessages(
    [commentBatchUserMessage],
    undefined,
    { title: 'Current Policy', content: docs[0].content, id: 'doc-current' },
    undefined,
    [mentionA, mentionB],
    lookup,
    mentionsByCommentId
  );
  summarize('comment-batch+mentions', messages);

  // Check the cross-reference map exists.
  const xref = findSysMessage(messages, 'u1-comments-xref');
  console.log(`  cross-ref map emitted: ${xref ? 'YES' : 'NO'}`);
  if (xref) {
    console.log(`    preview: ${xref.content.slice(0, 200)}…`);
  }

  // Each referenced-doc message should be present.
  const refMsgs = messages.filter((m) =>
    m.id.startsWith('sys-referenced-doc-')
  );
  console.log(`  referenced-doc messages: ${refMsgs.length}`);
  refMsgs.forEach((m) => {
    const focusMatch = m.content.match(/\[context:[^\]]+\]/);
    console.log(
      `    ${m.id} (${m.content.length} chars)${focusMatch ? ' ' + focusMatch[0] : ''}`
    );
  });
}

// --- Scenario 4: composite-dedupe (same doc, section + whole) --------------

console.log('\n== Scenario 4: section + whole-doc of same doc ==');
{
  const mentionSection: MentionToken = {
    id: 'ms',
    kind: 'doc-section',
    documentId: 'doc-ref-style',
    documentTitle: 'Style Guide',
    paragraphIndexes: [0, 1],
    createdAt: 0,
  };
  const mentionWhole: MentionToken = {
    id: 'mw',
    kind: 'doc',
    documentId: 'doc-ref-style',
    documentTitle: 'Style Guide',
    paragraphIndexes: [],
    createdAt: 0,
  };
  const messages = buildRequestMessages(
    [],
    undefined,
    { title: 'Other', content: 'whatever' },
    undefined,
    [mentionSection, mentionWhole],
    lookup
  );
  summarize('composite-dedupe', messages);
  const refMsgs = messages.filter((m) =>
    m.id.startsWith('sys-referenced-doc-')
  );
  console.log(`  referenced-doc messages (should be 2): ${refMsgs.length}`);
  refMsgs.forEach((m) =>
    console.log(`    ${m.id} (${m.content.length} chars)`)
  );
}

// --- Scenario 5: turn-wide cap triggers outline-downgrade ------------------

console.log('\n== Scenario 5: turn-wide cap forces downgrade ==');
{
  // 3 big docs, each with 6 KB of section picks → ~18 KB total,
  // exceeds REFERENCED_DOCS_TOTAL_CHARS_CAP (8 KB). Each
  // `makeDoc(...paraCount: 30)` produces ~360 chars per paragraph
  // → 17 paragraphs yields ~6 KB.
  const extra1 = makeDoc('doc-ref-extra1', 'Extra 1', 17);
  const extra2 = makeDoc('doc-ref-extra2', 'Extra 2', 17);
  const extra3 = makeDoc('doc-ref-extra3', 'Extra 3', 17);
  docs.push(extra1, extra2, extra3);
  const refs: MentionToken[] = [extra1, extra2, extra3].map((d, i) => ({
    id: `c${i}`,
    kind: 'doc-section',
    documentId: d.id,
    documentTitle: d.title,
    paragraphIndexes: Array.from({ length: 17 }, (_, j) => j),
    createdAt: 0,
  }));

  const messages = buildRequestMessages(
    [],
    undefined,
    { title: 'Current', content: 'x' },
    undefined,
    refs,
    lookup
  );
  console.log(`  cap: ${REFERENCED_DOCS_TOTAL_CHARS_CAP} chars`);
  const refMsgs = messages.filter((m) =>
    m.id.startsWith('sys-referenced-doc-')
  );
  refMsgs.forEach((m) =>
    console.log(`    ${m.id} (${m.content.length} chars)`)
  );
  const totalRefChars = refMsgs.reduce((acc, m) => acc + m.content.length, 0);
  console.log(
    `  total referenced-doc chars: ${totalRefChars} (cap = ${REFERENCED_DOCS_TOTAL_CHARS_CAP})`
  );
}

console.log('\nDone.');
