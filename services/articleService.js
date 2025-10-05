// services/articleService.js
const driver = require("../db");

// Función para transformar los resultados de Neo4j a un formato más limpio
const shapeArticle = (record) => {
  const article = record.get("a").properties;
  // La consulta puede que no devuelva chunks o entidades si no existen
  const chunks = record.has("chunks")
    ? record.get("chunks").map((c) => c.properties)
    : [];
  const entities = record.has("entities")
    ? record.get("entities").map((e) => e.properties)
    : [];

  return {
    ...article,
    // Neo4j devuelve los enteros como un objeto especial, hay que convertirlos
    article_id: article.article_id.low,
    chunks,
    entities,
  };
};

const articleService = {
  // Función para obtener todos los artículos (con un límite para no saturar)
  findAll: async () => {
    const session = driver.session({ database: process.env.NEO4J_DATABASE });
    try {
      const result = await session.run(
        "MATCH (a:Article) RETURN a ORDER BY a.title LIMIT 50"
      );
      return result.records.map((record) => record.get("a").properties);
    } finally {
      await session.close();
    }
  },

  // Función para encontrar un artículo por su ID y obtener sus detalles
  findById: async (id) => {
    const session = driver.session({ database: process.env.NEO4J_DATABASE });
    try {
      // Esta consulta usa collect() para agrupar todos los chunks y entidades
      // relacionados con el artículo en dos listas.
      const result = await session.run(
        `MATCH (a:Article {article_id: $id})
                 OPTIONAL MATCH (a)-[:HAS_CHUNK]->(c:Chunk)
                 OPTIONAL MATCH (a)-[:MENTIONS]->(e:Entity)
                 RETURN a, collect(DISTINCT c) AS chunks, collect(DISTINCT e) AS entities`,
        { id: parseInt(id) } // Aseguramos que el ID sea un número
      );

      if (result.records.length === 0) {
        return null;
      }

      return shapeArticle(result.records[0]);
    } finally {
      await session.close();
    }
  },
};

module.exports = articleService;
