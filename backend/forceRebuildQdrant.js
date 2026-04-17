require("dotenv").config();
const { QdrantClient } = require("@qdrant/js-client-rest");

const client = new QdrantClient({
  url: process.env.QDRANT_URL || "http://127.0.0.1:6333",
  apiKey: process.env.QDRANT_API_KEY || "",
});

const COLLECTION_NAME = "documents_v3";

async function forceCreate() {
  try {
    console.log(`Checking if ${COLLECTION_NAME} exists...`);
    const collections = await client.getCollections();
    const exists = collections.collections.find((c) => c.name === COLLECTION_NAME);

    if (exists) {
      console.log(`${COLLECTION_NAME} exists. Deleting it...`);
      await client.deleteCollection(COLLECTION_NAME);
    }

    console.log(`Creating fresh ${COLLECTION_NAME} with dimension 768 for BGE...`);
    await client.createCollection(COLLECTION_NAME, {
      vectors: {
        size: 768, 
        distance: "Cosine",
      },
    });

    console.log(`Creating payload index for userId...`);
    await client.createPayloadIndex(COLLECTION_NAME, {
      field_name: "userId",
      field_schema: "keyword",
    });

    console.log(`✅ Collection ${COLLECTION_NAME} forcefully built and ready for BGE chunks!`);
  } catch (err) {
    console.error(`❌ Force create failed:`, err);
  }
}

forceCreate();
