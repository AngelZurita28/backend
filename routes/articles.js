// routes/articles.js
const express = require("express");
const router = express.Router();
const articleService = require("../services/articleService");

// Ruta para GET /api/articles
router.get("/", async (req, res) => {
  try {
    const articles = await articleService.findAll();
    res.json(articles);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Ruta para GET /api/articles/:id
router.get("/:id", async (req, res) => {
  try {
    const article = await articleService.findById(req.params.id);
    if (!article) {
      return res.status(404).json({ message: "Artículo no encontrado" });
    }
    res.json(article);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
