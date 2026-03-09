import 'dotenv/config';
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
const getApiKey = () => {
  const keys = [
    process.env.GEMINI_API_KEY,
    process.env.API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.VITE_GEMINI_API_KEY
  ];
  
  for (const key of keys) {
    if (key && key.trim().length > 10 && !key.includes('YOUR_API_KEY') && key !== 'undefined' && key !== 'null') {
      return key.trim();
    }
  }
  return "";
};

const apiKey = getApiKey();

console.log("--- API Key Configuration Check ---");
console.log(`GEMINI_API_KEY present: ${!!process.env.GEMINI_API_KEY}`);
console.log(`API_KEY present: ${!!process.env.API_KEY}`);
console.log(`GOOGLE_API_KEY present: ${!!process.env.GOOGLE_API_KEY}`);
console.log(`VITE_GEMINI_API_KEY present: ${!!process.env.VITE_GEMINI_API_KEY}`);
console.log(`Active API Key length: ${apiKey.length}`);
if (apiKey.length > 4) {
  console.log(`Active API Key starts with: ${apiKey.substring(0, 4)}...`);
} else {
  console.log(`Active API Key is too short or invalid.`);
}
console.log("-----------------------------------");

if (!apiKey) {
  console.error("CRITICAL: No valid API Key found in environment (GEMINI_API_KEY, API_KEY, GOOGLE_API_KEY, or VITE_GEMINI_API_KEY).");
}

const ai = new GoogleGenAI({
  apiKey: apiKey,
  baseUrl: "https://hiapi.online"
});

// Model Configuration
const MODELS = {
  // 重度核心任务（逻辑严密性要求高）：生成判决书、质证分析
  // System Instruction: Basic Text Tasks -> 'gemini-3-flash-preview'
  HEAVY: 'gemini-3-flash-preview', 

  // 轻量级边缘任务（速度快、成本低）：摘要、标题生成、润色
  // User Request: Switch to Gemini 3 Flash Preview for full stack
  LIGHT: 'gemini-3-flash-preview'     
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

    console.log(`[Backend] Processing request (Stream). Task: ${taskType || 'default'}, Model: ${selectedModel}`);

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

    // Fail fast if API Key is missing
    if (!apiKey) {
      console.error("Backend Error: API Key is missing.");
      return res.status(500).json({ 
        error: "API Key Configuration Error", 
        details: "Server environment is missing a valid API Key (GEMINI_API_KEY, API_KEY, etc.)." 
      });
    }

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Critical for Nginx to disable buffering

    // Call Gemini API with Streaming
    const response = await ai.models.generateContentStream({
      model: selectedModel,
      contents: contentsInput,
      config: config
    });

    for await (const chunk of response) {
      const text = chunk.text;
      if (text) {
        // Send data chunk
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
        // Attempt to flush if method exists (though standard Express res doesn't have .flush())
        if ((res as any).flush) (res as any).flush();
      }
    }

    // End stream
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error: any) {
    console.error("Backend Gemini Error:", error);
    // If headers are already sent, we can't send a JSON error response.
    // We should send an error event if possible, or just end the stream.
    if (!res.headersSent) {
        res.status(500).json({ 
            error: error.message || "Internal Server Error",
            details: error.toString() 
        });
    } else {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
  }
});

// Debug Endpoint: Check API Key Status
app.get('/api/debug/status', (req, res) => {
  res.json({ 
    status: 'ok',
    apiKeyConfigured: !!apiKey,
    apiKeyLength: apiKey.length,
    apiKeyPrefix: apiKey.substring(0, 4) + '...'
  });
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
