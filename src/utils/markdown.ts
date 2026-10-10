// Shared react-markdown plugin wiring.
//
// Raw HTML is allowed so the B/I/U toolbar's `<u>` tags render, but every
// HTML node is run through rehype-sanitize afterward so untrusted document
// or assistant content cannot execute scripts (stored XSS → localStorage
// API-key theft).
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema, type Options as SanitizeOptions } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import type { PluggableList } from 'unified';

const sanitizeSchema: SanitizeOptions = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'u'],
};

export const remarkPlugins: PluggableList = [remarkGfm];

/** Parse raw HTML, then strip dangerous tags/attrs (scripts, handlers, …). */
export const rehypePlugins: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
];
