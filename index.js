// index.js
const express = require("express");
const cors = require("cors");
require("dotenv").config();

// Importar nuestras rutas
const articlesRouter = require("./routes/articles");
const ragRouter = require("./routes/rag"); // <-- Importamos el nuevo router

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Rutas de la API
app.use("/api/articles", articlesRouter);
app.use("/api/rag", ragRouter); // <-- Añadimos el nuevo router a nuestra app

// Ruta de bienvenida
app.get("/", (req, res) => {
  res.send("¡API de Artículos de la NASA funcionando!");
});

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
