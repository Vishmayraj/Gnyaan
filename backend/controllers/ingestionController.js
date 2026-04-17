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
