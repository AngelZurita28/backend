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

// Función para limpiar texto de encabezados y contenido no deseado
function cleanText(text) {
  if (!text) return "";

  // Lista de frases comunes que queremos eliminar
  const unwantedPhrases = [
    "An official website of the United States government",
    "Here's how you know",
    "Official websites use .gov",
    "Secure .gov websites use HTTPS",
    "A lock",
    "Skip to main content",
    "Skip to navigation",
    "Cookie policy",
    "Privacy policy",
  ];

  let cleanedText = text;

  // Eliminar frases no deseadas (case insensitive)
  unwantedPhrases.forEach((phrase) => {
    const regex = new RegExp(phrase, "gi");
    cleanedText = cleanedText.replace(regex, "");
  });

  // Eliminar múltiples espacios, saltos de línea y tabs
  cleanedText = cleanedText.replace(/\s+/g, " ");

  // Eliminar espacios al inicio y final
  cleanedText = cleanedText.trim();

  return cleanedText;
}

// Búsqueda semántica modificada para obtener múltiples resultados
async function semanticSearch(queryText, limit = 5) {
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
  const prompt = `
    Genera un dato curioso, sorprendente y breve (máximo 30 palabras) sobre biología espacial o la vida en el espacio.
    La respuesta debe empezar obligatoriamente con "Sabías que...".
    Sé creativo y asegúrate de que sea interesante para un público general.
  `;

  try {
    const result = await generationModel.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    console.error("Error al generar Fun Fact:", error);
    return "Sabías que... el traje espacial de un astronauta pesa alrededor de 130 kg en la Tierra, pero nada en el espacio.";
  }
}

// Función modificada para generar respuesta basada en múltiples fuentes
async function generateResponse(question, sources) {
  // Construir el contexto combinado con referencias numeradas
  let combinedContext = "";
  sources.forEach((source, index) => {
    combinedContext += `\n[Fuente ${index + 1}] ${source.title}\n${
      source.text
    }\n`;
  });

  // Construir la bibliografía en formato Markdown estructurado
  const bibliography = sources
    .map(
      (source, index) => `${index + 1}. **[${source.title}](${source.link})**`
    )
    .join("\n\n");

  const prompt = `
Tu tarea es analizar artículos científicos sobre biociencia espacial y generar respuestas en formato Markdown, claras y fáciles de entender para personas interesadas en el tema pero sin formación técnica.

A partir de la información de MÚLTIPLES artículos proporcionados, sigue cuidadosamente las siguientes instrucciones para estructurar tu respuesta:

### Instrucciones

1. **Empieza directamente con la respuesta a la pregunta del usuario**. Sé claro y preciso. No incluyas frases como "Como astrobiólogo asistente..." ni ninguna presentación de tu rol.

2. **Sintetiza la información de TODAS las fuentes proporcionadas** para crear una respuesta coherente y completa. Combina los datos complementarios y menciona diferentes perspectivas si existen.

3. **IMPORTANTE: Haz la respuesta BREVE y CONCISA**. Máximo 3-4 párrafos cortos. Ve directo al punto. Evita explicaciones extensas o detalles innecesarios. Solo incluye la información esencial que responda directamente a la pregunta.

4. **Usa Markdown de forma MÍNIMA**:
   - Usa subtítulos \`###\` SOLO si es absolutamente necesario para organizar información compleja
   - Usa listas con \`*\` SOLO si necesitas enumerar 3 o más puntos clave
   - Usa negritas \`**\` SOLO para 1-2 conceptos realmente importantes
   - **Prefiere párrafos cortos en lugar de listas cuando sea posible**

5. **Separa los párrafos utilizando UN SOLO salto de línea doble entre ellos.** Mantén la respuesta compacta y fácil de leer.

6. **NO incluyas referencias numeradas [1], [2], etc. dentro del texto.** La información debe fluir naturalmente.

7. Si no puedes responder porque el contexto no contiene la información necesaria o es irrelevante, responde exactamente con:
   > La información solicitada no se encuentra disponible en los artículos científicos consultados.

8. **CRÍTICO - Al final de tu respuesta, DEBES incluir EXACTAMENTE esta sección de Referencias. Copia este formato LITERALMENTE, sin modificar NADA:**

### Referencias

${bibliography}

**NO modifiques los links. NO cambies el formato [texto](url). Copia EXACTAMENTE como está arriba.**

### Contexto de los artículos:
---
${combinedContext}
---

### Pregunta del usuario:
"${question}"

RECUERDA: La sección de Referencias debe ser EXACTAMENTE como se mostró arriba, con el formato Markdown [texto](url) preservado.
`;

  const result = await generationModel.generateContent(prompt);
  let response = result.response.text();

  // GARANTÍA: Si Gemini no incluyó las referencias correctamente, las agregamos nosotros
  if (!response.includes("### Referencias") || !response.includes("](http")) {
    response += `\n\n### Referencias\n\n${bibliography}`;
  }

  return response;
}

// Función principal ask modificada
async function ask(question, isSearchMode = false) {
  console.log(
    `Pregunta recibida: '${question}', Modo Búsqueda: ${isSearchMode}`
  );

  // Siempre buscamos 5 resultados para la respuesta principal
  const searchLimit = 5;
  console.log(`1. Buscando ${searchLimit} contextos relevantes en Neo4j...`);
  const searchResults = await semanticSearch(question, searchLimit);

  if (searchResults.length === 0) {
    if (isSearchMode) {
      return {
        answer:
          "Lo siento, no pude encontrar información relevante para tu pregunta.",
        relatedArticles: [],
      };
    }
    return {
      answer:
        "Lo siento, no pude encontrar información relevante para tu pregunta.",
      relatedArticles: [],
    };
  }

  // Preparar las fuentes para generar la respuesta
  const sources = searchResults.map((result) => ({
    text: result.text,
    title: result.title,
    link: result.link,
  }));

  console.log(
    `2. Generando respuesta basada en ${sources.length} fuentes con Gemini...`
  );
  const answer = await generateResponse(question, sources);

  // Si no es modo búsqueda, solo devolvemos la respuesta
  if (!isSearchMode) {
    return { answer, relatedArticles: [] };
  }

  // --- Lógica para las cards de artículos relacionados en modo búsqueda ---
  console.log("3. Buscando artículos relacionados adicionales...");

  // Buscar más resultados para las tarjetas relacionadas (más allá de los 5 principales)
  const extendedResults = await semanticSearch(question, 10);
  const relatedArticles = [];
  const usedLinks = new Set(sources.map((s) => s.link)); // Links ya usados en la respuesta

  for (const result of extendedResults) {
    if (!usedLinks.has(result.link)) {
      // Limpiar el texto antes de crear el summary
      const cleanedText = cleanText(result.text);
      const summary =
        cleanedText.length > 120
          ? cleanedText.substring(0, 120) + "..."
          : cleanedText;

      relatedArticles.push({
        title: result.title,
        summary: summary,
        link: result.link,
      });
      usedLinks.add(result.link);
    }
    if (relatedArticles.length >= 4) {
      break;
    }
  }

  return { answer, relatedArticles };
}

module.exports = { ask, getFunFact };
