const { QdrantClient } = require("@qdrant/js-client-rest");

const client = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const COLLECTION_NAME = "documents_v3";
const BATCH_SIZE = 20;

// ─────────────────────────────────────────
// INIT VECTOR DB
// ─────────────────────────────────────────
async function initVectorDB() {
  try {
    const collections = await client.getCollections();

    const exists = collections.collections.find(
      (c) => c.name === COLLECTION_NAME
    );

    if (!exists) {
      await client.createCollection(COLLECTION_NAME, {
        vectors: {
          size: 768, // BGE vector size
          distance: "Cosine",
        },
      });

      await client.createPayloadIndex(COLLECTION_NAME, {
        field_name: "userId",
        field_schema: "keyword",
      });

      await client.createPayloadIndex(COLLECTION_NAME, {
        field_name: "documentId",
        field_schema: "keyword",
      });

      // console.log("Collection created:", COLLECTION_NAME);
    } else {
      // console.log("Collection already exists");
    }
  } catch (err) {
    console.error(" Qdrant init failed:", err);
    throw err;
  }
}

// ─────────────────────────────────────────
// CHECK IF DOCUMENT ALREADY INDEXED
// ─────────────────────────────────────────
async function isDocumentAlreadyIndexed(documentId, userId) {
  try {
    const result = await client.scroll(COLLECTION_NAME, {
      filter: {
        must: [
          { key: "documentId", match: { value: documentId } },
          { key: "userId", match: { value: userId } },
        ],
      },
      limit: 1,
    });

    return result.points.length > 0;
  } catch (err) {
    console.error("Document check failed:", err);
    throw err;
  }
}

// ─────────────────────────────────────────
// INSERT VECTORS (FAST + PARALLEL + SAFE)
// ─────────────────────────────────────────
async function insertVectors(embeddedChunks) {
  try {
    if (!embeddedChunks || embeddedChunks.length === 0) {
      // console.log("No vectors to insert");
      return;
    }

    // console.log(`Inserting ${embeddedChunks.length} vectors...`);

    const batches = [];

    for (let i = 0; i < embeddedChunks.length; i += BATCH_SIZE) {
      const batch = embeddedChunks.slice(i, i + BATCH_SIZE);

      batches.push(
        retryUpsert(batch)
      );
    }

    // ⚡ parallel execution
    await Promise.all(batches);

    // console.log(`Inserted ${embeddedChunks.length} vectors`);
  } catch (err) {
    console.error("Vector insert failed:", err);
    throw err;
  }
}

// ─────────────────────────────────────────
// RETRY LOGIC (IMPORTANT)
// ─────────────────────────────────────────
async function retryUpsert(batch, maxRetries = 3) {
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      await client.upsert(COLLECTION_NAME, {
        wait: false, // NON-BLOCKING (IMPORTANT FIX)
        points: batch.map((chunk) => ({
          id: chunk.id,
          vector: chunk.vector,
          payload: chunk.payload,
        })),
      });

      return; // success
    } catch (err) {
      attempt++;

      // console.log(`Batch failed (attempt ${attempt}/${maxRetries})`);

      if (attempt === maxRetries) {
        console.error("Final batch failure:", err);
        throw err;
      }

      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// ─────────────────────────────────────────
// SEARCH VECTORS
// ─────────────────────────────────────────
async function searchVectors(queryEmbedding, userId, documentId, topK = 5) {
  try {
    const mustFilters = [{ key: "userId", match: { value: userId } }];
    if (documentId) {
      mustFilters.push({ key: "documentId", match: { value: documentId } });
    }

    return await client.search(COLLECTION_NAME, {
      vector: queryEmbedding,
      limit: topK,
      score_threshold: 0.6, // Refined threshold for maximum context retention
      filter: {
        must: mustFilters,
      },
      with_payload: true,
    });
  } catch (err) {
    console.error("Search failed:", err);
    throw err;
  }
}

// ─────────────────────────────────────────
// DELETE VECTORS
// ─────────────────────────────────────────
async function deleteVectorsByDocument(documentId, userId) {
  try {
    await client.delete(COLLECTION_NAME, {
      filter: {
        must: [
          { key: "documentId", match: { value: documentId } },
          { key: "userId", match: { value: userId } },
        ],
      },
    });

    // console.log("Deleted document vectors:", documentId);
  } catch (err) {
    console.error("Delete failed:", err);
    throw err;
  }
}

module.exports = {
  initVectorDB,
  insertVectors,
  searchVectors,
  deleteVectorsByDocument,
  isDocumentAlreadyIndexed,
};