
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

async function retryWithBackoff<T>(operation: () => Promise<T>, retries = 3, initialDelay = 1000): Promise<T> {
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
        // 减少重试延迟：500ms, 1s, 2s
        const waitTime = initialDelay * Math.pow(1.5, i);
        console.warn(`重试中 (${i + 1}/${retries})，等待 ${Math.round(waitTime)}ms...`);
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
  // 增加超时时间到 180 秒，因为判决书生成需要更长时间
  const TIMEOUT_MS = 180000;

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

        if (!response.ok) {
           clearTimeout(timeoutId);
           const errorData = await response.json().catch(() => ({}));
           throw new Error(errorData.error || `HTTP Error: ${response.status} ${response.statusText}`);
        }

        // 处理 SSE 流式响应
        const reader = response.body?.getReader();
        if (!reader) {
          clearTimeout(timeoutId);
          throw new Error("无法读取响应流");
        }

        const decoder = new TextDecoder();
        let fullText = '';
        let lastChunkTime = Date.now();
        const CHUNK_TIMEOUT = 60000; // 60秒内没有新数据就超时

        while (true) {
          // 检查是否超过块超时时间
          if (Date.now() - lastChunkTime > CHUNK_TIMEOUT) {
            clearTimeout(timeoutId);
            reader.cancel();
            throw new Error("响应流超时：长时间未收到数据");
          }

          const { done, value } = await reader.read();
          if (done) break;

          lastChunkTime = Date.now(); // 更新最后接收数据的时间
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6); // 移除 "data: " 前缀

              if (data === '[DONE]') {
                clearTimeout(timeoutId);
                return fullText;
              }

              try {
                const parsed = JSON.parse(data);
                if (parsed.text) {
                  fullText += parsed.text;
                }
                if (parsed.error) {
                  clearTimeout(timeoutId);
                  throw new Error(parsed.error);
                }
              } catch (e) {
                // 忽略无法解析的行
                if (data.trim() && data !== '[DONE]') {
                  console.warn('无法解析 SSE 数据:', data);
                }
              }
            }
          }
        }

        clearTimeout(timeoutId);
        return fullText;

      } catch (error: any) {
        clearTimeout(timeoutId);
        throw error;
      }
    });
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    const message = error?.message || '';

    if (message.includes('API key not valid') || message.includes('API_KEY_INVALID') || message.includes('API Key Configuration Error')) {
        throw new Error("API Key 配置无效或缺失，请检查环境变量设置");
    }

    if (message.includes('429') || error.status === 429 || message.includes('Resource exhausted')) {
       throw new Error("调用次数超限，AI 法官需要休息一下，请稍后再试");
    }

    if (message.includes('timed out') || message.includes('timeout') || message.includes('超时') || error.name === 'AbortError') {
       throw new Error("AI 法官思考时间过长，请重试或简化案情描述");
    }

    if (message.includes('响应流超时')) {
       throw new Error("网络连接不稳定，请检查网络后重试");
    }

    // 如果有具体错误信息，直接返回
    if (message && message.length > 0 && message.length < 200) {
       throw new Error(message);
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
  
  【原告主张】：${plaintiffArg || "(未对此具体说明)"}

  【被告质证/主张】：${defendantArg || "(未对此具体说明)"}
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
    : '(未提交主要证据)';

  // 精简的 System Prompt，保持核心要求
  const JUDGE_SYSTEM_PROMPT = `你是 AI 法官，提炼 1-3 个核心争议焦点。

要求：
1. 通俗易懂，直击痛点
2. 每个焦点以”是/否”疑问句结尾
3. 返回纯 JSON，格式：{“points”:[{“title”:”4-8字标题”,”description”:”背景+疑问句”}]}`;

  try {
    const result = await callGemini({
      taskType: 'heavy',
      jsonMode: true,
      temperature: 0.35, // 平衡速度和质量
      systemInstruction: JUDGE_SYSTEM_PROMPT,
      prompt: `案件类型：${category}
原告：${plaintiffDesc || “(空)”}
证据：${evidenceText}
被告：${defenseDesc || “(缺席)”}
原告质证：${plaintiffRebuttal || “(无)”}
被告质证：${defendantRebuttal || “(无)”}`
    });

    const parsed = JSON.parse(cleanJson(result));

    if (!parsed.points || !Array.isArray(parsed.points)) {
        throw new Error(“AI 返回格式错误”);
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

  const judgePrefix = persona === JudgePersona.BORDER_COLLIE ? ‘本汪裁判：’ : ‘本喵裁判：’;

  // 精简的法官人格描述
  const personaInstruction = persona === JudgePersona.BORDER_COLLIE
    ? `边牧法官：法理思维，客观中立，理性判断。关注权利义务对等、承诺履行、逻辑一致性。`
    : `猫猫法官：情绪事实，兼顾感受，治愈温和。关注情绪需求、心理动因、未被看见的委屈。`;

  // 精简但保留关键指导的 System Prompt
  const systemPrompt = `你是 AI 法官，精通民法典和心理学。${personaInstruction}

核心任务：对亲密关系纠纷做出判决，输出 JSON。

关键要求：
1. finalJudgment 必须以”${judgePrefix}”开头，逐一回应诉请：”${plaintiffDemands}”
   格式：数字.【支持/驳回/修正支持】关于...的诉请，...
2. penaltyTasks 设计原则：
   - 人对人互动（禁止学狗叫、罚款、写检讨）
   - 针对争议点：态度问题→夸赞/说情话；缺少陪伴→拥抱/对视；家务琐事→按摩/喂食
   - 简单有趣，当下可完成
   - 根据责任划分分配任务
3. 所有内容使用简体中文

JSON 结构：
{
  “summary”: “案件摘要”,
  “facts”: [“事实1”,”事实2”],
  “responsibilitySplit”: {“plaintiff”: 数字, “defendant”: 数字},
  “disputeAnalyses”: [{“title”:”争议点”,”analysis”:”分析”}],
  “reasoning”: “判决理由”,
  “finalJudgment”: “${judgePrefix}开头的判决”,
  “penaltyTasks”: [{“assignee”:”PLAINTIFF/DEFENDANT”,”content”:”任务”}],
  “tone”: “string”
}`;

  const casePrompt = `类型：${category}
原告：${plaintiffDesc}
被告：${defenseDesc}
证据P：${formatEv(plaintiffEvidence)}
证据D：${formatEv(defendantEvidence)}
辩论：
${disputePoints.map(p => `${p.title}? 原告：${p.plaintiffArg} 被告：${p.defendantArg}`).join(‘\n’)}`;

  try {
    const result = await callGemini({
      taskType: ‘heavy’,
      jsonMode: true,
      temperature: 0.65, // 平衡创意性和速度
      systemInstruction: systemPrompt,
      prompt: casePrompt,
      images: allImages.length > 0 ? allImages : undefined // 只在有图片时传递
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
