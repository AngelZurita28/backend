// services/ragService.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
const driver = require("../db");

// --- Configuración de Clientes ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const generationModel = genAI.getGenerativeModel({
  model: "gemini-flash-latest",
});
const embeddingModel = genAI.getGenerativeModel({
  model: "text-embedding-004",
});

// Función para convertir texto en un vector
async function embedText(text) {
  const result = await embeddingModel.embedContent(text);
  return result.embedding.values;
}

// 1. MODIFICACIÓN: `semanticSearch` ahora puede devolver múltiples resultados
// y también obtiene el título y el link del artículo directamente.
async function semanticSearch(queryText, limit = 1) {
  const session = driver.session({ database: process.env.NEO4J_DATABASE });
  try {
    const queryEmbedding = await embedText(queryText);
    const cypherQuery = `
      CALL db.index.vector.queryNodes('chunk_embeddings', $limit, $embedding) 
      YIELD node AS chunk, score
      MATCH (chunk)<-[:HAS_CHUNK]-(article:Article)
      RETURN chunk.text AS text, article.title AS title, article.link AS link, score
      ORDER BY score DESC
    `;
    const result = await session.run(cypherQuery, {
      limit,
      embedding: queryEmbedding,
    });
    if (result.records.length === 0) {
      return [];
    }
    return result.records.map((record) => record.toObject());
  } finally {
    await session.close();
  }
}

async function getFunFact() {
  // 1. Ya no nos conectamos a Neo4j.
  // 2. Creamos un prompt directo para que Gemini sea creativo.
  const prompt = `
    Genera un dato curioso, sorprendente y breve (máximo 30 palabras) sobre biología espacial o la vida en el espacio.
    La respuesta debe empezar obligatoriamente con "Sabías que...".
    Sé creativo y asegúrate de que sea interesante para un público general.
  `;

  try {
    // 3. Hacemos la llamada a Gemini con el nuevo prompt
    const result = await generationModel.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    console.error("Error al generar Fun Fact:", error);
    // Mantenemos un dato por defecto en caso de que la API falle
    return "Sabías que... el traje espacial de un astronauta pesa alrededor de 130 kg en la Tierra, pero nada en el espacio.";
  }
}

// Función para generar la respuesta final con Gemini (sin cambios)
async function generateResponse(question, context, source) {
  const prompt = `
Tu tarea es analizar artículos científicos sobre biociencia espacial y generar respuestas en formato Markdown, claras y fáciles de entender para personas interesadas en el tema pero sin formación técnica.

A partir de la información del artículo proporcionado, sigue cuidadosamente las siguientes instrucciones para estructurar tu respuesta:

### Instrucciones

1. **Empieza directamente con la respuesta a la pregunta del usuario**. Sé claro y preciso. No incluyas frases como "Como astrobiólogo asistente..." ni ninguna presentación de tu rol.
2. **Haz la respuesta breve por defecto.** Evita extenderte innecesariamente. Si el usuario pide detalles específicos o el contexto requiere explicación adicional para una respuesta precisa, entonces puedes extenderte más.
3. **Desarrolla una explicación adicional solo si es necesario**, basada exclusivamente en el contenido del artículo. Utiliza:
   - Subtítulos de nivel 3 con \`###\`
   - Listas con viñetas usando \`*\`
   - Negritas con \`**\`
4. **Separa los párrafos y secciones utilizando saltos de línea reales (presiona Enter dos veces).** No escribas el texto "\\n" ni uses "<br>" ni "---". Solo inserta un salto de línea doble real entre bloques de texto.
5. Si no puedes responder porque el contexto no contiene la información necesaria o es irrelevante, responde exactamente con:
   > La información solicitada no se encuentra disponible en los artículos científicos consultados.
6. Al final, si tu respuesta se basa en el contexto, incluye la fuente en este formato Markdown:
   \`Fuente: [${source.title}](${source.link})\`

### Entradas
Contexto del artículo:
---
${context}
---
Pregunta del usuario:
"${question}"

Ahora responde en formato Markdown, usando saltos de línea dobles entre párrafos, sin presentarte al inicio, y manteniendo la respuesta breve salvo que se requieran más detalles.
`;

  const result = await generationModel.generateContent(prompt);
  return result.response.text();
}

// 2. MODIFICACIÓN: La función `ask` ahora maneja el modo de búsqueda.
async function ask(question, isSearchMode = false) {
  console.log(
    `Pregunta recibida: '${question}', Modo Búsqueda: ${isSearchMode}`
  );

  const searchLimit = isSearchMode ? 5 : 1; // Buscamos 4 si es modo búsqueda, si no, solo 1.
  console.log(`1. Buscando ${searchLimit} contextos relevantes en Neo4j...`);
  const searchResults = await semanticSearch(question, searchLimit);

  if (searchResults.length === 0) {
    // Para modo búsqueda, devolvemos un objeto para ser consistentes
    if (isSearchMode) {
      return {
        answer:
          "Lo siento, no pude encontrar información relevante para tu pregunta.",
        relatedArticles: [],
      };
    }
    return "Lo siento, no pude encontrar información relevante para tu pregunta.";
  }

  // El primer resultado siempre es para la respuesta principal
  const primaryResult = searchResults[0];
  const contextChunk = primaryResult.text;
  const source = { title: primaryResult.title, link: primaryResult.link };

  console.log("2. Generando respuesta con Gemini...");
  const answer = await generateResponse(question, contextChunk, source);

  // Si no es modo búsqueda, devolvemos solo la respuesta de texto
  if (!isSearchMode) {
    return { answer, relatedArticles: [] };
  }

  // --- Lógica para las cards de artículos relacionados ---
  console.log("3. Procesando artículos relacionados...");
  const relatedArticles = [];
  const seenLinks = new Set([primaryResult.link]); // Para no repetir el artículo principal

  for (let i = 1; i < searchResults.length; i++) {
    const result = searchResults[i];
    if (!seenLinks.has(result.link)) {
      relatedArticles.push({
        title: result.title,
        summary: result.text.substring(0, 120) + "...", // Un resumen corto
        link: result.link,
      });
      seenLinks.add(result.link);
    }
    if (relatedArticles.length >= 4) {
      break; // Nos aseguramos de tener solo 3 tarjetas
    }
  }

  // Devolvemos el objeto completo con la respuesta y los artículos relacionados
  return { answer, relatedArticles };
}

module.exports = { ask, getFunFact };
