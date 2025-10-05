const express = require("express");
const router = express.Router();
const { ask } = require("../services/ragService");

router.post("/ask", async (req, res) => {
  try {
    // Obtenemos 'question' y el nuevo 'isSearchMode' del cuerpo de la petición
    const { question, isSearchMode } = req.body;

    if (!question) {
      return res.status(400).json({ error: "La pregunta es obligatoria." });
    }

    // Pasamos ambos parámetros al servicio
    const result = await ask(question, isSearchMode);

    // Siempre devolvemos un objeto JSON.
    // Si no es modo búsqueda, `relatedArticles` será un array vacío.
    res.json(result);
  } catch (error) {
    console.error("Error en la ruta /ask:", error);
    res.status(500).json({ error: "Ocurrió un error en el servidor." });
  }
});

router.get("/funfact", async (req, res) => {
  try {
    const fact = await ragService.getFunFact();
    res.json({ funFact: fact });
  } catch (error) {
    console.error("Error en la ruta /funfact:", error);
    res.status(500).json({ message: "No se pudo generar un dato curioso." });
  }
});

module.exports = router;
