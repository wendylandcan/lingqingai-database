import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import path from 'path';

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
// Increase payload limit to handle base64 images
app.use(express.json({ limit: '50mb' })); 

// Initialize Gemini Client
// The API key is automatically available in process.env.API_KEY in this environment
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// API Route: /api/generate-summary
// This endpoint acts as a proxy to the Gemini API
app.post('/api/generate-summary', async (req, res) => {
  try {
    const { model, systemInstruction, prompt, temperature, jsonMode, images } = req.body;

    console.log(`[Backend] Processing request for model: ${model}`);

    const config: any = {
      systemInstruction: systemInstruction,
      temperature: temperature ?? 0.7,
    };

    if (jsonMode) {
      config.responseMimeType = "application/json";
    }

    let contentsInput: any;
    if (images && images.length > 0) {
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
      model: model,
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
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
  });
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
