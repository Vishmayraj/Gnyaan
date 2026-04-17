/**
 * Ingestion Controller (RAG System – Data Preparation Layer)
 *
 * Flow:
 * 1. Hash check → skip duplicates
 * 2. Save document to Mongo as PROCESSING (sync, before responding)
 * 3. Respond immediately to client (no timeout)
 * 4. In background: parse → chunk → embed → insert vectors → mark ACTIVE
 */

const Document = require("../models/Document");
const { parseDocument }  = require("../services/parser");
const { generateChunks } = require("../services/chunker");
const { embedChunks }    = require("../services/embedder");
const { insertVectors }  = require("../services/vectorDB");
const fs     = require("fs").promises;
const crypto = require("crypto");

async function generateFileHash(filePath) {
    const buffer = await fs.readFile(filePath);
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

exports.uploadDocument = async (req, res) => {
    try {
        const files  = req.files;
        const userId = req.user._id.toString();

        if (!files || files.length === 0) {
            return res.status(400).json({ error: "No files uploaded" });
        }

        // ── Step 1: Save all docs to Mongo as PROCESSING (sync) ─────────────
        // Done BEFORE responding so the UI immediately sees them in the list.
        const pendingDocs = [];

        for (const file of files) {
            try {
                const fileHash = await generateFileHash(file.path);
                // const existingDoc = await Document.findOne({ uploadedBy: userId, fileHash });

                // if (existingDoc) {
                //     continue; // Disabled temporarily for testing
                // }

                const document = await Document.create({
                    uploadedBy:       userId,
                    title:            file.originalname,
                    originalFileName: file.originalname,
                    storedFileName:   file.filename,
                    filePath:         file.path,
                    fileType:         file.mimetype,
                    fileSize:         file.size,
                    status:           "PROCESSING",
                    fileHash,
                });

                pendingDocs.push({ file, document });
            } catch (err) {
                console.error("Pre-save error for:", file.originalname, err.message);
            }
        }

        // ── Step 2: Respond immediately ──────────────────────────────────────
        res.json({ success: true, message: "Upload received, processing started", docsPending: pendingDocs.length });

        // ── Step 3: Background pipeline (no setImmediate — Promise chain) ────
        Promise.resolve().then(async () => {
            for (const { file, document } of pendingDocs) {
                try {
                    const parsedChunks = await parseDocument(file.path, file.mimetype);

                    const chunks = await generateChunks(parsedChunks, {
                        userId,
                        documentId: document._id.toString(),
                        fileType:   file.mimetype,
                        docTitle:   file.originalname,
                    });

                    const embeddedChunks = await embedChunks(chunks);

                    await insertVectors(embeddedChunks);

                    document.status       = "ACTIVE";
                    document.chunkCount   = chunks.length;
                    document.lastIndexedAt = new Date();
                    await document.save();

                } catch (err) {
                    console.error("Failed for:", file?.originalname);
                    console.error("Error name:", err.name);
                    console.error("Error message:", err.message);

                    document.status = "FAILED";
                    document.processingError = err.message;
                    await document.save();
                }
            }
        });

    } catch (err) {
        console.error("INGESTION ERROR:", err);
        res.status(500).json({ error: "Failed ingestion" });
    }
};

// ── GET User Documents ─────────────────────────────────────────────────────────────
exports.getUserDocuments = async (req, res) => {
    try {
        const userId = req.user._id.toString();
        // Fetch all documents uploaded by this user, newest first
        const documents = await Document.find({ uploadedBy: userId })
            .select("-__v -fileHash") // exclude internal fields
            .sort({ createdAt: -1 })
            .lean();
            
        res.status(200).json({ success: true, documents });
    } catch (err) {
        console.error("Fetch docs error:", err);
        res.status(500).json({ error: "Failed to fetch documents" });
    }
};

// ── POST Generate Summary + TL;DR ──────────────────────────────────────────────────
const { summarizeLLM } = require("../services/llmCaller");

exports.generateSummary = async (req, res) => {
    try {
        const userId = req.user._id.toString();
        const { documentId } = req.body;

        if (!documentId) {
            return res.status(400).json({ error: "documentId is required" });
        }

        // 1. Find the document belonging to this user
        const document = await Document.findOne({ _id: documentId, uploadedBy: userId });
        if (!document) {
            return res.status(404).json({ error: "Document not found" });
        }

        // 2. If summary already exists, return cached version
        if (document.summary && document.tldr) {
            return res.status(200).json({
                success: true,
                cached: true,
                summary: document.summary,
                tldr: document.tldr,
                title: document.title,
            });
        }

        // 3. Re-parse the raw text from the stored file
        const parsedBlocks = await parseDocument(document.filePath, document.fileType);
        const fullText = parsedBlocks.map((b) => b.text).join("\n\n");

        if (!fullText || fullText.trim().length === 0) {
            return res.status(400).json({ error: "Document has no extractable text" });
        }

        // 4. Fire to Groq for summarization
        const { summary, tldr, responseTimeMs, error } = await summarizeLLM(fullText);

        if (error) {
            return res.status(500).json({ error: "LLM failed to generate summary" });
        }

        // 5. Cache into MongoDB so we never re-generate for the same doc
        document.summary = summary;
        document.tldr = tldr;
        await document.save();

        return res.status(200).json({
            success: true,
            cached: false,
            summary,
            tldr,
            title: document.title,
            responseTimeMs,
        });
    } catch (err) {
        console.error("Summary generation error:", err);
        res.status(500).json({ error: "Failed to generate summary" });
    }
};
