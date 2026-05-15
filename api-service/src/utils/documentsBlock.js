// Shared algorithm for rendering an attachments array as the <DOCUMENTS>
// block that the staged-pipeline LLM prompts consume.
//
// The exact implementation is inlined into every n8n build-*-prompt node
// (n8n nodes don't have access to npm modules). This file is the canonical
// source: when changing the algorithm, update both this file AND the
// inline copies in n8n-workflows/presentator-pipeline.json, and run the
// regression tests in documentsBlock.test.js.

const DEFAULT_MAX_CHARS_PER_DOC = 6000;
const DEFAULT_MAX_TOTAL_CHARS = 24000;

function nonEmpty(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function truncate(value, maxChars) {
  if (typeof value !== 'string') return '';
  if (!Number.isFinite(maxChars) || maxChars <= 0) return value;
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars) + '…';
}

function pickBody(att) {
  return (
    nonEmpty(att?.content) ||
    nonEmpty(att?.summary) ||
    nonEmpty(att?.description) ||
    null
  );
}

/**
 * Render attachments as a single <DOCUMENTS>…</DOCUMENTS> block suitable
 * for inclusion in an LLM user-message. Returns '' when there is nothing
 * substantive to include.
 *
 * @param {Array} attachments — items from the n8n payload (objects with
 *        ref / kind / filename / content / summary / description).
 * @param {Object} [options]
 * @param {number} [options.maxCharsPerDoc=6000]
 * @param {number} [options.maxTotalChars=24000]
 */
function buildDocumentsBlock(attachments, options = {}) {
  if (!Array.isArray(attachments) || attachments.length === 0) return '';

  const maxCharsPerDoc =
    Number.isFinite(options.maxCharsPerDoc) && options.maxCharsPerDoc > 0
      ? options.maxCharsPerDoc
      : DEFAULT_MAX_CHARS_PER_DOC;

  const maxTotalChars =
    Number.isFinite(options.maxTotalChars) && options.maxTotalChars > 0
      ? options.maxTotalChars
      : DEFAULT_MAX_TOTAL_CHARS;

  const parts = [];
  let totalChars = 0;

  for (const att of attachments) {
    if (!att || typeof att !== 'object') continue;
    const body = pickBody(att);
    if (!body) continue;

    const remaining = maxTotalChars - totalChars;
    if (remaining <= 0) break;

    const docCap = Math.min(maxCharsPerDoc, remaining);
    const truncated = truncate(body, docCap);
    const ref = att.ref || 'att_unknown';
    const kind = att.kind || 'document';
    const filename = att.filename || '';
    const header = `[ref=${ref}, kind=${kind}, filename=${filename}]`;

    const entry = `${header}\n${truncated}`;
    parts.push(entry);
    // +2 newlines between entries
    totalChars += entry.length + 2;
  }

  if (parts.length === 0) return '';

  return `<DOCUMENTS>\n${parts.join('\n\n')}\n</DOCUMENTS>`;
}

/**
 * Render attachments as a flat list (ref + kind + filename + dims). Used
 * alongside <DOCUMENTS> on stages where the LLM also needs to know about
 * image attachments it may embed via {{attachment:<ref>}} placeholders.
 */
function buildAttachmentList(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return '';
  const lines = [];
  for (const att of attachments) {
    if (!att || typeof att !== 'object') continue;
    const dim = att.width && att.height ? ` ${att.width}x${att.height}` : '';
    const filename = att.filename ? `, ${att.filename}` : '';
    const mime = att.mimeType ? `, mime=${att.mimeType}` : '';
    lines.push(`- [${att.ref || 'att_?'}] kind=${att.kind || 'other'}${filename}${dim}${mime}`);
    if (nonEmpty(att.description)) {
      lines.push(`  Description: ${att.description.slice(0, 240)}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  buildDocumentsBlock,
  buildAttachmentList,
  pickBody,
  truncate,
  DEFAULT_MAX_CHARS_PER_DOC,
  DEFAULT_MAX_TOTAL_CHARS,
};
