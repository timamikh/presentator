const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");

const { buildHtml } = require("./converter");

test("buildHtml rewrites local uploaded image src to file URL", () => {
  const imagePath = "/data/uploads/job-1/my image.png";
  const expectedUrl = pathToFileURL(imagePath).href;

  const html = buildHtml({
    slides: [
      {
        html: `<div><img src="${imagePath}" alt="demo"></div>`,
        css: "",
      },
    ],
  });

  assert.match(html, new RegExp(expectedUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("buildHtml rewrites local uploaded image url() references in CSS", () => {
  const imagePath = "/data/uploads/job-1/bg image.jpg";
  const expectedUrl = pathToFileURL(imagePath).href;

  const html = buildHtml({
    theme: {
      css: `.hero { background-image: url("${imagePath}"); }`,
    },
    slides: [
      {
        html: '<div class="hero">Slide</div>',
        css: `.hero::before { content: ""; background: url('${imagePath}') center/cover; }`,
      },
    ],
  });

  assert.match(html, new RegExp(expectedUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("buildHtml substitutes {{attachment:<ref>}} tokens via attachmentMap (img src)", () => {
  const localPath = "/data/library/user-1/abc_logo.png";
  const expectedUrl = pathToFileURL(localPath).href;

  const html = buildHtml(
    {
      slides: [
        {
          html: '<img src="{{attachment:att_xyz}}" alt="logo">',
          css: "",
        },
      ],
    },
    { attachmentMap: { att_xyz: { localPath, mimeType: "image/png" } } },
  );

  assert.match(html, new RegExp(expectedUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(html, /\{\{attachment:/);
});

test("buildHtml substitutes attachment tokens in url(...) css blocks", () => {
  const localPath = "/data/library/user-1/abc_bg.jpg";
  const expectedUrl = pathToFileURL(localPath).href;

  const html = buildHtml(
    {
      theme: {
        css: '.hero { background-image: url("{{attachment:att_bg}}"); }',
      },
      slides: [
        {
          html: '<div class="hero"></div>',
          css: ".x { background: url('{{attachment:att_bg}}') center/cover; }",
        },
      ],
    },
    { attachmentMap: { att_bg: { localPath, mimeType: "image/jpeg" } } },
  );

  const escapedUrl = expectedUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = html.match(new RegExp(escapedUrl, "g")) || [];
  assert.ok(matches.length >= 2, "expected at least 2 occurrences of resolved file URL");
});

test("buildHtml leaves unknown attachment tokens untouched", () => {
  const html = buildHtml(
    {
      slides: [
        { html: '<img src="{{attachment:att_unknown}}">', css: "" },
      ],
    },
    { attachmentMap: { att_other: { localPath: "/data/library/user/x.png" } } },
  );

  assert.match(html, /\{\{attachment:att_unknown\}\}/);
});

test("buildHtml works without attachmentMap (legacy path)", () => {
  const html = buildHtml({
    slides: [{ html: "<h1>Hello</h1>", css: "" }],
  });
  assert.match(html, /Hello/);
});
