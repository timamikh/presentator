// Tests for the pure helper used by /create when restoring a draft:
// drafts store only { attachmentId, description }, while the StoragePicker
// (and AttachmentGrid render) expects the full attachment row. The helper
// merges the two so that `applyDraft()` can repopulate libraryAttachments
// without forcing the user to re-pick everything.

import { describe, it, expect } from 'vitest'
import { mergeDraftAttachments } from './useDraftAttachments'

describe('mergeDraftAttachments', () => {
  it('returns full rows in the order of draft.attachments, with overridden descriptions', () => {
    const rows = [
      { id: 'a1', kind: 'image', ref: 'att_a1', original_name: 'a.png', description: 'orig A' },
      { id: 'b2', kind: 'document', ref: 'att_b2', original_name: 'b.pdf', description: 'orig B' },
    ]
    const draftAtt = [
      { attachmentId: 'b2', description: 'draft-level B' },
      { attachmentId: 'a1', description: 'draft-level A' },
    ]
    const merged = mergeDraftAttachments(rows, draftAtt)
    expect(merged.map((r) => r.id)).toEqual(['b2', 'a1'])
    expect(merged[0].description).toBe('draft-level B')
    expect(merged[1].description).toBe('draft-level A')
    // Untouched fields should be copied through verbatim — that's how the
    // picker preview keeps working (original_name, kind, ref, etc.).
    expect(merged[0].kind).toBe('document')
    expect(merged[1].kind).toBe('image')
  })

  it('falls back to the original description when the draft entry has no description', () => {
    const rows = [{ id: 'a1', description: 'lib desc' }]
    const merged = mergeDraftAttachments(rows, [{ attachmentId: 'a1' }])
    expect(merged[0].description).toBe('lib desc')
  })

  it('skips draft entries whose attachment is missing from rows', () => {
    // The attachment may have been deleted between save and restore. We
    // silently drop it rather than crashing the UI.
    const rows = [{ id: 'a1', description: 'kept' }]
    const merged = mergeDraftAttachments(rows, [
      { attachmentId: 'gone', description: 'dropped' },
      { attachmentId: 'a1', description: 'present' },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('a1')
  })

  it('returns [] for empty / null inputs', () => {
    expect(mergeDraftAttachments([], [])).toEqual([])
    expect(mergeDraftAttachments(null, null)).toEqual([])
    expect(mergeDraftAttachments(null, [{ attachmentId: 'a1' }])).toEqual([])
    expect(mergeDraftAttachments([{ id: 'a1' }], null)).toEqual([])
  })

  it('tolerates legacy draft entries shaped as raw uuids', () => {
    // Older drafts may have just an attachmentId without a description
    // wrapper. The helper should still find the row.
    const rows = [{ id: 'a1', description: 'orig' }]
    const merged = mergeDraftAttachments(rows, [{ attachmentId: 'a1', description: null }])
    expect(merged).toHaveLength(1)
    expect(merged[0].description).toBe('orig')
  })

  it('exposes the list of attachmentIds via extractDraftAttachmentIds', async () => {
    const { extractDraftAttachmentIds } = await import('./useDraftAttachments')
    expect(
      extractDraftAttachmentIds([
        { attachmentId: 'a1' },
        { attachmentId: 'b2', description: 'd' },
        { attachmentId: null }, // dropped
        null, // dropped
        { description: 'no id' }, // dropped
      ]),
    ).toEqual(['a1', 'b2'])
  })

  it('extractDraftAttachmentIds returns [] for non-array input', async () => {
    const { extractDraftAttachmentIds } = await import('./useDraftAttachments')
    expect(extractDraftAttachmentIds(null)).toEqual([])
    expect(extractDraftAttachmentIds(undefined)).toEqual([])
    expect(extractDraftAttachmentIds('a,b,c')).toEqual([])
  })
})
