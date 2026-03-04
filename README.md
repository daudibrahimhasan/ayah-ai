# Ayah آية - Quran Verse Recognition App 🎙️📖

Ayah is an offline-first, client-side Quran verse recognition app. Think of it as "Shazam for the Quran."
It listens to Quranic recitation from your device microphone and instantly matches it to the exact Surah and Ayah using a locally running, full-precision Whisper AI model.

## Features

- **Client-side Recognition**: The Whisper AI model runs locally in your browser/device using ONNX. No server needed.
- **Offline First**: Once the model is cached, it works without internet access.
- **Zero Privacy Worries**: Audio is never uploaded to the cloud.
- **Arabic Calligraphy UI**: Beautiful user interface with EB Garamond, Amiri fonts, and modern glassmorphic styling.
- **Instant Ayah Lookup**: Displays the matched Arabic verse and English translation directly on the result card.

## Tech Stack

- React 19 + TypeScript
- Vite + PWA Plugin for mobile installation
- `@huggingface/transformers` for in-browser ONNX model inference
- `tarteel-ai-onnx-whisper-base-ar-quran` (fp32) model
- Framer Motion for smooth animations

## Quick Start

```bash
npm install
npm run dev
```

> Note: The first time you run recognition, it downloads the ~145MB ONNX model and caches it locally in the browser. Subsequent uses are instant.
