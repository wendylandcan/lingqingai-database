import React, { useState, useEffect } from 'react';
import { 
  Scale, 
  User, 
  Loader2, 
  Swords, 
  AlertOctagon, 
  BookOpen,
  Info,
  PenTool,
  RefreshCw,
  Check,
  Hourglass,
  AlertCircle,
  X
} from 'lucide-react';
import { 
  CaseData, 
  CaseStatus, 
  UserRole 
} from './types';
import * as GeminiService from './services/geminiService';
import { VoiceTextarea, EvidenceList, ThreeQualitiesInfo } from './components/Shared';

interface VerdictSectionProps {
  data: CaseData;
  onSubmit: (patch: Partial<CaseData>) => Promise<void> | void;
  role: UserRole;
}

export const VerdictSection: React.FC<VerdictSectionProps> = ({ data, onSubmit, role }) => {
  // Local state for edits
  const [plRebuttal, setPlRebuttal] = useState(data.plaintiffRebuttal);
  const [defRebuttal, setDefRebuttal] = useState(data.defendantRebuttal || "");
  const [showGuide, setShowGuide] = useState(false);
  
  // Loading state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  // Handlers for "Save Draft / Update State"
  const handleUpdate = (patch: Partial<CaseData>) => {
    onSubmit(patch); 
  };

  const isPlaintiff = role === UserRole.PLAINTIFF;
  const isDefendant = role === UserRole.DEFENDANT;
  const isSpectator = role === UserRole.SPECTATOR;

  // Toggle contest logic
  const togglePlaintiffEvidenceContest = (id: string) => {
    const updated = data.evidence.map(e => e.id === id ? { ...e, isContested: !e.isContested } : e);
    handleUpdate({ evidence: updated });
  };

  const toggleDefendantEvidenceContest = (id: string) => {
    const updated = data.defendantEvidence.map(e => e.id === id ? { ...e, isContested: !e.isContested } : e);
    handleUpdate({ defendantEvidence: updated });
  };

  // Helper: Generate a "fingerprint" of the current case content that affects the AI analysis
  const computeContentHash = () => {
    // We combine all fields that the AI reads to generate dispute points.
    // If any of these change, the hash changes.
    const relevantContent = {
        desc: data.description,
        defStmt: data.defenseStatement,
        plReb: data.plaintiffRebuttal, // Note: Use data.* not local state to ensure sync
        defReb: data.defendantRebuttal || "",
        // For evidence, we track ID, description and contested status.
        // We assume IDs are unique and description changes capture edits.
        ev: data.evidence.map(e => `${e.id}-${e.description}-${e.isContested}`).join('|'),
        defEv: data.defendantEvidence.map(e => `${e.id}-${e.description}-${e.isContested}`).join('|')
    };
    return JSON.stringify(relevantContent);
  };

  const executePhaseTransition = async (extraUpdates: Partial<CaseData> = {}) => {
    const currentHash = computeContentHash();
    const hasDisputePoints = data.disputePoints && data.disputePoints.length > 0;
    
    // CONDITION CHECK:
    // If we have existing points AND the content hasn't changed since the last analysis...
    if (hasDisputePoints && data.lastAnalyzedHash === currentHash) {
        // ... Skip AI analysis and go directly to Debate.
        // This preserves the user's previous inputs in the Debate phase.
        // Merge extraUpdates (flags) to ensure atomic update
        await onSubmit({ status: CaseStatus.DEBATE, ...extraUpdates });
        return;
    }

    // Otherwise (New case OR Content modified), run AI analysis.
    
    // First, save any flags if we are entering analysis mode
    if (Object.keys(extraUpdates).length > 0) {
        await onSubmit(extraUpdates);
    }

    setIsAnalyzing(true);
    setProgress(0);
    setErrorMsg(""); 

    const timer = setInterval(() => {
      setProgress(old => {
        if (old >= 99) return 99; 
        return old + 0.333; 
      });
    }, 100);

    try {
        const points = await GeminiService.analyzeDisputeFocus(
            data.category,
            data.description,
            data.defenseStatement,
            data.plaintiffRebuttal,
            data.defendantRebuttal || "",
            data.evidence 
        );
        
        clearInterval(timer);
        setProgress(100);

        setTimeout(async () => {
            await onSubmit({ 
                status: CaseStatus.DEBATE,
                disputePoints: points,
                lastAnalyzedHash: currentHash // Save the new fingerprint
            });
        }, 800);

    } catch (e: any) {
        clearInterval(timer);
        console.error(e);
        setErrorMsg(e.message || "AI 分析遇到问题，请检查网络后重试。");
        setIsAnalyzing(false);
    }
  };

  // Auto-transition effect
  useEffect(() => {
      const bothFinished = data.plaintiffFinishedCrossExam && data.defendantFinishedCrossExam;
      if (bothFinished && data.status === CaseStatus.CROSS_EXAMINATION && !isAnalyzing) {
          // Allow ANY user to trigger transition if both are finished.
          // The executePhaseTransition function has idempotency checks (lastAnalyzedHash) 
          // to handle race conditions if both clients trigger simultaneously.
          console.log("Auto-triggering phase transition (Both finished)...");
          executePhaseTransition();
      }
  }, [data.plaintiffFinishedCrossExam, data.defendantFinishedCrossExam, data.status]);

  // Auto-generate summaries if missing (Lazy generation)
  useEffect(() => {
    const generateSummaries = async () => {
        // If I am Plaintiff, and I see Defendant's statement is not summarized
        if (isPlaintiff && data.defenseStatement && !data.defenseSummary) {
             console.log("Auto-generating defense summary...");
             const s = await GeminiService.summarizeStatement(data.defenseStatement, "Defendant");
             if (s) onSubmit({ defenseSummary: s });
        }
        
        // If I am Defendant, and I see Plaintiff's statement is not summarized
        if (isDefendant && data.description && !data.plaintiffSummary) {
             console.log("Auto-generating plaintiff summary...");
             const s = await GeminiService.summarizeStatement(data.description, "Plaintiff");
             if (s) onSubmit({ plaintiffSummary: s });
        }
    };
    generateSummaries();
  }, [isPlaintiff, isDefendant, data.defenseStatement, data.defenseSummary, data.description, data.plaintiffSummary]);

  const handleFinishClick = async () => {
      if (isSubmitting) return;
      setIsSubmitting(true);
      try {
          const isMyFinished = isPlaintiff ? data.plaintiffFinishedCrossExam : data.defendantFinishedCrossExam;
          const isOtherFinished = isPlaintiff ? data.defendantFinishedCrossExam : data.plaintiffFinishedCrossExam;

          // Case 1: Both finished (Stuck state or just synced) -> Trigger Transition
          if (isMyFinished && isOtherFinished) {
              await executePhaseTransition();
              return;
          }

          // Case 2: I am finishing now -> Update DB
          const updates: Partial<CaseData> = {};
          if (isPlaintiff) {
              updates.plaintiffFinishedCrossExam = true;
              if (data.defendantFinishedCrossExam) {
                  await executePhaseTransition(updates);
              } else {
                  await onSubmit(updates);
              }
          } else if (isDefendant) {
              updates.defendantFinishedCrossExam = true;
              if (data.plaintiffFinishedCrossExam) {
                  await executePhaseTransition(updates);
              } else {
                  await onSubmit(updates);
              }
          }
      } catch (e) {
          console.error(e);
          alert("提交失败，请重试");
      } finally {
          setIsSubmitting(false);
      }
  };

  const getButtonState = () => {
      // Spectators just wait
      if (isSpectator) return { text: "等待双方结束质证...", disabled: true, icon: <Hourglass size={20}/> };

      const myStatus = isPlaintiff ? data.plaintiffFinishedCrossExam : data.defendantFinishedCrossExam;
      const otherStatus = isPlaintiff ? data.defendantFinishedCrossExam : data.plaintiffFinishedCrossExam;
      const otherRoleName = isPlaintiff ? "被告" : "原告";

      if (myStatus) {
          // I have finished
          if (otherStatus) {
              // Both finished
              return { 
                  text: isAnalyzing ? "正在生成争议焦点..." : "双方已完成，点击生成争议焦点", 
                  disabled: isAnalyzing, 
                  icon: isAnalyzing ? <Loader2 className="animate-spin" size={20}/> : <Swords size={20}/> 
              };
          } else {
              // Waiting for other
              return { text: `等待${otherRoleName}结束质证...`, disabled: true, icon: <Hourglass className="animate-pulse" size={20}/> };
          }
      } else {
          // I haven't finished
          return { text: "结束质证，进入争议焦点辩论", disabled: isAnalyzing, icon: <Check size={20}/> };
      }
  };

  const btnState = getButtonState();

  // --- Render Helpers (Moved inline or checks to avoid nesting components) ---

  const renderOpposingStatement = () => {
    if (isPlaintiff) {
        return (
            <div className="bg-white p-6 rounded-xl border-l-4 border-indigo-400 shadow-sm relative overflow-hidden">
                <div className="absolute right-0 top-0 p-4 opacity-5"><User size={100} className="text-indigo-500" /></div>
                <h4 className="font-bold text-indigo-800 mb-3 text-lg border-b border-indigo-100 pb-2 flex items-center gap-2 font-cute">
                   被告答辩 (对方观点)
                </h4>
                <p className="text-slate-700 leading-relaxed text-base relative z-10">{data.defenseSummary || data.defenseStatement}</p>
            </div>
        );
    }
    if (isDefendant) {
        return (
            <div className="bg-white p-6 rounded-xl border-l-4 border-rose-400 shadow-sm relative overflow-hidden">
                <div className="absolute right-0 top-0 p-4 opacity-5"><User size={100} className="text-rose-500" /></div>
                <h4 className="font-bold text-rose-800 mb-3 text-lg border-b border-rose-100 pb-2 flex items-center gap-2 font-cute">
                   原告起诉 (对方观点)
                </h4>
                <p className="text-slate-700 leading-relaxed text-base relative z-10">{data.plaintiffSummary || data.description}</p>
            </div>
        );
    }
    return null; 
  };

  const renderMyRebuttal = () => {
    if (isPlaintiff) {
        return (
          <div className="bg-rose-50/50 p-5 rounded-2xl border-2 border-rose-100">
            <h3 className="font-bold text-rose-700 mb-4 flex items-center gap-2 text-lg font-cute">
              <User size={20}/> 我的质证 (原告)
            </h3>
            <div className="space-y-5">
                {/* Attack Defendant's Evidence */}
                <div className="bg-white p-4 rounded-xl border border-indigo-100 shadow-sm">
                    <EvidenceList 
                      items={data.defendantEvidence} 
                      title="【点击】被告证据 (如认为虚假/无效请点击)" 
                      canContest={true} 
                      contestedIds={new Set(data.defendantEvidence.filter(e => e.isContested).map(e => e.id))}
                      onToggleContest={toggleDefendantEvidenceContest}
                    />
                </div>
                {/* Input Rebuttal */}
                <div className="bg-white p-1 rounded-xl shadow-sm">
                  <VoiceTextarea 
                    label="质证说明" 
                    placeholder="针对被告的说法或证据，你有什么反驳？(例如：证据是伪造的...)" 
                    value={plRebuttal} 
                    onChange={(val) => { setPlRebuttal(val); handleUpdate({ plaintiffRebuttal: val }); }} 
                  />
                </div>
            </div>
          </div>
        );
    }

    if (isDefendant) {
        return (
          <div className="bg-indigo-50/50 p-5 rounded-2xl border-2 border-indigo-100">
            <h3 className="font-bold text-indigo-700 mb-4 flex items-center gap-2 text-lg font-cute">
              <User size={20}/> 我的质证 (被告)
            </h3>
            <div className="space-y-5">
                {/* Attack Plaintiff's Evidence */}
                <div className="bg-white p-4 rounded-xl border border-rose-100 shadow-sm">
                    <EvidenceList 
                      items={data.evidence} 
                      title="【点击】原告证据 (如认为虚假/无效请点击)" 
                      canContest={true} 
                      contestedIds={new Set(data.evidence.filter(e => e.isContested).map(e => e.id))}
                      onToggleContest={togglePlaintiffEvidenceContest}
                    />
                </div>
                {/* Input Rebuttal */}
                <div className="bg-white p-1 rounded-xl shadow-sm">
                  <VoiceTextarea 
                    label="质证说明" 
                    placeholder="针对原告的说法或证据，你有什么反驳？" 
                    value={defRebuttal} 
                    onChange={(val) => { setDefRebuttal(val); handleUpdate({ defendantRebuttal: val }); }} 
                  />
                </div>
            </div>
          </div>
        );
    }
    return null;
  };

  return (
    <div className="space-y-8 animate-fade-in max-w-4xl mx-auto pb-24 md:pb-0">
      
      {/* Header */}
      <div className="text-center space-y-2 mb-8">
        <h2 className="text-3xl font-bold text-slate-800 font-cute flex items-center justify-center gap-3">
          <Swords className="text-amber-500" size={32} />
          法庭质证环节
        </h2>
        <p className="text-slate-500">双方互相查阅证据，并提出质疑</p>
      </div>

      {/* Main Content Grid */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Left: Opponent's Statement/Evidence context */}
        <div className="space-y-4">
           {renderOpposingStatement()}
        </div>

        {/* Right: My Rebuttal Area */}
        <div className="space-y-4">
           {renderMyRebuttal()}
        </div>
      </div>

      {/* Cross-examination Guide */}
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800 flex items-start gap-2 relative">
          <Info className="shrink-0 mt-0.5 text-amber-600" size={16} />
          <div className="flex-1">
              <span className="font-bold">质证攻略：</span>
              质证环节可以对对方证据的真实性、关联性、合法性进行质疑。
              <button 
                onClick={() => setShowGuide(!showGuide)} 
                className="inline-flex ml-1 align-text-bottom text-amber-600 hover:text-amber-800 transition-colors"
                title="点击查看详情"
              >
                  <AlertCircle size={16} />
              </button>
          </div>

          {showGuide && (
            <div className="absolute bottom-full left-0 mb-3 w-full md:w-80 bg-white rounded-xl shadow-xl border border-amber-100 p-4 z-10 animate-fade-in">
                <div className="flex justify-between items-center mb-3 pb-2 border-b border-slate-100">
                    <h4 className="font-bold text-amber-800 flex items-center gap-2 text-sm">
                        <BookOpen size={16} className="text-amber-600"/> 证据三性详解
                    </h4>
                    <button onClick={() => setShowGuide(false)} className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-50 rounded-full transition-colors">
                        <X size={16} />
                    </button>
                </div>
                <div className="space-y-3 text-xs text-slate-600">
                    <div className="flex gap-2">
                        <span className="font-bold text-slate-800 shrink-0 bg-amber-50 px-1.5 py-0.5 rounded text-amber-700">真实性</span>
                        <span className="leading-relaxed">证据来源可靠、内容客观。</span>
                    </div>
                    <div className="flex gap-2">
                        <span className="font-bold text-slate-800 shrink-0 bg-amber-50 px-1.5 py-0.5 rounded text-amber-700">关联性</span>
                        <span className="leading-relaxed">证据与本案争议焦点具有实质性的逻辑关联。</span>
                    </div>
                    <div className="flex gap-2">
                        <span className="font-bold text-slate-800 shrink-0 bg-amber-50 px-1.5 py-0.5 rounded text-amber-700">合法性</span>
                        <span className="leading-relaxed">证据的获取方式合法正当。</span>
                    </div>
                </div>
                {/* Arrow */}
                <div className="absolute -bottom-2 left-8 w-4 h-4 bg-white border-b border-r border-amber-100 transform rotate-45"></div>
            </div>
          )}
      </div>

      {/* Action Area */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/90 backdrop-blur border-t border-slate-200 z-50 md:relative md:bg-transparent md:border-0 md:p-0 mt-8">
          <div className="max-w-4xl mx-auto">
            {errorMsg && (
                <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg flex items-center gap-2 text-sm">
                    <AlertOctagon size={16}/> {errorMsg}
                </div>
            )}
            
            <button
                onClick={handleFinishClick}
                disabled={btnState.disabled || isAnalyzing || isSubmitting}
                className={`w-full py-4 rounded-xl font-bold text-lg shadow-xl transition-all flex items-center justify-center gap-3
                    ${btnState.disabled || isSubmitting
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                        : 'bg-gradient-to-r from-amber-500 to-orange-600 text-white hover:scale-[1.01] active:scale-[0.99]'
                    }`}
            >
                {isAnalyzing || isSubmitting ? (
                    <>
                       <Loader2 className="animate-spin" />
                       {isAnalyzing ? `正在生成争议焦点 (${Math.round(progress)}%)...` : "正在提交..."}
                    </>
                ) : (
                    <>
                       {btnState.icon}
                       {btnState.text}
                    </>
                )}
            </button>
          </div>
      </div>
    </div>
  );
};