const puppeteer = require("puppeteer");
const PptxGenJS = require("pptxgenjs");
const fs = require("fs");
const path = require("path");

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

let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  browserInstance = await puppeteer.launch({
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--font-render-hinting=none",
    ],
    headless: true,
  });
  return browserInstance;
}

function buildHtml(slideData) {
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
      const css = slide.css ? `<style>${slide.css}</style>` : "";
      return `<div class="slide" data-slide-index="${i}">${css}${slide.html}</div>`;
    })
    .join("\n");

  return TEMPLATE_HTML
    .replace("{{FONT_IMPORTS}}", fontImports)
    .replace("{{FRAMEWORK_CSS}}", FRAMEWORK_CSS)
    .replace("{{THEME_CSS}}", theme.css || "")
    .replace("{{SLIDES}}", slidesHtml);
}

async function renderPage(slideData) {
  const html = buildHtml(slideData);
  const browser = await getBrowser();
  const page = await browser.newPage();

  await page.setViewport({ width: SLIDE_W, height: SLIDE_H });
  await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });

  return page;
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

async function convertToFiles(slideData, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });

  const pdfPath = path.join(outputDir, "presentation.pdf");
  const pptxPath = path.join(outputDir, "presentation.pptx");

  const page = await renderPage(slideData);

  try {
    await generatePdf(page, pdfPath);
    console.log(`PDF generated: ${pdfPath}`);

    await generatePptx(page, pptxPath);
    console.log(`PPTX generated: ${pptxPath}`);

    return { pdf: pdfPath, pptx: pptxPath };
  } finally {
    await page.close();
  }
}

module.exports = { convertToFiles, buildHtml };
