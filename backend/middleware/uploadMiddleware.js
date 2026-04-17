const multer = require("multer");
const path = require("path");
const fs = require("fs");

// ================================
// CONFIG
// ================================
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv"
];

// ================================
// STORAGE CONFIG
// ================================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      // Safely fall back to user._id 
      const folderId = req.user._id.toString(); 

      const uploadPath = path.join("uploads", folderId);

      // create folder if not exists
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }

      cb(null, uploadPath);
    } catch (err) {
      cb(err, null);
    }
  },

  filename: function (req, file, cb) {
    const uniqueName =
      Date.now() + "-" + Math.round(Math.random() * 1e9);

    const ext = path.extname(file.originalname);

    cb(null, `${uniqueName}${ext}`);
  }
});

// ================================
// FILE FILTER
// ================================
function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(
      new Error("Invalid file type. Only PDF, DOC, DOCX, TXT, XLS, CSV allowed."),
      false
    );
  }
  cb(null, true);
}

// ================================
// MULTER INSTANCE
// ================================
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter
});

// ================================
// EVIDENCE STORAGE CONFIG
// (no auth required — open upload for evidence files)
// Accepts: images, videos, PDFs
// ================================
const EVIDENCE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/mpeg",
  "video/quicktime",
  "video/webm",
  "application/pdf",
];

const evidenceStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join("uploads", "evidence");
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueName}${ext}`);
  },
});

function evidenceFileFilter(req, file, cb) {
  if (!EVIDENCE_MIME_TYPES.includes(file.mimetype)) {
    return cb(
      new Error("Invalid file type. Only images, videos, and PDFs are allowed for evidence."),
      false
    );
  }
  cb(null, true);
}

const evidenceUpload = multer({
  storage: evidenceStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB for video files
  fileFilter: evidenceFileFilter,
});

// ================================
// EXPORT MIDDLEWARE
// ================================
module.exports = {
  uploadSingle:   upload.single("file"),
  uploadMultiple: upload.array("files", 10),
  uploadEvidence: evidenceUpload.array("evidence", 5), // up to 5 evidence files
}; 
