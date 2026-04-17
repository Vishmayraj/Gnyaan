const express = require('express');
const { handleChat, getChatHistory } = require('../controllers/chatController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Fetch chat history for the dashboard
router.get('/', protect, getChatHistory);

// Send messages securely - Session state managed automatically
router.post('/', protect, handleChat);

module.exports = router;
