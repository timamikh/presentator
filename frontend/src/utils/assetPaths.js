function toPreviewAssetPath(assetPath, token = "") {
  if (typeof assetPath !== "string") return assetPath;

  const match = assetPath.match(/^\/data\/uploads\/([0-9a-fA-F-]+)\/(.+)$/);
  if (!match) return assetPath;

  const [, jobId, relativePath] = match;
  const encodedRelativePath = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const query = token ? `?token=${encodeURIComponent(token)}` : "";

  return `/api/jobs/uploads/${jobId}/${encodedRelativePath}${query}`;
}

function rewriteUploadAssetPaths(content, token = "") {
  if (typeof content !== "string" || !content.includes("/data/uploads/")) {
    return content;
  }

  let rewritten = content;

  rewritten = rewritten.replace(
    /(<(?:img|source|video|audio|a|link)\b[^>]*\s(?:src|href|poster)=["'])(\/data\/uploads\/[^"']+)(["'])/gi,
    (_full, start, assetPath, end) => `${start}${toPreviewAssetPath(assetPath, token)}${end}`,
  );

  rewritten = rewritten.replace(
    /(<(?:img|source|video|audio|a|link)\b[^>]*\s(?:src|href|poster)=)(\/data\/uploads\/[^\s>]+)(?=[\s>])/gi,
    (_full, start, assetPath) => `${start}${toPreviewAssetPath(assetPath, token)}`,
  );

  rewritten = rewritten.replace(
    /url\(\s*(['"]?)(\/data\/uploads\/[^'")]+)\1\s*\)/gi,
    (_full, quote, assetPath) => `url(${quote}${toPreviewAssetPath(assetPath, token)}${quote})`,
  );

  return rewritten;
}

const ATTACHMENT_TOKEN_PATTERN = /\{\{attachment:([A-Za-z0-9_-]+)\}\}/g;

// Replaces {{attachment:<ref>}} placeholders with the private API URL
// `/api/files/attachment/<id>?token=<jwt>`. The api-service already does this
// for slide_data inside GET /jobs/:id, but this helper is kept on the frontend
// as a defense-in-depth (e.g. for editor previews of unsaved slides) and for
// future flows that bypass the api-service substitution.
function rewriteAttachmentTokens(content, refToId, token = "") {
  if (typeof content !== "string" || !content.includes("{{attachment:")) {
    return content;
  }
  if (!refToId) return content;

  const lookup =
    typeof refToId.get === "function"
      ? (ref) => refToId.get(ref)
      : (ref) => refToId[ref];

  return content.replace(ATTACHMENT_TOKEN_PATTERN, (match, ref) => {
    const id = lookup(ref);
    if (!id) return match;
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";
    return `/api/files/attachment/${id}${tokenParam}`;
  });
}

export {
  toPreviewAssetPath,
  rewriteUploadAssetPaths,
  rewriteAttachmentTokens,
  ATTACHMENT_TOKEN_PATTERN,
};
