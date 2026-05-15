// Unit tests for the pure attachment-payload builder used by the staged
// pipeline orchestrator (services/pipeline.js → loadJobAttachments).
//
// The builder is the single source of truth for what data about an
// attachment is shipped to n8n (and from there, to the LLM). The contract
// is asserted explicitly here so future refactors can't silently drop the
// `content` field — that was the root cause of the "LLM hallucinates the
// schedule from an uploaded PDF" regression: the document text never made
// it past the planning stage.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAttachmentPayloadFromRows,
  pickAttachmentContent,
} = require('./attachmentPayload');

function makeRow(overrides = {}) {
  return {
    id: 'a1',
    ref: 'att_aaaaaaaa',
    original_name: 'agenda.pdf',
    storage_path: '/data/library/u1/a1_agenda.pdf',
    mime_type: 'application/pdf',
    file_size: 12345,
    kind: 'document',
    width: null,
    height: null,
    content_summary: null,
    extracted_text: null,
    description_snapshot: null,
    sort_order: 0,
    ...overrides,
  };
}

test('pickAttachmentContent prefers extracted_text over summary over description', () => {
  assert.equal(
    pickAttachmentContent({
      extracted_text: 'FULL',
      content_summary: 'SHORT',
      description_snapshot: 'desc',
    }),
    'FULL',
  );
  assert.equal(
    pickAttachmentContent({
      extracted_text: null,
      content_summary: 'SHORT',
      description_snapshot: 'desc',
    }),
    'SHORT',
  );
  assert.equal(
    pickAttachmentContent({
      extracted_text: null,
      content_summary: null,
      description_snapshot: 'desc',
    }),
    'desc',
  );
  assert.equal(
    pickAttachmentContent({
      extracted_text: null,
      content_summary: null,
      description_snapshot: null,
    }),
    null,
  );
});

test('pickAttachmentContent ignores empty strings and whitespace-only values', () => {
  assert.equal(
    pickAttachmentContent({
      extracted_text: '   ',
      content_summary: 'real',
    }),
    'real',
  );
  assert.equal(
    pickAttachmentContent({
      extracted_text: '',
      content_summary: '',
      description_snapshot: 'desc',
    }),
    'desc',
  );
});

test('buildAttachmentPayloadFromRows returns parallel attachments + attachmentMap', () => {
  const rows = [
    makeRow({
      id: 'a1',
      ref: 'att_one',
      original_name: 'agenda.pdf',
      kind: 'document',
      extracted_text: 'Day 1\n10:00 Opening\n11:00 Keynote',
      content_summary: 'Conference schedule.',
      description_snapshot: 'Event agenda',
    }),
    makeRow({
      id: 'a2',
      ref: 'att_two',
      original_name: 'logo.png',
      mime_type: 'image/png',
      kind: 'image',
      width: 1024,
      height: 512,
      description_snapshot: 'Company logo',
      extracted_text: null,
      content_summary: null,
      storage_path: '/data/library/u1/a2_logo.png',
    }),
  ];

  const { attachments, attachmentMap } = buildAttachmentPayloadFromRows(rows, {});

  assert.equal(attachments.length, 2);

  const [doc, img] = attachments;
  assert.equal(doc.ref, 'att_one');
  assert.equal(doc.kind, 'document');
  assert.equal(doc.filename, 'agenda.pdf');
  assert.equal(doc.description, 'Event agenda');
  assert.equal(doc.summary, 'Conference schedule.');
  // The crucial invariant: document body must be present in the payload,
  // otherwise downstream stages (design / layout) hallucinate.
  assert.equal(doc.content, 'Day 1\n10:00 Opening\n11:00 Keynote');

  assert.equal(img.ref, 'att_two');
  assert.equal(img.kind, 'image');
  assert.equal(img.width, 1024);
  assert.equal(img.height, 512);
  // Image with no extracted_text falls back to description (so the LLM at
  // least knows what the picture is about).
  assert.equal(img.content, 'Company logo');

  assert.equal(attachmentMap.att_one.id, 'a1');
  assert.equal(attachmentMap.att_one.localPath, '/data/library/u1/a1_agenda.pdf');
  assert.equal(attachmentMap.att_two.id, 'a2');
});

test('buildAttachmentPayloadFromRows truncates content when maxContentChars is set', () => {
  const longText = 'x'.repeat(20_000);
  const rows = [makeRow({ extracted_text: longText })];
  const { attachments } = buildAttachmentPayloadFromRows(rows, {
    maxContentChars: 1000,
  });
  // 1000 chars + ellipsis marker. We don't assert the exact suffix, just
  // that the cap is honored.
  assert.ok(
    attachments[0].content.length <= 1010,
    `expected truncated content (<= 1010 chars), got ${attachments[0].content.length}`,
  );
});

test('buildAttachmentPayloadFromRows is empty-safe', () => {
  const { attachments, attachmentMap } = buildAttachmentPayloadFromRows([], {});
  assert.deepEqual(attachments, []);
  assert.deepEqual(attachmentMap, {});
});

test('buildAttachmentPayloadFromRows tolerates rows missing optional fields', () => {
  // Defense-in-depth: a SELECT may evolve and add NULLs; the helper must
  // never crash because of a missing column.
  const rows = [
    {
      id: 'a1',
      ref: 'att_a',
      original_name: 'x.txt',
      storage_path: '/p',
      mime_type: null,
      file_size: null,
      kind: 'document',
      width: null,
      height: null,
      // content_summary, extracted_text, description_snapshot all absent
    },
  ];
  const { attachments } = buildAttachmentPayloadFromRows(rows, {});
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].content, null);
  assert.equal(attachments[0].summary, null);
  assert.equal(attachments[0].description, null);
});
