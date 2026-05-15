// Tests for the shared query-param parser used by batch-lookup endpoints
// (currently: GET /api/attachments/by-ids?ids=…).
//
// The parser must:
//   • Accept both `?ids=a,b,c` (comma-separated) and `?ids=a&ids=b` (array).
//   • Reject non-UUID strings to avoid SQL parameter cost from rogue input.
//   • Cap the result length so a malicious client can't ask for 10k rows.

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseIdsParam, UUID_RE } = require('./idsParam');

test('parseIdsParam splits a comma-separated string', () => {
  const ids = parseIdsParam('11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222');
  assert.deepEqual(ids, [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ]);
});

test('parseIdsParam accepts an array as-is and trims whitespace', () => {
  const ids = parseIdsParam([
    ' 11111111-1111-4111-8111-111111111111 ',
    '22222222-2222-4222-8222-222222222222',
  ]);
  assert.equal(ids.length, 2);
  assert.equal(ids[0], '11111111-1111-4111-8111-111111111111');
});

test('parseIdsParam drops non-UUID values silently', () => {
  // Caller can decide what to do when the input list is empty (e.g. 400
  // or 200 []). We don't crash on bad input; we just filter it out.
  const ids = parseIdsParam('not-a-uuid,11111111-1111-4111-8111-111111111111,also-bad');
  assert.deepEqual(ids, ['11111111-1111-4111-8111-111111111111']);
});

test('parseIdsParam deduplicates input', () => {
  const u = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(parseIdsParam(`${u},${u},${u}`), [u]);
});

test('parseIdsParam caps the result at maxIds', () => {
  const many = Array.from({ length: 5 }, (_, i) =>
    `1111111${i}-1111-4111-8111-111111111111`,
  );
  const out = parseIdsParam(many.join(','), { maxIds: 3 });
  assert.equal(out.length, 3);
});

test('parseIdsParam returns [] for empty / null / undefined', () => {
  assert.deepEqual(parseIdsParam(undefined), []);
  assert.deepEqual(parseIdsParam(null), []);
  assert.deepEqual(parseIdsParam(''), []);
  assert.deepEqual(parseIdsParam('   '), []);
  assert.deepEqual(parseIdsParam([]), []);
});

test('UUID_RE matches v4 UUIDs and rejects garbage', () => {
  assert.ok(UUID_RE.test('11111111-1111-4111-8111-111111111111'));
  assert.ok(!UUID_RE.test('11111111-1111-4111-8111'));
  assert.ok(!UUID_RE.test('not a uuid at all'));
});
