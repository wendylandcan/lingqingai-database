
import { CaseData, CaseStatus, JudgePersona } from "../types";
import { supabase } from '../supabaseClient';

const DB_KEY = 'court_of_love_db_v1';

// Helper to generate a random 6-character code
const generateCode = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

const getDb = (): Record<string, CaseData> => {
  const str = localStorage.getItem(DB_KEY);
  return str ? JSON.parse(str) : {};
};

const saveDb = (db: Record<string, CaseData>) => {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
};

export const MockDb = {
  // Create a new case
  createCase: async (plaintiffId: string): Promise<CaseData> => {
    const db = getDb();
    const id = Date.now().toString();
    const newCase: CaseData = {
      id,
      shareCode: generateCode(),
      createdDate: Date.now(),
      lastUpdateDate: Date.now(),
      plaintiffId,
      category: '亲密关系纠纷',
      description: '',
      title: '', // Initialize empty title
      plaintiffSummary: '', // Initialize empty summary
      demands: '',
      evidence: [],
      defenseStatement: '',
      defenseSummary: '', // Initialize empty defense summary
      defendantEvidence: [],
      plaintiffRebuttal: '',
      plaintiffRebuttalEvidence: [],
      defendantRebuttal: '',
      defendantRebuttalEvidence: [],
      plaintiffFinishedCrossExam: false,
      defendantFinishedCrossExam: false,
      disputePoints: [], // Initialize empty dispute points
      plaintiffFinishedDebate: false,
      defendantFinishedDebate: false,
      judgePersona: JudgePersona.BORDER_COLLIE, // Default to Border Collie
      status: CaseStatus.DRAFTING
    };

    // Sync to Supabase (Add real DB insert)
    try {
      // NOTE: Using 'plaintiff_id' as per database structure requirement
      const { error } = await supabase.from('cases').insert({
        id: newCase.id,
        plaintiff_id: plaintiffId, // Correctly mapped from user_id/plaintiffId to plaintiff_id
        share_code: newCase.shareCode,
        category: newCase.category,
        description: newCase.description,
        status: newCase.status,
        created_at: new Date(newCase.createdDate).toISOString(),
        // Store initial empty structure if needed by your DB constraints, 
        // or rely on DB defaults.
      });

      if (error) {
        console.warn("Supabase insert failed (falling back to local):", error.message);
      }
    } catch (e) {
      console.warn("Supabase connection error:", e);
    }

    // Always save to local mock DB for instant UI feedback/offline capability
    db[id] = newCase;
    saveDb(db);
    return newCase;
  },

  // Get a case by ID
  getCase: (id: string): CaseData | null => {
    const db = getDb();
    return db[id] || null;
  },

  // Get all cases relevant to a user
  getCasesForUser: (userId: string): CaseData[] => {
    const db = getDb();
    return Object.values(db).filter(c => c.plaintiffId === userId || c.defendantId === userId).sort((a, b) => b.lastUpdateDate - a.lastUpdateDate);
  },

  // Join a case via code
  joinCase: async (code: string, defendantId: string): Promise<{ success: boolean, caseId?: string, error?: string }> => {
    const db = getDb();
    const cleanCode = code.trim().toUpperCase();

    try {
      // 1. Query Cloud (Supabase) first
      const { data: remoteCase, error } = await supabase
        .from('cases')
        .select('*')
        .eq('share_code', cleanCode)
        .single();

      if (error || !remoteCase) {
        return { success: false, error: "无效的案件代码" };
      }

      // 2. Validate Identity
      if (remoteCase.plaintiff_id === defendantId) {
        return { success: false, error: "您是原告，无法作为被告加入" };
      }

      if (remoteCase.defendant_id && remoteCase.defendant_id !== defendantId) {
        return { success: false, error: "该案件已有被告" };
      }

      // 3. Update Cloud (if not already set)
      if (!remoteCase.defendant_id) {
        const { error: updateError } = await supabase
          .from('cases')
          .update({ defendant_id: defendantId })
          .eq('id', remoteCase.id);
        
        if (updateError) {
          console.error("Join update failed:", updateError);
          return { success: false, error: "加入失败: 云端同步错误" };
        }
        // Optimistically update local reference
        remoteCase.defendant_id = defendantId;
      }

      // 4. Sync to Local Cache (Map snake_case DB to camelCase App)
      // This ensures the user has the case data locally immediately
      const local = db[remoteCase.id];
      const localCase: CaseData = {
        id: remoteCase.id,
        shareCode: remoteCase.share_code,
        createdDate: new Date(remoteCase.created_at).getTime(),
        lastUpdateDate: Date.now(),
        plaintiffId: remoteCase.plaintiff_id,
        defendantId: remoteCase.defendant_id,
        category: remoteCase.category,
        description: remoteCase.description || '',
        title: remoteCase.title,
        plaintiffSummary: remoteCase.plaintiff_summary,
        demands: remoteCase.demands || '',
        evidence: remoteCase.evidence || [],
        defenseStatement: remoteCase.defense_statement || '',
        defenseSummary: remoteCase.defense_summary,
        defendantEvidence: remoteCase.defendant_evidence || [],
        plaintiffRebuttal: remoteCase.plaintiff_rebuttal || '',
        // Handle potentially missing columns gracefully with defaults
        plaintiffRebuttalEvidence: remoteCase.plaintiff_rebuttal_evidence || [], 
        defendantRebuttal: remoteCase.defendant_rebuttal || '',
        defendantRebuttalEvidence: remoteCase.defendant_rebuttal_evidence || [],
        plaintiffFinishedCrossExam: remoteCase.plaintiff_finished_cross_exam || false,
        defendantFinishedCrossExam: remoteCase.defendant_finished_cross_exam || false,
        disputePoints: (local && local.disputePoints) || [],
        plaintiffFinishedDebate: remoteCase.plaintiff_finished_debate || false,
        defendantFinishedDebate: remoteCase.defendant_finished_debate || false,
        // FIX: Map last_analyzed_hash
        lastAnalyzedHash: (local && local.lastAnalyzedHash), 
        judgePersona: remoteCase.judge_persona || JudgePersona.BORDER_COLLIE,
        status: remoteCase.status as CaseStatus,
        verdict: remoteCase.verdict
      };

      db[localCase.id] = localCase;
      saveDb(db);

      return { success: true, caseId: localCase.id };

    } catch (e) {
      console.error("Join error:", e);
      return { success: false, error: "网络连接失败，请稍后重试" };
    }
  },

  // Sync a specific case from Cloud to Local (Fix for Plaintiff waiting screen)
  syncCaseFromCloud: async (caseId: string): Promise<CaseData | null> => {
    // NOTE: We do NOT read db here initially. We read it after the async call 
    // to ensure we capture any local updates that happened while waiting for the network.
    
    try {
      const { data: remoteCase, error } = await supabase
        .from('cases')
        .select('*')
        .eq('id', caseId)
        .single();

      // Read fresh local DB *after* the async gap to avoid race condition overwrites
      const freshDb = getDb();
      const local = freshDb[caseId];

      if (error || !remoteCase) {
        // If fetch fails, return local version if exists, or null
        return local || null;
      }

      // --- CONFLICT RESOLUTION LOGIC ---
      // Check if the local status is "ahead" of the remote status. 
      if (local && local.status) {
          const statusOrder = {
            [CaseStatus.DRAFTING]: 0,
            [CaseStatus.PLAINTIFF_EVIDENCE]: 1,
            [CaseStatus.DEFENSE_PENDING]: 2,
            [CaseStatus.CROSS_EXAMINATION]: 3,
            [CaseStatus.DEBATE]: 4,
            [CaseStatus.ADJUDICATING]: 5,
            [CaseStatus.CLOSED]: 6,
            [CaseStatus.CANCELLED]: 99
          };
          
          const localS = local.status as CaseStatus;
          const remoteS = remoteCase.status as CaseStatus;
          const localLevel = statusOrder[localS] || 0;
          const remoteLevel = statusOrder[remoteS] || 0;

          // Stability Logic: Prevent regression for critical states
          
          // 1. Default Judgment Protection:
          if (localS === CaseStatus.ADJUDICATING && remoteLevel < 5) {
             console.log(`[Sync] Ignoring stale remote data (Lagging Default Judgment). Local: ADJUDICATING > Remote: ${remoteS}`);
             return local;
          }

          // 2. Verdict Protection:
          if (localS === CaseStatus.CLOSED && remoteLevel < 6) {
              console.log(`[Sync] Ignoring stale remote data (Lagging Verdict). Local: CLOSED > Remote: ${remoteS}`);
              return local;
          }

          // 3. General Forward Progress (Debate Phase):
          if (localS === CaseStatus.DEBATE && remoteLevel < 4) {
              console.log(`[Sync] Ignoring stale remote data (Lagging Debate). Local: DEBATE > Remote: ${remoteS}`);
              return local;
          }

          // 4. Appeal Protection (Appeal from Closed -> Adjudicating/Debate)
          // If we locally moved BACKWARDS (e.g., from Closed to Debate), and remote is still Closed (ahead),
          // we should trust Local (user intent) over Remote (stale state).
          if ((localS === CaseStatus.ADJUDICATING || localS === CaseStatus.DEBATE) && remoteLevel === 6) {
               console.log(`[Sync] Ignoring remote data (Appeal/Back Action). Local: ${localS} < Remote: CLOSED`);
               return local;
          }
      }
      // ---------------------------------

      // Map snake_case to camelCase
      const localCase: CaseData = {
        id: remoteCase.id,
        shareCode: remoteCase.share_code,
        createdDate: new Date(remoteCase.created_at).getTime(),
        lastUpdateDate: Date.now(), // Force update timestamp
        plaintiffId: remoteCase.plaintiff_id,
        defendantId: remoteCase.defendant_id,
        category: remoteCase.category,
        description: remoteCase.description || '',
        title: remoteCase.title,
        plaintiffSummary: remoteCase.plaintiff_summary,
        demands: remoteCase.demands || '',
        evidence: remoteCase.evidence || [],
        defenseStatement: remoteCase.defense_statement || '',
        defenseSummary: remoteCase.defense_summary,
        defendantEvidence: remoteCase.defendant_evidence || [],
        plaintiffRebuttal: remoteCase.plaintiff_rebuttal || '',
        plaintiffRebuttalEvidence: remoteCase.plaintiff_rebuttal_evidence || [], 
        defendantRebuttal: remoteCase.defendant_rebuttal || '',
        defendantRebuttalEvidence: remoteCase.defendant_rebuttal_evidence || [],
        
        // Fix for button state reverting: Trust local true state if remote is false/null
        plaintiffFinishedCrossExam: remoteCase.plaintiff_finished_cross_exam || (local && local.plaintiffFinishedCrossExam) || false,
        defendantFinishedCrossExam: remoteCase.defendant_finished_cross_exam || (local && local.defendantFinishedCrossExam) || false,
        
        // FIX: Map dispute_points with fallback to local to prevent data loss if column missing/sync fail
        disputePoints: (local && local.disputePoints) || [],
        
        plaintiffFinishedDebate: remoteCase.plaintiff_finished_debate || (local && local.plaintiffFinishedDebate) || false,
        defendantFinishedDebate: remoteCase.defendant_finished_debate || (local && local.defendantFinishedDebate) || false,

        // FIX: Map last_analyzed_hash with fallback to local to ensure 'Skip Analysis' logic works
        lastAnalyzedHash: (local && local.lastAnalyzedHash), 

        judgePersona: remoteCase.judge_persona || JudgePersona.BORDER_COLLIE,
        status: remoteCase.status as CaseStatus,
        verdict: remoteCase.verdict
      };

      // Update Local Cache
      freshDb[localCase.id] = localCase;
      saveDb(freshDb);

      return localCase;

    } catch (e) {
      console.warn("Sync failed, returning local data:", e);
      return getDb()[caseId] || null;
    }
  },

  // Update a case
  updateCase: async (id: string, updates: Partial<CaseData>): Promise<CaseData> => {
    const db = getDb();
    if (!db[id]) throw new Error("Case not found");
    
    // 1. Optimistic Local Update
    const updatedCase = { ...db[id], ...updates, lastUpdateDate: Date.now() };
    db[id] = updatedCase;
    saveDb(db);

    // 2. Supabase Sync (Async)
    try {
        const payload: any = {};
        
        // Map fields to DB columns (snake_case)
        if (updates.description !== undefined) payload.description = updates.description;
        if (updates.demands !== undefined) payload.demands = updates.demands;
        if (updates.status !== undefined) payload.status = updates.status;
        if (updates.title !== undefined) payload.title = updates.title;
        if (updates.plaintiffSummary !== undefined) payload.plaintiff_summary = updates.plaintiffSummary;
        if (updates.defenseStatement !== undefined) payload.defense_statement = updates.defenseStatement;
        if (updates.defenseSummary !== undefined) payload.defense_summary = updates.defenseSummary;
        if (updates.plaintiffRebuttal !== undefined) payload.plaintiff_rebuttal = updates.plaintiffRebuttal;
        if (updates.defendantRebuttal !== undefined) payload.defendant_rebuttal = updates.defendantRebuttal;
        if (updates.plaintiffFinishedCrossExam !== undefined) payload.plaintiff_finished_cross_exam = updates.plaintiffFinishedCrossExam;
        if (updates.defendantFinishedCrossExam !== undefined) payload.defendant_finished_cross_exam = updates.defendantFinishedCrossExam;
        if (updates.plaintiffFinishedDebate !== undefined) payload.plaintiff_finished_debate = updates.plaintiffFinishedDebate;
        if (updates.defendantFinishedDebate !== undefined) payload.defendant_finished_debate = updates.defendantFinishedDebate;
        
        // Handle complex objects if column exists and is jsonb
        if (updates.evidence !== undefined) payload.evidence = updates.evidence;
        if (updates.defendantEvidence !== undefined) payload.defendant_evidence = updates.defendantEvidence;
        // if (updates.disputePoints !== undefined) payload.dispute_points = updates.disputePoints;
        // FIX: Map lastAnalyzedHash for persistence
        // if (updates.lastAnalyzedHash !== undefined) payload.last_analyzed_hash = updates.lastAnalyzedHash;

        if (updates.verdict !== undefined) payload.verdict = updates.verdict;
        if (updates.judgePersona !== undefined) payload.judge_persona = updates.judgePersona;
        if (updates.defendantId !== undefined) payload.defendant_id = updates.defendantId;

        if (Object.keys(payload).length > 0) {
            const { error } = await supabase.from('cases').update(payload).eq('id', id);
            if (error) {
                console.warn("Supabase update failed:", error.message);
            }
        }
    } catch (e) {
        console.warn("Supabase update exception:", e);
    }

    return updatedCase;
  },

  // Delete a case
  deleteCase: (id: string) => {
    const db = getDb();
    if (db[id]) {
      delete db[id];
      saveDb(db);
    }
  },

  // For debugging/demo: Clear DB
  clear: () => localStorage.removeItem(DB_KEY)
};
