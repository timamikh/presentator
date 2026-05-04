const test = require('node:test');
const assert = require('node:assert/strict');
const {
  substituteAttachmentTokens,
  substituteSlideDataTokens,
  ATTACHMENT_TOKEN_PATTERN,
} = require('./attachmentTokens');

test('substituteAttachmentTokens replaces tokens in <img src>', () => {
  const html = '<img src="{{attachment:att_a3f}}" alt="logo">';
  const out = substituteAttachmentTokens(html, (ref) =>
    ref === 'att_a3f' ? 'https://api/files/attachment/123?token=abc' : null,
  );
  assert.equal(out, '<img src="https://api/files/attachment/123?token=abc" alt="logo">');
});

test('substituteAttachmentTokens replaces tokens in url(...) css', () => {
  const css = '.bg { background-image: url("{{attachment:att_xyz}}"); }';
  const out = substituteAttachmentTokens(css, () => '/path/to/file.png');
  assert.equal(out, '.bg { background-image: url("/path/to/file.png"); }');
});

test('substituteAttachmentTokens leaves token in place when resolver returns null/undefined', () => {
  const html = '<img src="{{attachment:att_unknown}}">';
  const out = substituteAttachmentTokens(html, () => null);
  assert.equal(out, html);
});

test('substituteAttachmentTokens handles multiple tokens', () => {
  const html =
    '<div><img src="{{attachment:att_a}}"><img src="{{attachment:att_b}}"></div>';
  const out = substituteAttachmentTokens(html, (ref) => `RESOLVED_${ref}`);
  assert.equal(
    out,
    '<div><img src="RESOLVED_att_a"><img src="RESOLVED_att_b"></div>',
  );
});

test('substituteAttachmentTokens returns input unchanged when no tokens', () => {
  const html = '<div>no tokens here</div>';
  assert.equal(substituteAttachmentTokens(html, () => 'X'), html);
});

test('substituteAttachmentTokens accepts non-string input safely', () => {
  assert.equal(substituteAttachmentTokens(null, () => 'X'), null);
  assert.equal(substituteAttachmentTokens(undefined, () => 'X'), undefined);
  assert.equal(substituteAttachmentTokens(42, () => 'X'), 42);
});

test('only refs of [a-zA-Z0-9_-]+ are accepted (no injection via spaces/quotes)', () => {
  const malicious = '<img src="{{attachment:foo bar}}">';
  let called = false;
  substituteAttachmentTokens(malicious, () => {
    called = true;
    return 'X';
  });
  assert.equal(called, false, 'resolver must not be called for invalid refs');
});

test('ATTACHMENT_TOKEN_PATTERN matches valid refs only', () => {
  assert.match('{{attachment:att_abc}}', ATTACHMENT_TOKEN_PATTERN);
  assert.match('{{attachment:abc-123_X}}', new RegExp(ATTACHMENT_TOKEN_PATTERN));
  ATTACHMENT_TOKEN_PATTERN.lastIndex = 0;
  assert.doesNotMatch('{{attachment:bad ref}}', ATTACHMENT_TOKEN_PATTERN);
});

test('substituteSlideDataTokens walks theme.css, slides[].html and slides[].css', () => {
  const slideData = {
    theme: { css: '.t { background: url("{{attachment:att_t}}"); }' },
    slides: [
      { html: '<img src="{{attachment:att_h}}">', css: '.s1 { color: red; }' },
      { html: '<p>plain</p>', css: '.s2 { background: url("{{attachment:att_c}}"); }' },
    ],
  };
  const resolver = (ref) => `RES_${ref}`;
  const out = substituteSlideDataTokens(slideData, resolver);

  assert.equal(out.theme.css, '.t { background: url("RES_att_t"); }');
  assert.equal(out.slides[0].html, '<img src="RES_att_h">');
  assert.equal(out.slides[0].css, '.s1 { color: red; }');
  assert.equal(out.slides[1].html, '<p>plain</p>');
  assert.equal(out.slides[1].css, '.s2 { background: url("RES_att_c"); }');
});

test('substituteSlideDataTokens does not mutate the input', () => {
  const slideData = {
    theme: { css: '.t { background: url("{{attachment:att_t}}"); }' },
    slides: [{ html: '<img src="{{attachment:att_a}}">', css: '' }],
  };
  const original = JSON.parse(JSON.stringify(slideData));
  substituteSlideDataTokens(slideData, () => 'X');
  assert.deepEqual(slideData, original);
});

test('substituteSlideDataTokens tolerates missing/invalid input', () => {
  assert.deepEqual(substituteSlideDataTokens(null, () => 'X'), null);
  assert.deepEqual(substituteSlideDataTokens({}, () => 'X'), {});
  assert.deepEqual(
    substituteSlideDataTokens({ slides: 'not-an-array' }, () => 'X'),
    { slides: 'not-an-array' },
  );
});
