const express = require('express');
const { uploadDocument, getUserDocuments, generateSummary } = require('../controllers/ingestionController');
const { protect } = require('../middleware/authMiddleware');
const { uploadMultiple } = require('../middleware/uploadMiddleware');

const router = express.Router();

// (Removed old basic multer config)

// @route   POST /api/upload
// @desc    Upload document and parse
// @access  Private
router.post('/ingestion', protect, uploadMultiple, uploadDocument);
router.get('/', protect, getUserDocuments);
router.post('/summary', protect, generateSummary);

module.exports = router;
