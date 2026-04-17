const { embedQuery } = require("./embedder");
const { searchVectors } = require("./vectorDB");

async function retrieveRelevantChunks(query, userId) {
  try {
    // 1. Embed user query using xenova
    const queryEmbedding = await embedQuery(query);

    // 2. Search Qdrant globally for this specific userId across all documents
    const rawResults = await searchVectors(queryEmbedding, userId, null, 5); // Fetch top 5 initially

    if (!rawResults || rawResults.length === 0) {
      return { chunks: [], context: "", isEmpty: true };
    }

    // 3. Manual Re-ranking and Top-K filter to prevent context stuffing
    const searchResults = rawResults
      .sort((a, b) => b.score - a.score)
      .slice(0, 3); // Restrict to top 3 chunks

    // 4. Format chunks and prepare context
    let contextText = "";
    const chunks = searchResults.map(result => {
      const payload = result.payload || {};
      
      // Stitch the raw text together for the LLM context envelope
      if (payload.text) {
        contextText += `[Document ID: ${payload.documentId}]\n${payload.text}\n\n`;
      }
      
      return {
        documentId: payload.documentId,
        score: result.score,
      };
    });

    return {
      chunks,
      context: contextText.trim(),
      isEmpty: chunks.length === 0
    };
  } catch (error) {
    console.error("Retriever error:", error);
    // Graceful fail
    return { chunks: [], context: "", isEmpty: true };
  }
}

module.exports = { retrieveRelevantChunks };
