const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const crypto = require("crypto");
const { v5: uuidv5 } = require("uuid");
const NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 2000,   // ~500 tokens
    chunkOverlap: 400, // ~100 tokens overlap preventing info cutting
    separators: ["\n\n", "\n", ". ", " ", ""],
});

/**
 * Generate deterministic content hash
 */
function generateContentHash(documentId, text) {
    return crypto
        .createHash("sha256")
        .update(`${documentId}_${text}`)
        .digest("hex")
        .slice(0, 16);
}

/**
 * Main Chunk Generator
 * @param {Array} parsedBlocks - output from parser
 * @param {Object} options
 */
async function generateChunks(parsedBlocks, options = {}) {
    const {
        documentId,
        userId,
        fileType = "pdf",
        docTitle = "Untitled Document",
    } = options;

    if (!documentId) {
        throw new Error("documentId is required");
    }

    const finalChunks = [];
    let globalChunkIndex = 0;

    for (const block of parsedBlocks) {
        const { text, metadata } = block;

        if (!text || text.trim().length === 0) continue;

        const splitChunks = await splitter.splitText(text);

        for (const chunkText of splitChunks) {
            const trimmed = chunkText.trim();

            if (trimmed.length < 100) continue;

            const contentHash = generateContentHash(documentId, trimmed);

            // Removed companyId to keep metadata simple for this project
            const vectorId = uuidv5(`${documentId}_${contentHash}`, NAMESPACE);

            finalChunks.push({
                id: vectorId,
                payload: {
                    documentId,
                    userId,
                    chunkId: `${documentId}_chunk_${globalChunkIndex}`,
                    chunkIndex: globalChunkIndex,
                    contentHash,
                    text: trimmed,
                    source: metadata?.source || "",
                    contentType: metadata?.contentType || "text",
                    length: trimmed.length,
                    tokenCount: Math.ceil(trimmed.length / 4),
                    fileType,
                    docTitle,
                    createdAt: new Date().toISOString(),
                },
            });

            globalChunkIndex++;
        }
    }

    return finalChunks;
}

module.exports = { generateChunks };
