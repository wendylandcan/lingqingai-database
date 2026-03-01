import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import path from 'path';

const app = express();
// Port configuration moved to bottom

// Middleware
app.use(cors());
// Increase payload limit to handle base64 images
app.use(express.json({ limit: '50mb' })); 

// Initialize Gemini Client
// Use GEMINI_API_KEY by default (standard environment), fallback to API_KEY (user selected)
const rawApiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
const apiKey = rawApiKey ? rawApiKey.trim() : "";

console.log("--- API Key Configuration Check ---");
console.log(`GEMINI_API_KEY present: ${!!process.env.GEMINI_API_KEY}`);
console.log(`API_KEY present: ${!!process.env.API_KEY}`);
console.log(`Active API Key length: ${apiKey.length}`);
console.log(`Active API Key starts with: ${apiKey.substring(0, 4)}...`);
console.log("-----------------------------------");

if (!apiKey) {
  console.error("CRITICAL: No API Key found in environment (GEMINI_API_KEY or API_KEY).");
}

const ai = new GoogleGenAI({ apiKey: apiKey });

// Model Configuration
const MODELS = {
  // 重度核心任务（逻辑严密性要求高）：生成判决书、质证分析
  // System Instruction: Basic Text Tasks -> 'gemini-3-flash-preview'
  HEAVY: 'gemini-3-flash-preview', 

  // 轻量级边缘任务（速度快、成本低）：摘要、标题生成、润色
  // User Request: 'gemini-1.5-flash-8b'
  // NOTE: If you encounter 404 errors with 'gemini-1.5-flash-8b', please check if your API key supports this model 
  // or try 'gemini-1.5-flash-8b-latest' or 'gemini-flash-lite-latest'.
  LIGHT: 'gemini-1.5-flash-8b'     
};

// API Route: /api/generate-summary
// This endpoint acts as a proxy to the Gemini API with Model Routing
app.post('/api/generate-summary', async (req, res) => {
  try {
    const { taskType, model: overrideModel, systemInstruction, prompt, temperature, jsonMode, images, contents } = req.body;

    // Model Routing Logic
    let selectedModel = overrideModel;
    if (!selectedModel) {
      // Strict Dual-Track Routing
      if (taskType === 'heavy') {
          selectedModel = MODELS.HEAVY;
      } else {
          // Default to LIGHT for 'light' or undefined taskType
          selectedModel = MODELS.LIGHT;
      }
    }

    console.log(`[Backend] Processing request. Task: ${taskType || 'default'}, Model: ${selectedModel}`);

    const config: any = {
      systemInstruction: systemInstruction,
      temperature: temperature ?? 0.7,
    };

    if (jsonMode) {
      config.responseMimeType = "application/json";
    }

    let contentsInput: any;
    
    // Allow direct passing of contents (for audio, complex parts, etc.)
    if (contents) {
      contentsInput = contents;
    } else if (images && images.length > 0) {
      // Construct parts with text and images
      contentsInput = {
        parts: [
          { text: prompt },
          ...images
        ]
      };
    } else {
      contentsInput = prompt;
    }

    // Call Gemini API
    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: contentsInput,
      config: config
    });

    const text = response.text || "";
    
    // Return the result as JSON
    res.json({ text });

  } catch (error: any) {
    console.error("Backend Gemini Error:", error);
    // Return error details to frontend
    res.status(500).json({ 
      error: error.message || "Internal Server Error",
      details: error.toString() 
    });
  }
});

// Vite Middleware (for development environment)
// This allows us to run both the backend API and the React frontend on the same port
if (process.env.NODE_ENV !== 'production') {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  // Production: Serve static files from 'dist'
  app.use(express.static(path.resolve(process.cwd(), 'dist')));
  
  // SPA Fallback
  app.use((req, res) => {
    res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
  });
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
