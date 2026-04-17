const Chat = require("../models/Chat");
const { retrieveRelevantChunks } = require("../services/retriever");
const { callLLM } = require("../services/llmCaller");

exports.handleChat = async (req, res) => {
  try {
    const { query } = req.body;
    // We already know who the user is from the protect middleware mapping
    const userId = req.user._id.toString();

    // 1. Validate input
    if (!query) {
      return res.status(400).json({
        error: "query is required required",
      });
    }

    const trimmedQuery = query.trim();

    if (trimmedQuery.length === 0) {
      return res.status(400).json({ error: "Empty query not allowed" });
    }

    if (trimmedQuery.length > 1000) {
      return res.status(400).json({ error: "Query too long" });
    }

    // 2. Auto-initialize single long-running session for this user if it doesn't exist yet
    let existingSession = await Chat.findOne({ userId }).lean();

    if (!existingSession) {
      await Chat.create({
        userId,
        sessionId: userId, // Reused strictly as a 1:1 user mapping
        meta: {
          ip: req.ip || "",
          userAgent: req.headers["user-agent"] || "",
        },
      });
    }

    // 3. Save user message + get recent history dynamically in ONE call
    const sessionDoc = await Chat.findOneAndUpdate(
      { userId },
      {
        $push: {
          messages: {
            $each: [
              {
                role: "user",
                text: trimmedQuery,
                timestamp: new Date(),
              },
            ],
            $slice: -200, // Keep rolling history perfectly fast
          },
        },
        $inc: {
          messageCount: 1,
          userMessageCount: 1,
        },
        $set: {
          lastMessage: trimmedQuery.slice(0, 100),
          lastMessageAt: new Date(),
          lastActiveAt: new Date(),
        },
      },
      {
        returnDocument: "after",
        projection: { messages: { $slice: -6 } },
      }
    ).lean();

    // strip off the very last message we just blindly pushed so LLM doesn't see duplicate current
    const history =
      sessionDoc?.messages?.slice(0, -1).map((m) => ({
        role: m.role,
        text: m.text,
      })) || [];

    // 4. Custom retriever - pull Qdrant vector chunks explicitly mapped to THIS user ID across all their uploaded documents!
    const { chunks, context, isEmpty } = await retrieveRelevantChunks(
      trimmedQuery,
      userId
    );

    // 5. Fire query to Groq seamlessly
    let answer, isFallback, responseTimeMs;

    if (isEmpty) {
      answer = "I don't have that information within your indexed documents. Please upload documents first.";
      isFallback = true;
      responseTimeMs = 0;
    } else {
      ({ answer, isFallback, responseTimeMs } = await callLLM({
        context,
        history,
        query: trimmedQuery,
      }));
    }

    // 6. Push LLM assistant reply directly into User's auto-managed history
    await Chat.updateOne(
      { userId },
      {
        $push: {
          messages: {
            $each: [
              {
                role: "assistant",
                text: answer,
                timestamp: new Date(),
                isFallback,
                sources: chunks.map((c) => ({
                  documentId: c.documentId,
                  score: c.score,
                })),
              },
            ],
            $slice: -200,
          },
        },
        $inc: {
          messageCount: 1,
          assistantMessageCount: 1,
        },
        $set: {
          lastMessage: answer.slice(0, 100),
          lastMessageAt: new Date(),
          lastActiveAt: new Date(),
        },
      }
    );

    // 7. Spit raw minimal response directly back to the User!
    return res.status(200).json({
      answer,
      isFallback,
      responseTimeMs,
      sources: isFallback
        ? []
        : chunks.map((c) => ({
          documentId: c.documentId,
          score: c.score
        })),
    });
  } catch (err) {
    console.error("Chat error:", err);
    return res.status(500).json({
      error: "Chat failed. Please try again.",
    });
  }
};

// ── GET User Chat History ─────────────────────────────────────────────────────────────
exports.getChatHistory = async (req, res) => {
  try {
    const userId = req.user._id.toString();
    
    const sessionDoc = await Chat.findOne({ userId })
      .select("-__v")
      .lean();
      
    if (!sessionDoc) {
      return res.status(200).json({ success: true, chat: null, messages: [] });
    }

    return res.status(200).json({ 
      success: true, 
      chat: sessionDoc, 
      messages: sessionDoc.messages 
    });
  } catch (err) {
    console.error("Fetch chat history error:", err);
    return res.status(500).json({ error: "Failed to fetch chat history" });
  }
};
