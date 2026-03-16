const PptxGenJS = require("pptxgenjs");
const fs = require("fs");
const path = require("path");

const DEFAULT_FONT = "Arial";
const SLIDE_WIDTH = 10;
const SLIDE_HEIGHT = 7.5;

function applyTheme(pres, theme) {
  if (!theme) return { primaryColor: "2B579A", fontFamily: DEFAULT_FONT };
  return {
    primaryColor: (theme.primaryColor || "2B579A").replace(/^#/, ""),
    fontFamily: theme.fontFamily || DEFAULT_FONT,
  };
}

function addTitleSlide(pres, slide, theme) {
  const s = pres.addSlide();

  s.addText(slide.title || "", {
    x: 0.5,
    y: 2.0,
    w: 9.0,
    h: 1.5,
    fontSize: 36,
    bold: true,
    color: theme.primaryColor,
    fontFace: theme.fontFamily,
    align: "center",
    valign: "middle",
  });

  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: 0.5,
      y: 3.6,
      w: 9.0,
      h: 1.0,
      fontSize: 20,
      color: "888888",
      fontFace: theme.fontFamily,
      align: "center",
      valign: "top",
    });
  }

  if (slide.notes) s.addNotes(slide.notes);
  return s;
}

function addContentSlide(pres, slide, theme) {
  const s = pres.addSlide();
  const hasImage = slide.image && fs.existsSync(slide.image);
  const bodyWidth = hasImage ? 5.0 : 9.0;

  s.addText(slide.title || "", {
    x: 0.5,
    y: 0.3,
    w: 9.0,
    h: 0.8,
    fontSize: 24,
    bold: true,
    color: theme.primaryColor,
    fontFace: theme.fontFamily,
  });

  if (Array.isArray(slide.body) && slide.body.length > 0) {
    const bullets = slide.body.map((text) => ({
      text,
      options: { bullet: true, indentLevel: 0 },
    }));

    s.addText(bullets, {
      x: 0.5,
      y: 1.3,
      w: bodyWidth,
      h: 5.5,
      fontSize: 16,
      fontFace: theme.fontFamily,
      color: "333333",
      valign: "top",
      lineSpacingMultiple: 1.3,
    });
  }

  if (hasImage) {
    try {
      s.addImage({
        path: slide.image,
        x: 5.8,
        y: 1.3,
        w: 3.7,
        h: 5.0,
        sizing: { type: "contain", w: 3.7, h: 5.0 },
      });
    } catch (err) {
      console.warn(`Warning: failed to add image ${slide.image}: ${err.message}`);
    }
  } else if (slide.image) {
    console.warn(`Warning: image not found at ${slide.image}, skipping`);
  }

  if (slide.notes) s.addNotes(slide.notes);
  return s;
}

function addSectionSlide(pres, slide, theme) {
  const s = pres.addSlide();

  s.addText(slide.title || "", {
    x: 0.5,
    y: 2.5,
    w: 9.0,
    h: 2.0,
    fontSize: 32,
    bold: true,
    color: theme.primaryColor,
    fontFace: theme.fontFamily,
    align: "center",
    valign: "middle",
  });

  if (slide.notes) s.addNotes(slide.notes);
  return s;
}

function addImageSlide(pres, slide, theme) {
  const s = pres.addSlide();

  s.addText(slide.title || "", {
    x: 0.5,
    y: 0.3,
    w: 9.0,
    h: 0.8,
    fontSize: 24,
    bold: true,
    color: theme.primaryColor,
    fontFace: theme.fontFamily,
  });

  if (slide.image && fs.existsSync(slide.image)) {
    try {
      s.addImage({
        path: slide.image,
        x: 1.0,
        y: 1.4,
        w: 8.0,
        h: 5.5,
        sizing: { type: "contain", w: 8.0, h: 5.5 },
      });
    } catch (err) {
      console.warn(`Warning: failed to add image ${slide.image}: ${err.message}`);
    }
  } else if (slide.image) {
    console.warn(`Warning: image not found at ${slide.image}, skipping`);
  }

  if (slide.notes) s.addNotes(slide.notes);
  return s;
}

function addTwoColumnSlide(pres, slide, theme) {
  const s = pres.addSlide();

  s.addText(slide.title || "", {
    x: 0.5,
    y: 0.3,
    w: 9.0,
    h: 0.8,
    fontSize: 24,
    bold: true,
    color: theme.primaryColor,
    fontFace: theme.fontFamily,
  });

  if (Array.isArray(slide.leftContent) && slide.leftContent.length > 0) {
    const bullets = slide.leftContent.map((text) => ({
      text,
      options: { bullet: true, indentLevel: 0 },
    }));

    s.addText(bullets, {
      x: 0.5,
      y: 1.3,
      w: 4.2,
      h: 5.5,
      fontSize: 15,
      fontFace: theme.fontFamily,
      color: "333333",
      valign: "top",
      lineSpacingMultiple: 1.3,
    });
  }

  if (Array.isArray(slide.rightContent) && slide.rightContent.length > 0) {
    const bullets = slide.rightContent.map((text) => ({
      text,
      options: { bullet: true, indentLevel: 0 },
    }));

    s.addText(bullets, {
      x: 5.3,
      y: 1.3,
      w: 4.2,
      h: 5.5,
      fontSize: 15,
      fontFace: theme.fontFamily,
      color: "333333",
      valign: "top",
      lineSpacingMultiple: 1.3,
    });
  }

  if (slide.notes) s.addNotes(slide.notes);
  return s;
}

function addDefaultSlide(pres, slide, theme) {
  const s = pres.addSlide();

  s.addText(slide.title || "", {
    x: 0.5,
    y: 0.3,
    w: 9.0,
    h: 0.8,
    fontSize: 24,
    bold: true,
    color: theme.primaryColor,
    fontFace: theme.fontFamily,
  });

  const bodyText = Array.isArray(slide.body) ? slide.body.join("\n") : slide.body || "";
  if (bodyText) {
    s.addText(bodyText, {
      x: 0.5,
      y: 1.3,
      w: 9.0,
      h: 5.5,
      fontSize: 16,
      fontFace: theme.fontFamily,
      color: "333333",
      valign: "top",
      lineSpacingMultiple: 1.3,
    });
  }

  if (slide.notes) s.addNotes(slide.notes);
  return s;
}

const LAYOUT_HANDLERS = {
  title: addTitleSlide,
  content: addContentSlide,
  section: addSectionSlide,
  image: addImageSlide,
  two_column: addTwoColumnSlide,
};

async function convertToFile(slideData, outputPath) {
  const pres = new PptxGenJS();

  pres.layout = "LAYOUT_WIDE";
  pres.defineLayout({ name: "CUSTOM", width: SLIDE_WIDTH, height: SLIDE_HEIGHT });
  pres.layout = "CUSTOM";

  const theme = applyTheme(pres, slideData.theme);

  const slides = slideData.slides || [];
  for (const slide of slides) {
    const handler = LAYOUT_HANDLERS[slide.layout] || addDefaultSlide;
    handler(pres, slide, theme);
  }

  const outDir = path.dirname(outputPath);
  fs.mkdirSync(outDir, { recursive: true });

  await pres.writeFile({ fileName: outputPath });
  return outputPath;
}

module.exports = { convertToFile };
