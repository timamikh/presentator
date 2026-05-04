const puppeteer = require("puppeteer");
const PptxGenJS = require("pptxgenjs");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const FRAMEWORK_CSS = fs.readFileSync(
  path.join(__dirname, "slide-framework.css"),
  "utf8",
);
const TEMPLATE_HTML = fs.readFileSync(
  path.join(__dirname, "slide-template.html"),
  "utf8",
);

const SLIDE_W = 1920;
const SLIDE_H = 1080;
const PPTX_W = 13.333;
const PPTX_H = 7.5;
const LOCAL_UPLOADS_PREFIX = "/data/uploads/";
const ATTACHMENT_TOKEN_PATTERN = /\{\{attachment:([A-Za-z0-9_-]+)\}\}/g;

function toRenderableAssetPath(assetPath) {
  if (typeof assetPath !== "string" || !assetPath.startsWith(LOCAL_UPLOADS_PREFIX)) {
    return assetPath;
  }

  return pathToFileURL(assetPath).href;
}

function rewriteLocalUploadPaths(content) {
  if (typeof content !== "string" || !content.includes(LOCAL_UPLOADS_PREFIX)) {
    return content;
  }

  let rewritten = content;

  rewritten = rewritten.replace(
    /(<(?:img|source|video|audio|a|link)\b[^>]*\s(?:src|href|poster)=["'])(\/data\/uploads\/[^"']+)(["'])/gi,
    (_full, start, assetPath, end) => `${start}${toRenderableAssetPath(assetPath)}${end}`,
  );

  rewritten = rewritten.replace(
    /(<(?:img|source|video|audio|a|link)\b[^>]*\s(?:src|href|poster)=)(\/data\/uploads\/[^\s>]+)(?=[\s>])/gi,
    (_full, start, assetPath) => `${start}${toRenderableAssetPath(assetPath)}`,
  );

  rewritten = rewritten.replace(
    /url\(\s*(['"]?)(\/data\/uploads\/[^'")]+)\1\s*\)/gi,
    (_full, quote, assetPath) => `url(${quote}${toRenderableAssetPath(assetPath)}${quote})`,
  );

  return rewritten;
}

// Replaces {{attachment:<ref>}} tokens with file:// URLs derived from the
// attachmentMap built by api-service. Tokens with no matching entry are left
// untouched (a missing image is preferable to a broken/empty src in Puppeteer).
function substituteAttachmentTokens(content, attachmentMap) {
  if (typeof content !== "string" || !content.includes("{{attachment:")) {
    return content;
  }
  if (!attachmentMap || typeof attachmentMap !== "object") {
    return content;
  }

  return content.replace(ATTACHMENT_TOKEN_PATTERN, (match, ref) => {
    const entry = attachmentMap[ref];
    if (!entry || typeof entry.localPath !== "string") {
      return match;
    }
    return pathToFileURL(entry.localPath).href;
  });
}

function rewriteAll(content, attachmentMap) {
  return substituteAttachmentTokens(rewriteLocalUploadPaths(content), attachmentMap);
}

async function getBrowser() {
  return puppeteer.launch({
    executablePath:
      process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--font-render-hinting=none",
    ],
    headless: "new",
  });
}

function buildHtml(slideData, options = {}) {
  const attachmentMap = options.attachmentMap || null;
  const theme = slideData.theme || {};
  const slides = slideData.slides || [];

  let fontImports = "";
  if (Array.isArray(theme.fonts) && theme.fonts.length > 0) {
    const families = theme.fonts
      .map((f) => "family=" + f.replace(/ /g, "+") + ":wght@400;600;700;800")
      .join("&");
    fontImports = `<link href="https://fonts.googleapis.com/css2?${families}&display=swap" rel="stylesheet">`;
  }

  const slidesHtml = slides
    .map((slide, i) => {
      const css = slide.css ? `<style>${rewriteAll(slide.css, attachmentMap)}</style>` : "";
      const html = rewriteAll(slide.html || "", attachmentMap);
      return `<div class="slide" data-slide-index="${i}">${css}${html}</div>`;
    })
    .join("\n");

  return TEMPLATE_HTML
    .replace("{{FONT_IMPORTS}}", fontImports)
    .replace("{{FRAMEWORK_CSS}}", FRAMEWORK_CSS)
    .replace("{{THEME_CSS}}", rewriteAll(theme.css || "", attachmentMap))
    .replace("{{SLIDES}}", slidesHtml);
}

async function renderPage(slideData, options = {}) {
  const html = buildHtml(slideData, options);
  const browser = await getBrowser();
  const page = await browser.newPage();

  await page.setViewport({ width: SLIDE_W, height: SLIDE_H });
  await page.setContent(html, {
    // networkidle0 can hang on slow/unreachable external fonts; DOM readiness is enough for screenshot/PDF
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });

  return { browser, page };
}

async function generatePdf(page, outputPath) {
  await page.pdf({
    path: outputPath,
    width: `${SLIDE_W}px`,
    height: `${SLIDE_H}px`,
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    preferCSSPageSize: false,
  });
  return outputPath;
}

async function generatePptx(page, outputPath) {
  const slideElements = await page.$$(".slide");
  const pres = new PptxGenJS();
  pres.defineLayout({ name: "HD", width: PPTX_W, height: PPTX_H });
  pres.layout = "HD";

  for (const el of slideElements) {
    const screenshot = await el.screenshot({
      type: "png",
      encoding: "base64",
      captureBeyondViewport: true,
    });
    const s = pres.addSlide();
    s.addImage({
      data: `image/png;base64,${screenshot}`,
      x: 0,
      y: 0,
      w: PPTX_W,
      h: PPTX_H,
    });
  }

  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  await pres.writeFile({ fileName: outputPath });
  return outputPath;
}

async function convertToFiles(slideData, outputDir, options = {}) {
  fs.mkdirSync(outputDir, { recursive: true });

  const pdfPath = path.join(outputDir, "presentation.pdf");
  const pptxPath = path.join(outputDir, "presentation.pptx");

  const { browser, page } = await renderPage(slideData, options);

  try {
    await generatePdf(page, pdfPath);
    console.log(`PDF generated: ${pdfPath}`);

    await generatePptx(page, pptxPath);
    console.log(`PPTX generated: ${pptxPath}`);

    return { pdf: pdfPath, pptx: pptxPath };
  } finally {
    await page.close();
    await browser.close();
  }
}

module.exports = { convertToFiles, buildHtml, substituteAttachmentTokens };
