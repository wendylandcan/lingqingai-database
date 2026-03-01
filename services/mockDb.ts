
import { CaseData, CaseStatus, JudgePersona } from "../types";
import { supabase } from '../supabaseClient';

const DB_KEY = 'court_of_love_db_v1';

// Helper to generate a random 6-digit number
const generateCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
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
      isDeliberating: false, // Initialize as false
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
          .eq('share_code', remoteCase.share_code);
        
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
        createdDate: remoteCase.created_at ? new Date(remoteCase.created_at).getTime() : Date.now(),
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
        disputePoints: remoteCase.dispute_points || (local && local.disputePoints) || [],
        plaintiffFinishedDebate: remoteCase.plaintiff_finished_debate || false,
        defendantFinishedDebate: remoteCase.defendant_finished_debate || false,
        // FIX: Map last_analyzed_hash
        lastAnalyzedHash: remoteCase.last_analyzed_hash || (local && local.lastAnalyzedHash), 
        lastVerdictHash: remoteCase.last_verdict_hash || (local && local.lastVerdictHash),
        
        isDeliberating: remoteCase.is_deliberating ?? false,

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
    // Resolve share_code from local DB if possible, to avoid querying by timestamp ID
    // This fixes the 406 error where a timestamp ID was passed to .eq('share_code', ...)
    const preDb = getDb();
    const preLocal = preDb[caseId];
    
    let query = supabase.from('cases').select('*');

    if (preLocal && preLocal.shareCode) {
        // Best case: we have local data, use the verified share code
        query = query.eq('share_code', preLocal.shareCode);
    } else if (caseId.length === 6 && /^[A-Z0-9]+$/.test(caseId)) {
        // It looks like a share code, treat it as such
        query = query.eq('share_code', caseId);
    } else {
        // Fallback: It's likely an ID (timestamp or UUID), query by ID
        // This prevents passing a timestamp ID to the share_code column
        query = query.eq('id', caseId);
    }

    try {
      const { data: remoteCase, error } = await query.single();

      // Read fresh local DB *after* the async gap to avoid race condition overwrites
      const freshDb = getDb();
      const local = freshDb[caseId];

      // --- FLASH SCREEN FIX ---
      // If the local data was updated by a USER ACTION very recently (< 5s),
      // we generally trust the local optimistic update to avoid jitter.
      // BUT, if the remote status is "ahead" of us (e.g. moved to next phase), 
      // we MUST accept it, otherwise we get stuck in the previous phase.
      const statusOrder: Record<string, number> = {
        [CaseStatus.DRAFTING]: 0,
        [CaseStatus.PLAINTIFF_EVIDENCE]: 1,
        [CaseStatus.DEFENSE_PENDING]: 2,
        [CaseStatus.CROSS_EXAMINATION]: 3,
        [CaseStatus.CROSS_EXAMINATION_P_DONE]: 3,
        [CaseStatus.CROSS_EXAMINATION_D_DONE]: 3,
        [CaseStatus.ANALYZING_DISPUTE]: 4,
        [CaseStatus.DEBATE]: 5,
        [CaseStatus.DEBATE_P_DONE]: 5,
        [CaseStatus.DEBATE_D_DONE]: 5,
        [CaseStatus.JUDGE_SELECTION]: 6,
        [CaseStatus.ADJUDICATING]: 7,
        [CaseStatus.CLOSED]: 8,
        [CaseStatus.CANCELLED]: 99
      };

      if (local && local._isUserAction && (Date.now() - local.lastUpdateDate < 5000)) {
          const localS = local.status as CaseStatus;
          const remoteS = remoteCase.status as CaseStatus;
          const localLevel = statusOrder[localS] || 0;
          const remoteLevel = statusOrder[remoteS] || 0;

          // Only block if we are at the SAME or LATER stage. 
          // If remote is AHEAD (remoteLevel > localLevel), we allow the sync to pass through 
          // so we don't get stuck.
          if (remoteLevel <= localLevel) {
             console.log("[Sync] Local data is fresh & remote is not ahead. Ignoring remote.");
             return local;
          }
          console.log(`[Sync] Local is fresh but remote is ahead (${localS} -> ${remoteS}). Accepting remote.`);
      }

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
            [CaseStatus.CROSS_EXAMINATION_P_DONE]: 3,
            [CaseStatus.CROSS_EXAMINATION_D_DONE]: 3,
            [CaseStatus.ANALYZING_DISPUTE]: 4,
            [CaseStatus.DEBATE]: 5,
            [CaseStatus.DEBATE_P_DONE]: 5,
            [CaseStatus.DEBATE_D_DONE]: 5,
            [CaseStatus.JUDGE_SELECTION]: 6,
            [CaseStatus.ADJUDICATING]: 7,
            [CaseStatus.CLOSED]: 8,
            [CaseStatus.CANCELLED]: 99
          };
          
          const localS = local.status as CaseStatus;
          const remoteS = remoteCase.status as CaseStatus;
          const localLevel = statusOrder[localS] || 0;
          const remoteLevel = statusOrder[remoteS] || 0;

          // Debug Sync
          if (localS !== remoteS || localLevel !== remoteLevel) {
              console.log(`[Sync Debug] Local: ${localS}(${localLevel}), Remote: ${remoteS}(${remoteLevel})`);
              console.log(`[Sync Debug] Remote Flags: P_Debate=${remoteCase.plaintiff_finished_debate}, D_Debate=${remoteCase.defendant_finished_debate}`);
          }

          // Stability Logic:
          // We removed the "forward progress" protection to allow for the "Bucket Effect" (Phase Rollback).
          // If the server says we are in an earlier phase, we must respect it to ensure synchronization.

          // 3. Recent Action Protection (Optimistic UI)
          // If local was updated very recently (< 5s) by a USER ACTION and is AHEAD of remote, trust local.
          // This prevents the "flash back" caused by stale reads immediately after a write.
          // FIX: Added local._isUserAction check to ensure we don't block syncs just because syncUserCases ran recently.
          if (local._isUserAction && Date.now() - local.lastUpdateDate < 5000 && localLevel > remoteLevel) {
               console.log(`[Sync] Trusting local (Recent User Action). Local: ${localS} > Remote: ${remoteS}`);
               return local;
          }

          // 4. Appeal Protection (Appeal from Closed -> Judge Selection)
          // If we locally moved BACKWARDS (e.g., from Closed to Judge Selection), and remote is still Closed (ahead),
          // we should trust Local (user intent) over Remote (stale state).
          if (localS === CaseStatus.JUDGE_SELECTION && remoteLevel === 8) {
               console.log(`[Sync] Ignoring remote data (Appeal Action). Local: ${localS} < Remote: CLOSED`);
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
        // Use nullish coalescing (??) to correctly handle 'false' values from remote
        plaintiffFinishedCrossExam: remoteCase.plaintiff_finished_cross_exam ?? (local && local.plaintiffFinishedCrossExam) ?? false,
        defendantFinishedCrossExam: remoteCase.defendant_finished_cross_exam ?? (local && local.defendantFinishedCrossExam) ?? false,
        
        // FIX: Map dispute_points with fallback to local to prevent data loss if column missing/sync fail
        disputePoints: remoteCase.dispute_points || (local && local.disputePoints) || [],
        
        plaintiffFinishedDebate: remoteCase.plaintiff_finished_debate ?? (local && local.plaintiffFinishedDebate) ?? false,
        defendantFinishedDebate: remoteCase.defendant_finished_debate ?? (local && local.defendantFinishedDebate) ?? false,

        // FIX: Map last_analyzed_hash with fallback to local to ensure 'Skip Analysis' logic works
        lastAnalyzedHash: remoteCase.last_analyzed_hash || (local && local.lastAnalyzedHash), 
        lastVerdictHash: remoteCase.last_verdict_hash || (local && local.lastVerdictHash),
        
        isDeliberating: remoteCase.is_deliberating ?? false,

        judgePersona: remoteCase.judge_persona || JudgePersona.BORDER_COLLIE,
        status: remoteCase.status as CaseStatus,
        verdict: remoteCase.verdict,
        _isUserAction: false // Mark as synced from cloud
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
    const updatedCase = { ...db[id], ...updates, lastUpdateDate: Date.now(), _isUserAction: true };
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
        
        // FIX: Ensure disputePoints are synced to cloud
        if (updates.disputePoints !== undefined) payload.dispute_points = updates.disputePoints;
        // FIX: Ensure lastAnalyzedHash is synced to cloud
        if (updates.lastAnalyzedHash !== undefined) payload.last_analyzed_hash = updates.lastAnalyzedHash;
        if (updates.lastVerdictHash !== undefined) payload.last_verdict_hash = updates.lastVerdictHash;
        
        if (updates.isDeliberating !== undefined) payload.is_deliberating = updates.isDeliberating;

        if (updates.verdict !== undefined) payload.verdict = updates.verdict;
        if (updates.judgePersona !== undefined) payload.judge_persona = updates.judgePersona;
        if (updates.defendantId !== undefined) payload.defendant_id = updates.defendantId;

        if (Object.keys(payload).length > 0) {
            // FIX: Use shareCode from the case object, NOT the id (which is timestamp)
            const shareCode = updatedCase.shareCode;
            const { error } = await supabase.from('cases').update(payload).eq('share_code', shareCode);
            if (error) {
                console.warn("Supabase update failed:", error.message);
            }
        }
    } catch (e) {
        console.warn("Supabase update exception:", e);
    }

    return updatedCase;
  },

  // Sync all cases for a user from Cloud (for list view)
  syncUserCases: async (userId: string): Promise<void> => {
    try {
      const { data: remoteCases, error } = await supabase
        .from('cases')
        .select('*')
        .or(`plaintiff_id.eq.${userId},defendant_id.eq.${userId}`);

      if (error) throw error;

      if (remoteCases) {
        const db = getDb();
        const remoteIds = new Set(remoteCases.map(c => c.id));
        
        // 1. Update/Insert remote cases to local
        remoteCases.forEach(remoteCase => {
            const local = db[remoteCase.id];
            
            // --- FLASH SCREEN FIX ---
            // Skip update if local data is fresh from user action
            if (local && local._isUserAction && (Date.now() - local.lastUpdateDate < 5000)) {
                return;
            }

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
                plaintiffRebuttalEvidence: remoteCase.plaintiff_rebuttal_evidence || [], 
                defendantRebuttal: remoteCase.defendant_rebuttal || '',
                defendantRebuttalEvidence: remoteCase.defendant_rebuttal_evidence || [],
                plaintiffFinishedCrossExam: remoteCase.plaintiff_finished_cross_exam ?? (local && local.plaintiffFinishedCrossExam) ?? false,
                defendantFinishedCrossExam: remoteCase.defendant_finished_cross_exam ?? (local && local.defendantFinishedCrossExam) ?? false,
                disputePoints: remoteCase.dispute_points || (local && local.disputePoints) || [],
                plaintiffFinishedDebate: remoteCase.plaintiff_finished_debate ?? (local && local.plaintiffFinishedDebate) ?? false,
                defendantFinishedDebate: remoteCase.defendant_finished_debate ?? (local && local.defendantFinishedDebate) ?? false,
                lastAnalyzedHash: remoteCase.last_analyzed_hash || (local && local.lastAnalyzedHash), 
                lastVerdictHash: remoteCase.last_verdict_hash || (local && local.lastVerdictHash),
                isDeliberating: remoteCase.is_deliberating ?? false,
                judgePersona: remoteCase.judge_persona || JudgePersona.BORDER_COLLIE,
                status: remoteCase.status as CaseStatus,
                verdict: remoteCase.verdict
            };
            db[localCase.id] = localCase;
        });

        // 2. Remove local cases that are NOT in remote (Sync Deletion)
        Object.values(db).forEach(localCase => {
            const isMyCase = localCase.plaintiffId === userId || localCase.defendantId === userId;
            if (isMyCase && !remoteIds.has(localCase.id)) {
                // If I am defendant, and it's gone from remote, delete it.
                if (localCase.defendantId === userId) {
                    // Grace period: Don't delete if updated locally in last 10 seconds (e.g. just joined)
                    // This prevents race condition where Supabase query returns empty but we just joined locally
                    if (Date.now() - localCase.lastUpdateDate > 10000) {
                        delete db[localCase.id];
                    }
                }
                // If I am plaintiff, and it's gone from remote...
                else if (localCase.plaintiffId === userId) {
                     // Only delete if it's not a brand new draft (give it 10s grace period for sync)
                     if (Date.now() - localCase.createdDate > 10000) {
                         delete db[localCase.id];
                     }
                }
            }
        });
        
        saveDb(db);
      }
    } catch (e) {
      console.warn("Sync user cases failed:", e);
    }
  },

  // Delete a case
  deleteCase: async (id: string) => {
    const db = getDb();
    const caseData = db[id];
    
    // 1. Delete from Supabase
    if (caseData && caseData.shareCode) {
        try {
            await supabase.from('cases').delete().eq('share_code', caseData.shareCode);
        } catch (e) {
            console.error("Supabase delete failed:", e);
        }
    }

    // 2. Delete locally
    if (db[id]) {
      delete db[id];
      saveDb(db);
    }
  },

  // For debugging/demo: Clear DB
  clear: () => localStorage.removeItem(DB_KEY)
};
