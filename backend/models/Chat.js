const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  isFallback: { type: Boolean, default: false },
  sources: [{
      documentId: String,
      score: Number
  }]
}, { _id: false });

const chatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sessionId: { type: String, required: true, unique: true },
  meta: {
    ip: String,
    userAgent: String,
  },
  messages: [messageSchema],
  messageCount: { type: Number, default: 0 },
  userMessageCount: { type: Number, default: 0 },
  assistantMessageCount: { type: Number, default: 0 },
  lastMessage: String,
  lastMessageAt: Date,
  lastActiveAt: Date,
}, { timestamps: true });

module.exports = mongoose.model('Chat', chatSchema);
