# Gnyaan (ज्ञान) — Advanced RAG Knowledge Discovery Engine

*A comprehensive, end-to-end framework abstracting the complexities of Retrieval-Augmented Generation (RAG) through robust mobile UX and resilient server-side pipelines.*

---

## 🏛 Systems Architecture Overview

Through five decades of software engineering, one immutable truth holds: systems must be aggressively decoupled, fault-tolerant, and designed for horizontal observability. Gnyaan bridges a highly-reactive Glassmorphic Flutter client with a highly tuned Node.js ingestion and similarity-search pipeline. 

We circumvent the fallacies of distributed systems through rigorous boundary enforcement and localized retries, utilizing **Qdrant** for dense vector retrieval and **Groq (Llama 3.3)** for extreme sub-second inference.

### High-Level Topology

```mermaid
graph TD
    %% Mobile Client
    subgraph Mobile Interface [Flutter Client]
        UI[Glassmorphic UI]
        State[Riverpod / Providers]
        Net[Dio ApiClient]
        
        UI <--> State
        State <--> Net
    end
    
    %% API Gateway
    subgraph Gateway [Node.js Express Server]
        R[(Routes)]
        M[Upload / Auth Middleware]
        C{Controllers}
        
        R --> M
        M --> C
    end
    
    %% Data Persistence Layer
    subgraph Primary Store [MongoDB]
        Auth[(Users)]
        DocMeta[(Documents Meta)]
        Sum[(Summaries/Insights)]
    end
    
    %% AI Pipeline
    subgraph Inference & Vector Compute
        Chunk[Langchain Chunking / Sliding Window]
        Embed[@xenova/transformers 'Xenova/bge-small-en-v1.5']
        Q[(Qdrant VectorDB)]
        LLM[Groq API - llama-3.3-70b]
    end

    %% Bindings
    Net <==>|REST / JSON| R
    C --> Auth
    C --> DocMeta
    C --> Sum
    C --> Chunk
    Chunk --> Embed
    Embed --> Q
    C --> LLM
    Q -.->|Cosine Similarity Search| LLM
```

---

## 📱 The Frontend: Mobile Presentation Layer (Flutter)

The client implements extreme defensive programming against network latency while providing a premium, ultra-modern "Desert Gold" glassmorphic UI.

* **Routing & State**: Utilizing Riverpod/Provider semantics mapping strictly to our backend domains (`Auth`, `Documents`, `Chat`, `Summary`). Navigation is handled uniformly via structured routing.
* **Network Interceptors**: A Singleton `ApiClient` (wrapping `Dio`) operates a unified interceptor pipeline appending JWTs to outbound requests asynchronously from `SharedPreferences`.
* **Layout Mathematics**: UI heavily utilizes `Expanded`, `Flex`, and `Wrap` topologies to guarantee $O(1)$ layout scaling across device dimensions, mitigating the classic Flutter `RenderFlex` constraint violations.
* **Micro-interactions**: Synchronous `SnackBar` pipelines provide immediate, perceived zero-latency physical feedback to user verbs (Copy, Share, Regenerate).

---

## ⚙️ The Backend: RAG Ingestion & Compute Layer (Node.js)

The Node layer is where extreme rigor applies. Large document ingestion fundamentally risks V8 thread starvation.

### 1. Ingestion & Embedding Pipeline (`controllers/ingestionController.js`)
When a user uploads a PDF/DOCX:
1. **Extraction**: `pdf-parse` / `mammoth` rip byte-streams into raw V8 string allocations.
2. **Deterministic Chunking**: Text is heuristically sliced utilizing a sliding-window overlap algorithm to guarantee contextual overlap between adjacent semantic boundaries, averting boundary loss.
3. **Local Embedding Calculation**: Embeddings are calculated *in-node* via `@xenova/transformers`. By binding Transformers to the local thread pool rather than an external API, we dramatically reduce network jitter and preserve bandwidth. The architecture demands `768-dimensional` float precision vectors.
4. **Vector Upsert Safety**: Insertions to Qdrant are heavily guarded. `services/vectorDB.js` executes batch unspooled promises (chunks of 20) with exponential backoff on failure (`await new Promise((r) => setTimeout(r, 1000 * attempt));`).

### 2. Information Retrieval & Generation (`services/llmCaller.js`)
* **Llama 3.3 Versatile (70B parameters)** runs on the Groq ASIC stack, promising tokens over 800 tokens/sec. 
* **Dynamic Client Registration**: Groq is initialized via a lazy-loaded instance (`getGroqClient()`) inside the module. This resolves edge cases in Node environments where top-level scope synchronous execution bypasses `.env` loading resolution sequences.
* **Query Flow**:
    1. Re-embed user query locally.
    2. Execute Qdrant `search()` across `documents_v3` collection strictly filtered by `userId` to guarantee tenant isolation at the vector payload level. 
    3. Truncate context heavily (enforced at ~12k char limits) to ensure we respect Groq window capacity, drastically minimizing the chance of hallucination cascades.

---

## 🛠 Setup & Deployment Specifications

To replicate the stack locally, observe the following exact topological sequence:

### 1. The Vector Store (Qdrant)
Do not install Qdrant onto the bare-metal OS. Utilize container isolation. The backend binds via REST to port 6333.
```bash
docker run -d -p 6333:6333 -p 6334:6334 \
    --name qdrant \
    -v qdrant_data:/qdrant/storage:z \
    qdrant/qdrant
```

### 2. Node API Context Initialization
Move into `/backend`. Enforce dependencies.
```bash
cd backend
npm install
```
Configure environment execution properties via `.env`:
```env
PORT=3000
# Connection parameter to MongoDB process instance
MONGO_URL=mongodb://localhost:27017/gnyaan
# JWT Cryptographic standard
JWT_SECRET=production_ready_secret_entropy
# Local Container Routing
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=
# Explicit authorization token for ASIC LLM interface
GROQ_API_KEY=gsk_xxxxxxxx...
```
Initialize the main loop:
```bash
node server.js
```

### 3. Flutter Emulation & Linkage
Mobile operates behind the Android loopback interface or physical Network NAT mapping.
* **If via Android Emulator**: In `mobile/lib/core/network/api_endpoints.dart`, set `baseUrl` to `http://10.0.2.2:3000/api`. The `10.0.2.2` construct automatically bridges to laptop localhost loopback.
* **If via Physical Device**: Establish the exact Wi-Fi IPv4 address (e.g., `192.168.x.x`). Bind `baseUrl` to `http://192.168.x.x:3000/api`.

Proceed to inject Dart payload:
```bash
cd mobile
flutter pub get
flutter run
```

---

## 🧬 Architectural Principles Sustaining This Repo
1. **Never Block The Event Loop**: Intensive embeddings are offloaded, vector uploads are chunked.
2. **Context Paranoia**: All `llmCaller` prompts undergo rigorous structural definitions enforcing the model *must never guess*. If the Cosine calculation reveals no vector distance above `0.6` threshold, we enforce deterministic fallbacks.
3. **Immutability of Data Streams**: We do not parse documents destructively. The raw binaries trace directly into semantic stores, while a high-level summary is retained monotonically on MongoDB for quick dashboard projection.

*Built for absolute throughput. Engineered to last.*