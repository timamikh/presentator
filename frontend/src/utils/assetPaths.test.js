import { describe, expect, it } from "vitest";
import {
  rewriteUploadAssetPaths,
  toPreviewAssetPath,
  rewriteAttachmentTokens,
} from "./assetPaths";

describe("asset path rewrite for preview", () => {
  it("converts /data/uploads path to API preview path", () => {
    const out = toPreviewAssetPath(
      "/data/uploads/123e4567-e89b-12d3-a456-426614174000/my image.png",
      "jwt-token",
    );

    expect(out).toBe(
      "/api/jobs/uploads/123e4567-e89b-12d3-a456-426614174000/my%20image.png?token=jwt-token",
    );
  });

  it("rewrites image src and css url() references", () => {
    const input = `
      <img src="/data/uploads/123e4567-e89b-12d3-a456-426614174000/photo 1.jpg" />
      <style>
        .hero { background-image: url('/data/uploads/123e4567-e89b-12d3-a456-426614174000/bg main.png'); }
      </style>
    `;

    const output = rewriteUploadAssetPaths(input, "token-1");

    expect(output).toContain(
      "/api/jobs/uploads/123e4567-e89b-12d3-a456-426614174000/photo%201.jpg?token=token-1",
    );
    expect(output).toContain(
      "/api/jobs/uploads/123e4567-e89b-12d3-a456-426614174000/bg%20main.png?token=token-1",
    );
  });
});

describe("attachment token rewrite", () => {
  it("replaces {{attachment:<ref>}} via map (object)", () => {
    const out = rewriteAttachmentTokens(
      '<img src="{{attachment:att_a}}" alt="x">',
      { att_a: "uuid-1" },
      "tok",
    );
    expect(out).toBe('<img src="/api/files/attachment/uuid-1?token=tok" alt="x">');
  });

  it("replaces {{attachment:<ref>}} via map (Map)", () => {
    const map = new Map([["att_a", "uuid-2"]]);
    const out = rewriteAttachmentTokens('<img src="{{attachment:att_a}}">', map, "tok");
    expect(out).toBe('<img src="/api/files/attachment/uuid-2?token=tok">');
  });

  it("works in url() css and leaves unknown refs untouched", () => {
    const css =
      ".a { background: url(\"{{attachment:att_a}}\"); } .b { background: url(\"{{attachment:att_unknown}}\"); }";
    const out = rewriteAttachmentTokens(css, { att_a: "uuid-1" }, "tok");
    expect(out).toContain("/api/files/attachment/uuid-1?token=tok");
    expect(out).toContain("{{attachment:att_unknown}}");
  });

  it("returns input unchanged when no tokens present", () => {
    const html = "<div>plain</div>";
    expect(rewriteAttachmentTokens(html, { x: "y" }, "tok")).toBe(html);
  });

  it("ignores invalid refs (with spaces, etc)", () => {
    const html = '<img src="{{attachment:bad ref}}">';
    expect(rewriteAttachmentTokens(html, { "bad ref": "x" }, "tok")).toBe(html);
  });
});
