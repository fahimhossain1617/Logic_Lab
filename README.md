# 🚀 Logic Lab (লজিক ল্যাব)

**Logic Lab** is an interactive, visual data structures, algorithms, and programming logic learning studio. It combines real-time 3D analogy animations, line-by-line bilingual (বাংলা / English) step explanations, deterministic code tracing, and AI-powered visual analysis powered by Google Gemini.

---

## ✨ Features

- **Line-by-Line Code Visualizer**: Step through loops, variable assignments, memory swaps, conditions, and function calls.
- **Bilingual Explanations**: Rich Bengali (বাংলা) and English line-by-line breakdowns explaining *what* happened and *why*.
- **Specialized Analogy Engines**:
  - Swap Buckets (ভেরিয়েবল অদল-বদল)
  - Sort Blocks (বাবল সর্ট ও অ্যারে তুলনা)
  - Pointer Arrows (টু-পয়েন্টার ও বাইনারি সার্চ)
  - Stack Plates & Queue Line (স্ট্যাক ও কিউ)
  - Recursion Tower & Linked List Train
  - Generic 3D Memory Inspector
- **Curated 13 DSA Problem Library**: Beginner to advanced problems with both correct and faulty code to demonstrate bug hunting.
- **Deterministic Sandbox & Gemini AI Hybrid Tracer**: Runs real execution deterministically with safety bounds and calls Gemini API for complex deep logic synthesis.
- **Firebase Auth & Cloud Sync**: Sign in with Google to sync saved snippets, problem progress, streaks, and share custom code runs via public shareable links.
- **Zero-Deprecation Vercel Serverless Ready**: Full SPA frontend + Serverless `/api/*` Express routes configured in `vercel.json`.

---

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, Monaco Editor, Framer Motion, Lucide Icons, Zustand
- **Backend**: Node.js, Express, tsx, `@google/genai` (Gemini API)
- **Database & Auth**: Google Cloud Firestore, Firebase Authentication
- **Deployment**: Vercel (SPA + Serverless Functions)

---

## 📋 Environment Variables

Copy `.env.example` to `.env` or configure these in your deployment platform (e.g. Vercel):

```bash
# Gemini AI API Key (required for AI-powered tracing)
GEMINI_API_KEY=""

# Firebase Client Configuration (required for Google Auth & Cloud Sync)
VITE_FIREBASE_API_KEY=""
VITE_FIREBASE_AUTH_DOMAIN=""
VITE_FIREBASE_PROJECT_ID=""
VITE_FIREBASE_STORAGE_BUCKET=""
VITE_FIREBASE_MESSAGING_SENDER_ID=""
VITE_FIREBASE_APP_ID=""
VITE_FIREBASE_FIRESTORE_DATABASE_ID="(default)"
```

---

## 💻 Local Development

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   Create a `.env` file with your `GEMINI_API_KEY` and Firebase credentials.

3. **Start the full-stack development server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

4. **Run Typecheck & Tests**:
   ```bash
   npm run lint
   npm test
   ```

5. **Build for Production**:
   ```bash
   npm run build
   ```

---

## 🌐 Deploy to Vercel

1. Push your repository to GitHub.
2. Import the repository in [Vercel](https://vercel.com).
3. Under **Project Settings > Environment Variables**, add:
   - `GEMINI_API_KEY`
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
   - `VITE_FIREBASE_FIRESTORE_DATABASE_ID` (set to `(default)` or your database ID)
4. Deploy! Vercel automatically runs `npm run build` and serves static files from `dist` and API routes from `api/index.ts`.

---

## 🔒 Security & Firestore Rules

Firestore security rules are defined in `firestore.rules`.
To deploy rules to your Firebase project:
```bash
firebase deploy --only firestore:rules
```
Rules enforce strict owner validation, email verification checks, and sanitize input boundaries.
