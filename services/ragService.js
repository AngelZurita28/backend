// services/ragService.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
const driver = require("../db"); // Importamos nuestra conexión a Neo4j

// --- Configuración de Clientes ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const generationModel = genAI.getGenerativeModel({
  model: "gemini-flash-lite-latest",
}); // Usamos el modelo más reciente y rápido
const embeddingModel = genAI.getGenerativeModel({
  model: "text-embedding-004",
});

// Función para convertir texto en un vector
async function embedText(text) {
  const result = await embeddingModel.embedContent(text);
  return result.embedding.values;
}

// Función para buscar en Neo4j
async function semanticSearch(queryText, limit = 1) {
  const session = driver.session({ database: process.env.NEO4J_DATABASE });
  try {
    const queryEmbedding = await embedText(queryText);

    const cypherQuery = `
            CALL db.index.vector.queryNodes('chunk_embeddings', $limit, $embedding) 
            YIELD node AS chunk, score
            RETURN chunk.text AS text, score
        `;

    const result = await session.run(cypherQuery, {
      limit,
      embedding: queryEmbedding,
    });

    if (result.records.length === 0) {
      return null;
    }
    return result.records[0].get("text");
  } finally {
    await session.close();
  }
}

// Función para obtener la fuente de un chunk
async function getSourceForChunk(chunkText) {
  const session = driver.session({ database: process.env.NEO4J_DATABASE });
  try {
    const cypherQuery = `
            MATCH (c:Chunk {text: $chunkText})<-[:HAS_CHUNK]-(a:Article)
            RETURN a.title AS title, a.link AS link
        `;
    const result = await session.run(cypherQuery, { chunkText });

    if (result.records.length === 0) {
      return null;
    }
    return result.records[0].toObject();
  } finally {
    await session.close();
  }
}

// Función para generar la respuesta final con Gemini
async function generateResponse(question, context, source) {
  const prompt = `
        Eres un asistente experto en biociencia espacial de la NASA. Tu tarea es responder a la pregunta del usuario basándote en el siguiente contexto extraído de un artículo científico.

        Contexto del artículo:
        ---
        ${context}
        ---

        Pregunta del usuario:
        "${question}"

        Instrucciones de respuesta:
        1. Responde a la pregunta de forma clara y concisa.
        2. Basa tu respuesta solo en la información del contexto proporcionado. No añadas conocimiento externo.
        3. Al final de tu respuesta, cita tu fuente de la siguiente manera:
           "Fuente: ${source.title}. Disponible en: ${source.link}"
    `;

  const result = await generationModel.generateContent(prompt);
  return result.response.text();
}

// Función principal que orquesta todo el proceso
async function ask(question) {
  console.log(`Pregunta recibida: '${question}'`);

  console.log("1. Buscando el contexto más relevante en Neo4j...");
  const contextChunk = await semanticSearch(question);

  if (!contextChunk) {
    return "Lo siento, no pude encontrar información relevante en la base de datos para responder a tu pregunta.";
  }

  console.log("2. Rastreando la fuente del artículo...");
  const source = await getSourceForChunk(contextChunk);

  if (!source) {
    return "Encontré información relevante, pero no pude rastrear el artículo de origen.";
  }

  console.log("3. Generando respuesta con Gemini...");
  const answer = await generateResponse(question, contextChunk, source);

  return answer;
}

module.exports = { ask };
