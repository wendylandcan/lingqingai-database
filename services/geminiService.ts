
// import { GoogleGenAI } from "@google/genai"; // Removed for backend proxy
import { JudgePersona, Verdict, EvidenceItem, SentimentResult, FactCheckResult, DisputePoint, EvidenceType } from "../types";

// --- Initialize Client ---
// Client-side SDK initialization removed. API calls are now proxied through the backend.
// const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }); 

// --- Helper: Retry Logic & Timeout ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const cleanJson = (text: string) => {
  // Remove markdown code blocks
  let clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
  // Try to extract JSON object/array if there's surrounding text
  const firstBrace = clean.indexOf('{');
  const firstBracket = clean.indexOf('[');
  
  // Determine if it starts with object or array
  let startIdx = -1;
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIdx = firstBrace;
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
  }

  if (startIdx !== -1) {
     const lastBrace = clean.lastIndexOf('}');
     const lastBracket = clean.lastIndexOf(']');
     const endIdx = Math.max(lastBrace, lastBracket);
     if (endIdx > startIdx) {
        clean = clean.substring(startIdx, endIdx + 1);
     }
  }
  return clean.trim();
};

async function retryWithBackoff<T>(operation: () => Promise<T>, retries = 5, initialDelay = 1000): Promise<T> {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      let status = error?.status || error?.code;
      const message = error?.message || '';

      // Attempt to parse status from message if it looks like JSON (common in some error responses)
      if (typeof message === 'string' && (message.startsWith('{') || message.includes('{"error"'))) {
          try {
              // Extract JSON part if mixed with text
              const jsonMatch = message.match(/\{.*\}/);
              if (jsonMatch) {
                  const parsed = JSON.parse(jsonMatch[0]);
                  if (parsed.error?.code) status = parsed.error.code;
                  if (parsed.code) status = parsed.code;
              }
          } catch (e) { /* ignore parse error */ }
      }

      // Retry on transient errors OR Resource Exhausted (429)
      const isTransient = 
          status === 503 || 
          status === 429 || 
          status === 500 || 
          message.includes('overloaded') || 
          message.includes('timeout') || 
          message.includes('timed out') ||
          message.includes('Resource exhausted') ||
          message.includes('429');
      
      if (isTransient && i < retries - 1) {
        // Linear/Exponential Backoff: 1s, 2s, 4s, 8s...
        const waitTime = initialDelay * Math.pow(2, i);
        // console.warn(`Retrying Gemini request (${i + 1}/${retries}) in ${waitTime}ms...`);
        await delay(waitTime);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

/**
 * Core Gemini Generation Function
 */
async function callGemini(params: {
  taskType: 'heavy' | 'light'; // Use taskType for model routing
  systemInstruction?: string;
  prompt?: string;
  temperature?: number;
  jsonMode?: boolean;
  images?: { inlineData: { data: string, mimeType: string } }[];
  contents?: any;
}): Promise<string> {
  // Add a 120s timeout to prevent hanging UI (Increased from 45s)
  const TIMEOUT_MS = 120000;

  try {
    return await retryWithBackoff(async () => {
      // Use relative path since we are proxying in dev or same origin in prod
      // If VITE_API_BASE_URL is set, use it (for separate backend deployment)
      const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
      const API_URL = `${API_BASE}/api/generate-summary`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const response = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(params),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
           const errorData = await response.json().catch(() => ({}));
           throw new Error(errorData.error || `HTTP Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.text || "";

      } catch (error: any) {
        clearTimeout(timeoutId);
        throw error;
      }
    });
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    const message = error?.message || '';
    
    if (message.includes('API key not valid') || message.includes('API_KEY_INVALID') || message.includes('API Key Configuration Error')) {
        throw new Error("API Key 配置无效或缺失，请检查环境变量设置 (API_KEY)");
    }

    if (message.includes('429') || error.status === 429 || message.includes('Resource exhausted')) {
       throw new Error("调用次数超限，AI 法官需要休息一下，请稍后再试");
    }
    if (message.includes('timed out')) {
       throw new Error("网络请求超时，请检查网络后重试");
    }
    throw new Error("AI 法官正在休庭，请稍后重试");
  }
}

// --- Public Services ---

export const transcribeAudio = async (base64Audio: string, mimeType: string): Promise<string> => {
  try {
    const res = await callGemini({
      taskType: 'heavy', // Audio transcription requires good multimodal capabilities
      systemInstruction: `You are an expert transcriber. Filter out fillers. Add punctuation.`,
      contents: {
        parts: [
          { inlineData: { mimeType: mimeType, data: base64Audio } },
          { text: "Transcribe this audio." },
        ],
      },
    });
    return res.trim() || "";
  } catch (error) {
    console.error("Transcription Error", error);
    return "（语音转录失败，请重试）";
  }
};

export const streamSummarizeStatement = async (
  text: string, 
  role: string, 
  onChunk: (text: string) => void
): Promise<string> => {
  if (!text) return "";
  
  let instruction = `Summarize the ${role}'s statement into 50-100 Chinese characters. Retain facts and emotion. Do NOT include word count (e.g. (96字)). Do NOT use markdown bolding (e.g. **text**).`;
  let content = `Statement: "${text}"`;

  // Use relative path since we are proxying in dev or same origin in prod
  // If VITE_API_BASE_URL is set, use it (for separate backend deployment)
  const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
  const API_URL = `${API_BASE}/api/generate-summary`;

  try {
      const response = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              taskType: 'light',
              systemInstruction: instruction,
              prompt: content
          })
      });

      if (!response.ok) throw new Error("Network response was not ok");
      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let buffer = "";

      while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          
          // Split by double newline which is the standard SSE delimiter
          const parts = buffer.split('\n\n');
          // The last part might be incomplete, so we keep it in the buffer
          buffer = parts.pop() || "";
          
          for (const part of parts) {
              const line = part.trim();
              if (line.startsWith('data: ')) {
                  const dataStr = line.replace('data: ', '').trim();
                  if (dataStr === '[DONE]') continue;
                  
                  try {
                      const data = JSON.parse(dataStr);
                      if (data.text) {
                          const delta = data.text;
                          fullText += delta;
                          onChunk(delta); // Emit delta for functional updates
                      }
                      if (data.error) throw new Error(data.error);
                  } catch (e) {
                      // ignore parse errors for partial chunks
                  }
              }
          }
      }
      return fullText;
  } catch (error) {
      console.error("Streaming Summary Failed:", error);
      // Fallback
      return text.slice(0, 150) + "...";
  }
};

export const summarizeStatement = async (text: string, role: string): Promise<string> => {
  // Legacy wrapper for non-streaming calls if any
  return await streamSummarizeStatement(text, role, () => {});
};

export const generateCaseTitle = async (description: string): Promise<string> => {
  if (!description || description.trim().length < 2) return "未命名案件";
  
  try {
    const res = await callGemini({
      taskType: 'light', // Title generation is a simple task
      systemInstruction: `你是一个法院书记员。请根据用户的案件描述，提炼一个简短的中文案件标题。
      
      【严格约束】：
      1. **格式**：必须以“案”字结尾（例如“火锅约会迟到案”）。
      2. **长度**：严格控制在 4-10 个汉字以内。
      3. **内容**：概括精准，带点幽默感或生活气息。
      4. **纯净输出**：只返回标题文本，严禁包含任何标点、解释、引号或前缀。`,
      prompt: `案件描述: "${description.slice(0, 500)}"` // Limit input length
    });
    
    let title = res.trim().replace(/["'《》]/g, '').replace(/标题：/g, ''); 
    
    // Post-processing reinforcement
    if (title.length > 15) title = title.substring(0, 15);
    if (!title.endsWith('案')) title += '案';
    
    console.log("Generated Case Title:", title);
    return title;
  } catch (e) {
    console.error("Case Title Generation Failed:", e);
    // Fallback strategy: Extract first few nouns or return default
    return "未命名案件";
  }
};

export const polishText = async (text: string): Promise<string> => {
  try {
    return await callGemini({
      taskType: 'light', // Polishing is a simple task
      systemInstruction: `Remove profanity. Normalize judgments. Keep facts. Output only clean text.`,
      prompt: `Text: "${text}"`
    });
  } catch (e) {
    return text;
  }
};

export const fixGrammar = async (text: string): Promise<string> => {
  try {
    return await callGemini({
      taskType: 'light', // Grammar fix is a simple task
      systemInstruction: `Add punctuation. Remove fillers (uh, um). Fix fragments. Keep tone.`,
      prompt: `Text: "${text}"`
    });
  } catch (e) {
    return text;
  }
};

export const analyzeSentiment = async (text: string): Promise<SentimentResult> => {
  try {
    const res = await callGemini({
      taskType: 'light', // Sentiment analysis is a simple classification task
      jsonMode: true,
      systemInstruction: `Analyze for toxicity. Return JSON: {isToxic, score, reason}.`,
      prompt: `Text: "${text}"`
    });
    return JSON.parse(cleanJson(res));
  } catch (e) {
    return { isToxic: false, score: 0, reason: "" };
  }
};

export const extractFactPoints = async (narrative: string): Promise<FactCheckResult> => {
  try {
    const res = await callGemini({
      taskType: 'light', // Fact extraction is relatively simple
      jsonMode: true,
      systemInstruction: `Extract objective facts. Return JSON: {facts: string[]}.`,
      prompt: `Narrative: "${narrative}"`
    });
    return JSON.parse(cleanJson(res));
  } catch (e) {
    return { facts: [] };
  }
};

/**
 * Cross-Examination Analysis for a single evidence item.
 * Uses HEAVY model for better reasoning.
 */
export const analyzeEvidenceCredibility = async (
  evidence: EvidenceItem,
  plaintiffArg: string,
  defendantArg: string
): Promise<string> => {
  
  const SYSTEM_PROMPT = `你是一个极其严谨的质证分析专家。请严格按照以下 4 个步骤对证据进行推理：
  第一步(证据提取)：客观描述图片/文本证据中的关键信息(时间/金额/人物等)。
  第二步(比对原告)：与原告陈述比对，寻找相符点与矛盾点。
  第三步(比对被告)：与被告陈述比对，寻找相符点与矛盾点。
  第四步(最终结论)：综合以上信息，判断该证据的真实性与关联性，并给出不超过 100 字的精简最终分析。
  
  请直接输出推理过程，确保逻辑严密，语气客观中立。`;

  // Prepare Prompt Context
  let promptText = `【待分析证据】：
  - 类型：${evidence.type}
  - 描述：${evidence.description || '无'}
  - 内容：${evidence.type === EvidenceType.TEXT || evidence.type === EvidenceType.AUDIO ? evidence.content : '(见附带图片)'}
  
  【原告主张】：${plaintiffArg || "（未对此具体说明）"}
  
  【被告质证/主张】：${defendantArg || "（未对此具体说明）"}
  `;

  // Prepare Images if applicable
  const images = [];
  if (evidence.type === EvidenceType.IMAGE && evidence.content.startsWith('data:')) {
      const [meta, data] = evidence.content.split(',');
      const mimeType = meta.match(/:(.*?);/)?.[1] || 'image/jpeg';
      images.push({ inlineData: { data, mimeType } });
  }

  try {
    const result = await callGemini({
      taskType: 'heavy', // Complex reasoning required
      systemInstruction: SYSTEM_PROMPT,
      prompt: promptText,
      images: images
    });

    return result.trim();
  } catch (error) {
    console.error("Evidence Analysis Failed:", error);
    return "AI 暂时无法分析此证据，请稍后重试。";
  }
};

/**
 * Identifies core dispute points.
 */
export const analyzeDisputeFocus = async (
  category: string,
  plaintiffDesc: string,
  defenseDesc: string,
  plaintiffRebuttal: string,
  defendantRebuttal: string,
  plaintiffEvidence: EvidenceItem[] 
): Promise<DisputePoint[]> => {
  
  // Format evidence for prompt
  const evidenceText = plaintiffEvidence.length > 0 
    ? plaintiffEvidence.map((e, i) => `${i+1}. [${e.type}] ${e.description || '无描述'}`).join('\n') 
    : "（未提交主要证据）";

  // New System Instruction as requested by user
  // Emphasis on plain language (通俗易懂), concise (简明扼要), and Yes/No question format (是或否的疑问句结尾).
  const JUDGE_SYSTEM_PROMPT = `你是一个经验丰富的 AI 法官，擅长挖掘情感纠纷背后的深层逻辑。
  
  你的任务是提炼 **最多 3 个** 最核心的争议焦点。
  
  【核心要求】：
  1. **数量限制**：严格控制在 1-3 个争议焦点。不要超过 3 个。
  2. **通俗易懂**：使用大白话概括背景，避免晦涩的法律术语，让普通人一眼就能看懂。
  3. **简明扼要**：直击痛点，不要废话。
  4. **明确提问**：每个焦点的描述(description)必须以具体的【是/否疑问句】结尾（例如“...是否合理？”“...是否应当...？”），方便双方直接回答“是”或“否”并展开辩论。
  
  【输出格式要求】：
  必须返回纯净的 JSON 格式，不要包含 Markdown 代码块（如 \`\`\`json）。
  
  JSON 结构如下：
  {
    "points": [
       {
         "title": "简短标题 (4-8字)",
         "description": "简短的大白话背景铺垫，并以 是/否 疑问句结尾"
       }
    ]
  }`;

  try {
    const result = await callGemini({
      taskType: 'heavy', // Complex reasoning required
      jsonMode: true,
      temperature: 0.4, // Lower temperature for more deterministic JSON
      systemInstruction: JUDGE_SYSTEM_PROMPT,
      prompt: `请分析本案争议焦点：
      
      【案件类型】：${category}
      
      【原告陈述】：
      ${plaintiffDesc || "（空）"}
      
      【原告证据】：
      ${evidenceText}

      【被告答辩】：
      ${defenseDesc || "（被告缺席或未详细答辩）"}
      
      【原告质证】：
      ${plaintiffRebuttal || "（无）"}
      
      【被告质证】：
      ${defendantRebuttal || "（无）"}`
    });

    const parsed = JSON.parse(cleanJson(result));
    
    if (!parsed.points || !Array.isArray(parsed.points)) {
        throw new Error("AI 返回格式错误");
    }

    // Enforce max 3 points
    const limitedPoints = parsed.points.slice(0, 3);

    return limitedPoints.map((p: any, index: number) => ({
      ...p,
      id: p.id ? String(p.id) : `focus-${index}-${Date.now()}`
    }));

  } catch (error: any) {
    console.error("Dispute Analysis Failed:", error);
    // Rethrow valid errors with user-friendly messages
    if (error.message.includes("休庭") || error.message.includes("调用次数") || error.message.includes("超时")) throw error; 
    throw new Error("AI 分析结果解析失败，请点击重试。");
  }
};

/**
 * Generates the final verdict.
 */
export const generateVerdict = async (
  category: string,
  plaintiffDesc: string,
  plaintiffDemands: string,
  defenseDesc: string,
  plaintiffEvidence: EvidenceItem[],
  defendantEvidence: EvidenceItem[],
  plaintiffRebuttal: string,
  plaintiffRebuttalEvidence: EvidenceItem[],
  defendantRebuttal: string,
  defendantRebuttalEvidence: EvidenceItem[],
  disputePoints: DisputePoint[],
  persona: JudgePersona
): Promise<Verdict> => {

  const formatEv = (items: EvidenceItem[]) => items.map(e => `[${e.type}] ${e.description}`).join('; ');
  
  const collectImages = (items: EvidenceItem[]) => {
    return items
      .filter(i => i.type === EvidenceType.IMAGE && i.content.startsWith('data:'))
      .map(i => {
        const [meta, data] = i.content.split(',');
        const mimeType = meta.match(/:(.*?);/)?.[1] || 'image/jpeg';
        return { inlineData: { data, mimeType } };
      });
  };

  const allImages = [
    ...collectImages(plaintiffEvidence),
    ...collectImages(defendantEvidence),
    ...collectImages(plaintiffRebuttalEvidence),
    ...collectImages(defendantRebuttalEvidence)
  ];

  const judgePrefix = persona === JudgePersona.BORDER_COLLIE ? '本汪裁判：' : '本喵裁判：';
  
  // Dynamic Persona Description based on new requirements
  const personaInstruction = persona === JudgePersona.BORDER_COLLIE
    ? `【当前法官：边牧法官 (The Rational Dog Judge)】
       - **核心思维**：法理思维 (Legalistic Mindset)。你将亲密关系视为一种特殊的“社会契约”。
       - **判决风格**：客观、中立、理性、严肃。
       - **关注点**：权利与义务的对等、承诺的履行、逻辑的一致性、客观证据的效力。
       - **忌讳**：不被情绪绑架，不和稀泥。如果一方有错，必须根据逻辑和事实严厉指出，类似于法庭上的判决。`
    : `【当前法官：猫猫法官 (The Empathetic Cat Judge)】
       - **核心思维**：情绪事实 (Emotional Facts)。你认为在亲密关系中，“感受”也是一种事实。
       - **判决风格**：兼顾客观事实与情绪浓度、治愈、温和但中立。
       - **关注点**：双方的情绪需求、沟通中的心理动因、未被看见的委屈。
       - **目标**：在认定事实对错的基础上，提供情绪价值，用高情商化解对立，追求“案结事了人和”。`;

  // Combine user's requested persona with existing functional requirements
  const systemPrompt = `你是一个经验丰富的 AI 法官，精通《民法典》婚姻家庭编精神与心理学。

  ${personaInstruction}

  任务: 对这起亲密关系纠纷做出最终判决。
  
  【全局语言要求】:
  **所有输出内容（包括但不限于事实认定、争议分析、判决结果、任务内容）必须严格使用简体中文。** Do not use English.

  【关键输出要求】:

  1. **事实认定 (facts)**:
     - 提取案件中的关键客观事实。
     - **必须使用简体中文**。

  2. **争议焦点分析 (disputeAnalyses)**:
     - 针对每个争议点进行深入分析。
     - **必须使用简体中文**。

  3. **法官寄语 (finalJudgment)**:
     - **必须以 "${judgePrefix}" 开头** (这是第一行)。
     - **从第二行开始，必须逐一回应原告的诉请**: "${plaintiffDemands}"。
     - **每一条回应必须严格遵循以下列表格式**:
       "数字. 【结论词】 关于[原告具体诉请内容]的诉请，[法官的详细理由与判决]..."
     - **【结论词】限定为**:
       - 【支持】 (完全支持原告)
       - 【驳回】 (不支持原告)
       - 【修正支持】 (部分支持或调整了方式/金额)
     - **示例**:
       1. 【支持】 关于要求被告道歉的诉请，鉴于被告确实存在过错，本庭予以支持。
       2. 【修正支持】 关于要求被告赔偿精神损失费1000元的诉请，本庭认为金额过高，建议调整为请吃一顿火锅。
       3. 【驳回】 关于要求分手的诉请，鉴于双方感情基础尚在...

  4. **“爱的破冰大冒险”任务 (penaltyTasks)**:
     - **设计理念**: 拒绝冷冰冰的惩罚！这是**促进和好**的趣味互动环节 (类似“真心话大冒险”)。
     - **核心逻辑**: **必须针对【争议焦点】进行“对症下药”的趣味化解**。
     - **关键约束 (CRITICAL)**:
       1. **执行主体**: 必须是【人对人】的互动。
       2. **严禁**: 严禁动物化(学狗叫)、严禁物质化(罚款/买礼物)、严禁沉重劳动、严禁写检讨。
       3. **简单**: 必须是当下(家里)能立刻完成的，无道具门槛。
     - **生成策略**:
       1. **回顾本案争议点**: 
          - 如果争吵是因为"态度不好/说话难听" -> 任务必须涉及"夸奖/说情话/撒娇"。
          - 如果争吵是因为"缺少陪伴/冷暴力" -> 任务必须涉及"肢体接触(拥抱/牵手)/对视"。
          - 如果争吵是因为"家务/具体琐事" -> 任务必须涉及"趣味服务(按摩/喂食)"。
       2. **趣味包装**: 给任务起个好玩的名字。
          - 例子: "【彩虹屁挑战】看着对方眼睛，连续夸赞3分钟不重样，笑了就重来。"
          - 例子: "【无声的告白】双方对视一分钟，谁先说话谁就输，输了要亲对方一下。"
          - 例子: "【女王/国王体验卡】输家为赢家提供一次‘五星级’捏肩服务，必须边捏边问候。"
     - **分配原则**: 根据【责任划分 (responsibilitySplit)】决定。输家（责任大的一方）做 2-3 个，赢家做 1 个（作为给对方的台阶/奖励）。
     - **JSON 格式**: 返回对象数组 [{ assignee: 'PLAINTIFF' | 'DEFENDANT', content: '...' }]。
  
  5. Output JSON Structure: 
  { 
    "summary": "案件摘要(中文)", 
    "facts": ["事实1(中文)", "事实2(中文)"], 
    "responsibilitySplit": {"plaintiff": number, "defendant": number}, 
    "disputeAnalyses": [{"title": "争议点标题(中文)", "analysis": "分析内容(中文)"}], 
    "reasoning": "判决理由(中文)", 
    "finalJudgment": "法官寄语(中文)", 
    "penaltyTasks": [{"assignee": "PLAINTIFF" | "DEFENDANT", "content": "任务内容(中文)"}], 
    "tone": "string" 
  }.`;

  const casePrompt = `CASE FILE:
  Category: ${category}
  Plaintiff: ${plaintiffDesc}
  Defense: ${defenseDesc}
  
  Evidence (P): ${formatEv(plaintiffEvidence)}
  Evidence (D): ${formatEv(defendantEvidence)}
  
  Debate Points:
  ${disputePoints.map(p => `- Q: ${p.title}? P: ${p.plaintiffArg} vs D: ${p.defendantArg}`).join('\n')}
  `;

  try {
    const result = await callGemini({
      taskType: 'heavy', // Verdict generation is the most complex task
      jsonMode: true,
      temperature: 0.7,
      systemInstruction: systemPrompt,
      prompt: casePrompt,
      images: allImages
    });

    const parsed = JSON.parse(cleanJson(result));
    
    // Sanitize responsibilitySplit first to use for task distribution fallback if needed
    if (parsed.responsibilitySplit) {
      let p = parsed.responsibilitySplit.plaintiff;
      let d = parsed.responsibilitySplit.defendant;

      const clean = (val: any) => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') return parseFloat(val.replace(/[^0-9.]/g, ''));
        return 0;
      };
      p = clean(p);
      d = clean(d);

      if (isNaN(p)) p = 50;
      if (isNaN(d)) d = 50;
      
      const total = p + d;
      if (total > 0 && Math.abs(total - 100) > 1) {
         p = Math.round((p / total) * 100);
         d = 100 - p;
      } else if (total === 0) {
         p = 50; d = 50;
      }
      parsed.responsibilitySplit.plaintiff = p;
      parsed.responsibilitySplit.defendant = d;
    } else {
        parsed.responsibilitySplit = { plaintiff: 50, defendant: 50 };
    }

    // Sanitize penaltyTasks to ensure structure: { assignee: 'PLAINTIFF' | 'DEFENDANT', content: string }
    if (parsed.penaltyTasks) {
       parsed.penaltyTasks = parsed.penaltyTasks.map((t: any) => {
         // Case 1: Already structured correctly
         if (typeof t === 'object' && t.assignee && t.content) {
            return {
                assignee: t.assignee.toUpperCase().includes('PLAINTIFF') ? 'PLAINTIFF' : 'DEFENDANT',
                content: t.content
            };
         }
         
         // Case 2: Object but weird keys
         if (typeof t === 'object') {
             const content = t.description || t.task || t.content || JSON.stringify(t);
             // Guess assignee from content
             const isPlaintiff = content.includes('原告') && !content.includes('被告做');
             return {
                 assignee: isPlaintiff ? 'PLAINTIFF' : 'DEFENDANT',
                 content: content
             };
         }

         // Case 3: String (Legacy fallback)
         const str = String(t);
         // Heuristic: If prompt failed to structurize, default to the loser of the case
         const loser = parsed.responsibilitySplit.defendant > parsed.responsibilitySplit.plaintiff ? 'DEFENDANT' : 'PLAINTIFF';
         return {
             assignee: loser,
             content: str
         };
       });
    } else {
        parsed.penaltyTasks = [];
    }

    return parsed;
  } catch (error) {
    console.error("Verdict Generation Failed:", error);
    throw new Error("AI 法官正在休庭，请稍后重试");
  }
};
