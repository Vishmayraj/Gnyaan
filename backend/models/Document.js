const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
    {
        uploadedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        title: {
            type: String
        },

        originalFileName: {
            type: String,
            required: true
        },

        storedFileName: {
            type: String,
            required: true
        },

        filePath: {
            type: String,
            required: true
        },

        fileType: {
            type: String,
            required: true
        },

        fileSize: {
            type: Number
        },

        fileHash: {
            type: String,
            required: true
        },

        sourceType: {
            type: String,
            default: "FILE"
        },

        chunkCount: {
            type: Number,
            default: 0
        },

        embeddingModel: {
            type: String,
            default: "bge-base-en-v1.5"
        },

        status: {
            type: String,
            enum: ["PROCESSING", "ACTIVE", "FAILED", "DELETED"],
            default: "PROCESSING",
            index: true
        },

        processingError: {
            type: String
        },

        isDeleted: {
            type: Boolean,
            default: false
        },

        lastIndexedAt: {
            type: Date
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("Document", documentSchema);
