// routes/rag.js
const express = require("express");
const router = express.Router();
const ragService = require("../services/ragService");

// Definimos la ruta POST /api/rag/ask
router.post("/ask", async (req, res) => {
  // Obtenemos la pregunta del cuerpo (body) de la petición JSON
  const { question } = req.body;

  if (!question) {
    return res.status(400).json({
      message: "La pregunta es requerida en el cuerpo de la petición.",
    });
  }

  try {
    const answer = await ragService.ask(question);
    res.json({ answer });
  } catch (error) {
    console.error("Error en el proceso RAG:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
