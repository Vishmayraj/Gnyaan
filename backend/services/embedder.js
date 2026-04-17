const { pipeline } = require("@xenova/transformers");
let embedder = null;

async function getModel() {
  if (!embedder) {
    console.log("⏳ Initializing BGE Model Pipeline...");
    
    embedder = await pipeline(
      "feature-extraction",
      "Xenova/bge-base-en-v1.5",
      {
         progress_callback: (data) => {
           if (data.status === 'download') {
             console.log(`\n⏬ Starting download of ${data.file}...`);
           } else if (data.status === 'progress') {
             process.stdout.write(`\r⏳ Downloading ${data.file}: ${Math.round(data.progress)}%  `);
           } else if (data.status === 'done') {
             console.log(`\n✅ Finished downloading ${data.file}!`);
           }
         }
      }
    );
    console.log("✅ BGE model fully loaded into RAM!");
  }
  return embedder;
}

/**
 * Embed query (IMPORTANT DIFFERENT FORMAT)
 */
async function embedQuery(query) {
  const model = await getModel();
  const output = await model("query: " + query, {
    pooling: "mean",
    normalize: true,
  });
  return Array.from(output.data);
}

/**
 * Embed chunks (passage format)
 */
async function embedChunks(chunks) {
  const model = await getModel();
  const results = [];
  for (const chunk of chunks) {
    const output = await model("passage: " + chunk.payload.text, {
      pooling: "mean",
      normalize: true,
    });
    results.push({
      id: chunk.id,
      vector: Array.from(output.data),
      payload: chunk.payload,
    });
  }
  return results;
}

module.exports = {
  embedQuery,
  embedChunks,
};
