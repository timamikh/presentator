// Pure helper that turns SQL rows of (attachment + job_attachment) into the
// shape that the staged pipeline ships to n8n.
//
// History: earlier versions only sent `summary` (= content_summary, capped
// at 1500 chars in extractor-service) and only on the planning stage; the
// design / layout / refine prompts received attachments without any body
// text, which forced the LLM to fabricate the contents of uploaded
// documents (e.g. invent an event schedule from a PDF that already had
// one). This helper now exposes the full `extracted_text` (already capped
// to 50k chars in DB) as `content` and surfaces it to every stage. The
// downstream n8n build-*-prompt nodes apply their own per-stage trimming.

const DEFAULT_MAX_CONTENT_CHARS = 50_000;

function nonEmptyString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Pick the richest available textual content for a row, in priority order:
 *   extracted_text  → full document body (preferred)
 *   content_summary → short summary (fallback)
 *   description_snapshot → user-provided one-liner (last resort)
 * Returns null when nothing usable is available.
 */
function pickAttachmentContent(row = {}) {
  return (
    nonEmptyString(row.extracted_text) ||
    nonEmptyString(row.content_summary) ||
    nonEmptyString(row.description_snapshot) ||
    null
  );
}

function truncate(value, maxChars) {
  if (typeof value !== 'string') return value;
  if (!Number.isFinite(maxChars) || maxChars <= 0) return value;
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars) + '…';
}

/**
 * Build the (attachments, attachmentMap) pair from raw SQL rows.
 *
 * The caller's SELECT must include: id, ref, original_name, storage_path,
 * mime_type, file_size, kind, width, height, content_summary, extracted_text,
 * description_snapshot, sort_order.
 *
 * @param {Array} rows
 * @param {Object} [options]
 * @param {number} [options.maxContentChars=50000] — defense-in-depth cap on
 *        the `content` field. n8n nodes apply tighter per-stage caps, but
 *        we still cap here so a buggy SELECT can't dump megabytes of text
 *        into the webhook payload.
 * @returns {{ attachments: Array, attachmentMap: Object }}
 */
function buildAttachmentPayloadFromRows(rows, options = {}) {
  const maxContentChars =
    typeof options.maxContentChars === 'number'
      ? options.maxContentChars
      : DEFAULT_MAX_CONTENT_CHARS;

  const attachments = [];
  const attachmentMap = {};

  if (!Array.isArray(rows)) return { attachments, attachmentMap };

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;

    const content = pickAttachmentContent(row);
    const summary = nonEmptyString(row.content_summary);
    const description = nonEmptyString(row.description_snapshot);

    attachments.push({
      ref: row.ref,
      kind: row.kind,
      filename: row.original_name,
      mimeType: row.mime_type,
      fileSize: row.file_size,
      description,
      summary,
      content: content ? truncate(content, maxContentChars) : null,
      width: row.width,
      height: row.height,
    });

    if (row.ref) {
      attachmentMap[row.ref] = {
        id: row.id,
        localPath: row.storage_path,
        mimeType: row.mime_type,
        filename: row.original_name,
      };
    }
  }

  return { attachments, attachmentMap };
}

module.exports = {
  buildAttachmentPayloadFromRows,
  pickAttachmentContent,
  DEFAULT_MAX_CONTENT_CHARS,
};
