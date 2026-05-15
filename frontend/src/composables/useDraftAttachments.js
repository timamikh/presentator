// Helpers for restoring library-attachments from a saved draft.
//
// Drafts only persist { attachmentId, description } per attachment (see
// api-service/src/services/drafts.js → normalizeDraftPayload). To rebuild
// the UI state on /create we need to:
//   1) extract the list of attachmentIds from the draft,
//   2) call GET /api/attachments/by-ids?ids=… to get the full rows,
//   3) merge the rows with the draft-level descriptions.
//
// Pure helpers only — no fetch, no Vue reactivity. CreateJobView wires
// them together.

/**
 * Pull non-empty attachmentIds out of a draft's attachments payload.
 * @param {Array|*} draftAttachments
 * @returns {string[]}
 */
export function extractDraftAttachmentIds(draftAttachments) {
  if (!Array.isArray(draftAttachments)) return []
  const out = []
  for (const entry of draftAttachments) {
    if (!entry || typeof entry !== 'object') continue
    const id = entry.attachmentId
    if (typeof id === 'string' && id.trim().length > 0) {
      out.push(id.trim())
    }
  }
  return out
}

/**
 * Merge a list of full attachment rows (from GET /api/attachments/by-ids)
 * with the per-draft description overrides. Preserves the order specified
 * by the draft (which is what the user saw when they saved it). Rows that
 * are missing from the API response (e.g. the user deleted them from the
 * library after saving the draft) are silently dropped.
 *
 * @param {Array} rows — server response: full attachment rows.
 * @param {Array} draftAttachments — [{ attachmentId, description }, …]
 * @returns {Array} merged rows ready to populate libraryAttachments.
 */
export function mergeDraftAttachments(rows, draftAttachments) {
  if (!Array.isArray(rows) || !Array.isArray(draftAttachments)) return []
  const rowsById = new Map()
  for (const r of rows) {
    if (r && typeof r === 'object' && typeof r.id === 'string') {
      rowsById.set(r.id, r)
    }
  }
  const out = []
  for (const entry of draftAttachments) {
    if (!entry || typeof entry !== 'object') continue
    const id = entry.attachmentId
    if (typeof id !== 'string') continue
    const row = rowsById.get(id)
    if (!row) continue
    const override =
      typeof entry.description === 'string' && entry.description.length > 0
        ? entry.description
        : row.description || ''
    out.push({ ...row, description: override })
  }
  return out
}
