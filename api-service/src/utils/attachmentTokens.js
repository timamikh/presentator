// Centralized token substitution for the {{attachment:<ref>}} placeholder format.
// LLM emits these tokens inside HTML/CSS; consumers (frontend preview, converter,
// API GET /jobs/:id) call substituteAttachmentTokens with their own resolver to
// produce the appropriate URL (private API URL, file:// URL, etc.).
//
// Refs are restricted to [A-Za-z0-9_-]+ to prevent injection via spaces/quotes.

const ATTACHMENT_TOKEN_PATTERN = /\{\{attachment:([A-Za-z0-9_-]+)\}\}/g;

function substituteAttachmentTokens(content, resolver) {
  if (typeof content !== 'string') return content;
  if (typeof resolver !== 'function') return content;
  if (!content.includes('{{attachment:')) return content;

  return content.replace(ATTACHMENT_TOKEN_PATTERN, (match, ref) => {
    const replacement = resolver(ref);
    if (replacement === null || replacement === undefined) {
      return match;
    }
    return String(replacement);
  });
}

// Applies token substitution to all string fields of a slideData object that
// could plausibly contain attachment refs: theme.css, slides[*].html and slides[*].css.
// Returns a new object — input is not mutated.
function substituteSlideDataTokens(slideData, resolver) {
  if (!slideData || typeof slideData !== 'object') return slideData;

  const next = { ...slideData };

  if (next.theme && typeof next.theme === 'object') {
    next.theme = { ...next.theme };
    if (typeof next.theme.css === 'string') {
      next.theme.css = substituteAttachmentTokens(next.theme.css, resolver);
    }
  }

  if (Array.isArray(next.slides)) {
    next.slides = next.slides.map((slide) => {
      if (!slide || typeof slide !== 'object') return slide;
      const nextSlide = { ...slide };
      if (typeof nextSlide.html === 'string') {
        nextSlide.html = substituteAttachmentTokens(nextSlide.html, resolver);
      }
      if (typeof nextSlide.css === 'string') {
        nextSlide.css = substituteAttachmentTokens(nextSlide.css, resolver);
      }
      return nextSlide;
    });
  }

  return next;
}

module.exports = {
  ATTACHMENT_TOKEN_PATTERN,
  substituteAttachmentTokens,
  substituteSlideDataTokens,
};
