## Two repos (or monorepo with two folders)

```
project-root/
├── backend/          ← Node.js
└── mobile/           ← Flutter
```

---

## Backend structure

```
backend/
├── src/
│   ├── config/
│   │   ├── db.js              # MongoDB Atlas connection
│   │   ├── qdrant.js          # Qdrant client init
│   │   └── env.js             # zod-validated env vars
│   │
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.routes.js
│   │   │   ├── auth.controller.js
│   │   │   ├── auth.service.js    # bcrypt, JWT sign/verify
│   │   │   └── user.model.js      # Mongoose — email, hash, createdAt
│   │   │
│   │   ├── document/
│   │   │   ├── document.routes.js
│   │   │   ├── document.controller.js
│   │   │   ├── document.service.js    # orchestrates both pipelines
│   │   │   └── document.model.js      # Mongoose — userId, name, summaryId, status
│   │   │
│   │   ├── summary/
│   │   │   ├── summary.service.js     # calls Claude, parses JSON response
│   │   │   └── summary.model.js       # Mongoose — docId, tldr, concepts, glossary, insights
│   │   │
│   │   ├── ingestion/
│   │   │   ├── parser.service.js      # pdf-parse, mammoth (DOCX), raw TXT
│   │   │   ├── chunker.service.js     # sliding window, returns chunk[]
│   │   │   └── embedder.service.js    # @xenova/transformers MiniLM
│   │   │
│   │   ├── vectorstore/
│   │   │   ├── qdrant.service.js      # upsert, search, delete collection
│   │   │   └── collection.schema.js   # point structure: vector + payload
│   │   │
│   │   ├── query/
│   │   │   ├── query.routes.js
│   │   │   ├── query.controller.js
│   │   │   └── query.service.js       # embed → search → threshold → Claude
│   │   │
│   │   └── export/
│   │       ├── export.routes.js
│   │       └── export.service.js      # fetch summary → PDFKit → stream
│   │
│   ├── middleware/
│   │   ├── auth.middleware.js     # verify JWT on protected routes
│   │   ├── upload.middleware.js   # Multer config, file type guard
│   │   └── error.middleware.js    # global error handler
│   │
│   └── app.js                    # Express setup, route registration
│
├── .env
└── package.json
```

---

## Flutter structure

```
mobile/lib/
├── main.dart
├── app.dart                         # router + theme

├── core/
│   ├── api/
│   │   ├── api_client.dart          # Dio instance, base URL, JWT interceptor
│   │   └── api_endpoints.dart       # all route strings as constants
│   ├── storage/
│   │   └── secure_storage.dart      # flutter_secure_storage — JWT token
│   └── errors/
│       └── failures.dart

├── features/
│   ├── auth/
│   │   ├── data/
│   │   │   └── auth_repository.dart     # POST /auth/login, /register
│   │   └── presentation/
│   │       ├── providers/auth_provider.dart
│   │       └── screens/login_screen.dart
│   │
│   ├── document/
│   │   ├── data/
│   │   │   └── document_repository.dart # POST /upload, GET /documents
│   │   └── presentation/
│   │       ├── providers/document_provider.dart
│   │       └── screens/home_screen.dart
│   │
│   ├── summary/
│   │   ├── data/
│   │   │   └── summary_repository.dart  # GET /summary/:docId
│   │   └── presentation/
│   │       ├── providers/summary_provider.dart
│   │       └── screens/summary_screen.dart
│   │
│   ├── chat/
│   │   ├── data/
│   │   │   └── chat_repository.dart     # POST /query
│   │   └── presentation/
│   │       ├── providers/chat_provider.dart
│   │       └── screens/chat_screen.dart
│   │
│   └── export/
│       ├── data/
│       │   └── export_repository.dart   # GET /export/:docId → save PDF
│       └── presentation/
│           └── providers/export_provider.dart
```

---

## API contract (what Flutter calls)

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | ✗ | Create user |
| POST | `/auth/login` | ✗ | Returns JWT |
| POST | `/documents/upload` | ✓ | Upload file, triggers both pipelines |
| GET | `/documents` | ✓ | List user's documents |
| GET | `/summary/:docId` | ✓ | Fetch stored summary |
| POST | `/query` | ✓ | `{ docId, question }` → RAG answer |
| GET | `/export/:docId` | ✓ | Stream PDF of summary |

---

## NPM packages to install (backend)

```
express, mongoose, dotenv, zod          ← core
jsonwebtoken, bcryptjs                  ← auth
multer                                  ← file upload
pdf-parse, mammoth                      ← document parsing
@xenova/transformers                    ← MiniLM embeddings (runs in Node)
@qdrant/js-client-rest                  ← Qdrant
@anthropic-ai/sdk                       ← Claude
pdfkit                                  ← export
```