const express = require("express");
const cors = require("cors");
const { convertToFile } = require("./converter");

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/convert", async (req, res) => {
  const { slideData, outputPath } = req.body;

  if (!slideData || !outputPath) {
    return res.status(400).json({
      success: false,
      error: "Missing required fields: slideData and outputPath",
    });
  }

  try {
    const filePath = await convertToFile(slideData, outputPath);
    return res.json({ success: true, filePath });
  } catch (err) {
    console.error("Conversion error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Converter Service running on port ${PORT}`);
});
