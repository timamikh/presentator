const express = require("express");
const cors = require("cors");
const { convertToFiles, buildHtml } = require("./converter");

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/framework.css", (_req, res) => {
  const css = require("fs").readFileSync(
    require("path").join(__dirname, "slide-framework.css"),
    "utf8",
  );
  res.type("text/css").set("Cache-Control", "public, max-age=3600").send(css);
});

app.post("/convert", async (req, res) => {
  const { slideData, outputDir, attachmentMap } = req.body;

  if (!slideData || !outputDir) {
    return res.status(400).json({
      success: false,
      error: "Missing required fields: slideData and outputDir",
    });
  }

  try {
    const paths = await convertToFiles(slideData, outputDir, { attachmentMap });
    return res.json({ success: true, paths });
  } catch (err) {
    console.error("Conversion error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/preview-html", async (req, res) => {
  const { slideData, attachmentMap } = req.body;

  if (!slideData) {
    return res.status(400).json({ error: "Missing slideData" });
  }

  try {
    const html = buildHtml(slideData, { attachmentMap });
    return res.type("html").send(html);
  } catch (err) {
    console.error("Preview error:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Converter Service running on port ${PORT}`);
});
