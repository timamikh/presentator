// The buildDocumentsBlock helper is the shared algorithm used by every
// n8n build-*-prompt node to render attachments as a structured
// <DOCUMENTS> block in the LLM user-message. The exact implementation is
// inlined into the n8n workflow JSON (n8n nodes don't have npm imports),
// so this test suite is the single regression net for the algorithm —
// any tweak to the n8n inline copy must keep these tests green.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDocumentsBlock,
  buildAttachmentList,
} = require('./documentsBlock');

function makeAtt(over = {}) {
  return {
    ref: 'att_a',
    kind: 'document',
    filename: 'doc.pdf',
    mimeType: 'application/pdf',
    description: null,
    summary: null,
    content: null,
    width: null,
    height: null,
    ...over,
  };
}

test('buildDocumentsBlock returns empty string when no attachments', () => {
  assert.equal(buildDocumentsBlock([]), '');
  assert.equal(buildDocumentsBlock(null), '');
  assert.equal(buildDocumentsBlock(undefined), '');
});

test('buildDocumentsBlock skips attachments that have no content', () => {
  // Image-only attachments without description have nothing useful to
  // give the planner — they should not pollute the prompt.
  const block = buildDocumentsBlock(
    [
      makeAtt({ ref: 'att_x', kind: 'image', content: null }),
    ],
    {},
  );
  assert.equal(block, '');
});

test('buildDocumentsBlock wraps each entry with [ref=...] header and full content', () => {
  const block = buildDocumentsBlock(
    [
      makeAtt({
        ref: 'att_a',
        filename: 'agenda.pdf',
        content: 'Day 1\n10:00 Opening\n11:00 Keynote',
      }),
    ],
    {},
  );
  assert.match(block, /^<DOCUMENTS>/);
  assert.match(block, /<\/DOCUMENTS>$/);
  assert.match(block, /\[ref=att_a, kind=document, filename=agenda\.pdf\]/);
  assert.match(block, /Day 1\n10:00 Opening\n11:00 Keynote/);
});

test('buildDocumentsBlock truncates per-document content to maxCharsPerDoc', () => {
  const big = 'X'.repeat(3000);
  const block = buildDocumentsBlock(
    [makeAtt({ ref: 'att_a', content: big })],
    { maxCharsPerDoc: 100 },
  );
  // 100 char body + ellipsis marker. Header lines are extra.
  assert.ok(
    block.includes('X'.repeat(100) + '…'),
    'should append the ellipsis marker after truncation',
  );
  assert.ok(
    !block.includes('X'.repeat(101)),
    'should never include more than maxCharsPerDoc Xs',
  );
});

test('buildDocumentsBlock honors a global maxTotalChars budget', () => {
  // Two big documents. Each individually fits under maxCharsPerDoc, but
  // together they exceed maxTotalChars — the helper must drop later docs.
  const a = 'A'.repeat(500);
  const b = 'B'.repeat(500);
  const block = buildDocumentsBlock(
    [
      makeAtt({ ref: 'att_a', content: a }),
      makeAtt({ ref: 'att_b', content: b }),
    ],
    { maxCharsPerDoc: 1000, maxTotalChars: 600 },
  );
  assert.ok(block.includes('att_a'), 'first doc must fit');
  // Either att_b is fully absent, or its content was truncated to fit.
  if (block.includes('att_b')) {
    const bIdx = block.indexOf('B'.repeat(1));
    const bEnd = block.lastIndexOf('B');
    assert.ok(bEnd - bIdx < 500, 'second doc must be truncated');
  }
});

test('buildDocumentsBlock falls back to summary then description when content is missing', () => {
  // For attachments where extractor failed but the user wrote a description,
  // the description should still surface in the prompt.
  const block = buildDocumentsBlock(
    [
      makeAtt({
        ref: 'att_a',
        content: null,
        summary: 'A short summary of the file.',
        description: null,
      }),
      makeAtt({
        ref: 'att_b',
        content: null,
        summary: null,
        description: 'User-authored note.',
      }),
    ],
    {},
  );
  assert.match(block, /A short summary of the file\./);
  assert.match(block, /User-authored note\./);
});

test('buildAttachmentList renders ref/kind/filename/dim line per attachment', () => {
  const list = buildAttachmentList([
    makeAtt({ ref: 'att_a', kind: 'document', filename: 'a.pdf' }),
    makeAtt({
      ref: 'att_b',
      kind: 'image',
      filename: 'logo.png',
      width: 1024,
      height: 512,
      mimeType: 'image/png',
    }),
  ]);
  assert.match(list, /\[att_a\]/);
  assert.match(list, /\[att_b\]/);
  assert.match(list, /1024x512/);
  assert.match(list, /image\/png/);
});

test('buildAttachmentList returns empty string for no attachments', () => {
  assert.equal(buildAttachmentList([]), '');
  assert.equal(buildAttachmentList(null), '');
});
