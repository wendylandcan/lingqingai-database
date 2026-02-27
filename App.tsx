import React, { useState, useEffect, useRef } from 'react';
import { 
  Gavel, 
  Scale, 
  PlusCircle, 
  User, 
  CheckCircle2, 
  FileText, 
  Loader2, 
  ChevronLeft, 
  LogOut, 
  RefreshCw, 
  Copy, 
  Users, 
  Trash2, 
  AlertOctagon, 
  Sparkles, 
  Home, 
  Heart, 
  Dog, 
  Cat, 
  PawPrint, 
  Swords, 
  MessageSquare, 
  UserX,
  GraduationCap,
  Gamepad2,
  Gift,
  Hourglass,
  ArrowRight
} from 'lucide-react';
import { 
  CaseData, 
  CaseStatus, 
  UserRole, 
  Verdict, 
  JudgePersona,
  PenaltyTask
} from './types';
import * as GeminiService from './services/geminiService';
import { MockDb } from './services/mockDb';
import { VerdictSection } from './VerdictSection';
import { 
  ConfirmDialog, 
  VoiceTextarea, 
  EvidenceList, 
  EvidenceCreator,
  MessageContent
} from './components/Shared';
import { supabase } from './supabaseClient';
import Auth from './components/Auth';

const FilingForm = ({ data, onSubmit }: { data: CaseData, onSubmit: (d: Partial<CaseData>) => Promise<void> | void }) => {
  const [desc, setDesc] = useState(data.description);
  const [demands, setDemands] = useState(data.demands);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!desc.trim()) return alert("请填写陈述");
    
    setIsSubmitting(true);

    await onSubmit({ 
      description: desc, 
      demands,
      status: CaseStatus.PLAINTIFF_EVIDENCE 
    });

    Promise.all([
      GeminiService.analyzeSentiment(desc),
      GeminiService.generateCaseTitle(desc),
      GeminiService.summarizeStatement(desc, "Plaintiff")
    ]).then(([sentiment, title, summary]) => {
      if (sentiment.isToxic) {
         console.warn("Toxic content detected:", sentiment.reason);
      }
      onSubmit({
        title: title || undefined,
        plaintiffSummary: summary
      });
    }).catch(err => {
      console.error("Background AI task failed:", err);
    });
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-rose-100 space-y-4">
      <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2 font-cute"><FileText className="text-rose-500" />原告起诉</h2>
      <VoiceTextarea label="事实陈述" placeholder="请具体描述..." value={desc} onChange={setDesc} required />
      <VoiceTextarea label="诉请" placeholder="诉请 (如: 道歉)..." value={demands} onChange={setDemands} required />
      <button 
        onClick={handleSubmit} 
        disabled={isSubmitting}
        className="w-full bg-rose-600 text-white font-bold py-3 rounded-xl hover:bg-rose-700 flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed"
      >
        {isSubmitting ? <Loader2 className="animate-spin" /> : "下一步：举证"}
      </button>
    </div>
  );
};

const PlaintiffEvidenceStep = ({ data, onSubmit }: { data: CaseData, onSubmit: (d: Partial<CaseData>) => Promise<void> | void }) => (
  <div className="space-y-6 animate-fade-in">
    <div className="bg-white p-6 rounded-xl shadow-sm border border-rose-100">
      <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2 font-cute"><Gavel className="text-rose-500" />原告举证</h2>
      <EvidenceList 
        items={data.evidence} 
        title="已提交证据" 
        onDelete={(id) => onSubmit({ evidence: data.evidence.filter(e => e.id !== id) })}
      />
      <div className="mt-6 border-t pt-4">
        <EvidenceCreator userRole={UserRole.PLAINTIFF} onAdd={e => onSubmit({ evidence: [...data.evidence, e] })} />
      </div>
    </div>
    <button onClick={() => onSubmit({ status: CaseStatus.DEFENSE_PENDING })} className="w-full bg-rose-600 text-white font-bold py-3 rounded-xl hover:bg-rose-700 shadow-lg">提交给被告</button>
  </div>
);

const DefenseStep = ({ data, onSubmit }: { data: CaseData, onSubmit: (d: Partial<CaseData>) => Promise<void> | void }) => {
  const [stmt, setStmt] = useState(data.defenseStatement);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
      if (!stmt.trim()) return alert("请填写答辩理由");
      
      setIsSubmitting(true);

      await onSubmit({ 
          defenseStatement: stmt, 
          status: CaseStatus.CROSS_EXAMINATION 
      });

      GeminiService.summarizeStatement(stmt, "Defendant")
        .then(summary => {
           onSubmit({ defenseSummary: summary });
        })
        .catch(err => console.error("Background summary failed", err));
  };

  return (
    <div className="space-y-6">
      <div className="bg-indigo-50 p-6 rounded-xl border border-indigo-100">
        <h2 className="text-lg font-bold text-indigo-900 mb-2 font-cute">原告陈述 (AI 摘要)</h2>
        <div className="text-sm text-indigo-600 mb-3 bg-white/50 p-2 rounded">
           <MessageContent text={data.plaintiffSummary || data.description} />
        </div>
        {data.demands && (
            <>
                <h2 className="text-lg font-bold text-indigo-900 mb-2 font-cute">原告诉请</h2>
                <div className="text-sm text-indigo-600 mb-3 bg-white/50 p-2 rounded">
                    <MessageContent text={data.demands} />
                </div>
            </>
        )}
      </div>
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h2 className="text-xl font-bold text-slate-800 mb-4 font-cute">被告举证与答辩</h2>
        <VoiceTextarea label="答辩理由" placeholder="陈述你的理由..." value={stmt} onChange={setStmt} required />
        <div className="mt-6">
          <EvidenceList 
            items={data.defendantEvidence} 
            title="被告提交的证据" 
            onDelete={(id) => onSubmit({ defendantEvidence: data.defendantEvidence.filter(e => e.id !== id) })}
          />
          <div className="mt-2"><EvidenceCreator userRole={UserRole.DEFENDANT} onAdd={e => onSubmit({ defendantEvidence: [...data.defendantEvidence, e] })} /></div>
        </div>
      </div>
      <button 
        onClick={handleSubmit} 
        disabled={isSubmitting}
        className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 shadow-lg flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-70 disabled:cursor-not-allowed"
      >
         {isSubmitting ? <Loader2 className="animate-spin" /> : "进入质证环节"}
      </button>
    </div>
  );
};

const DisputeDebateStep = ({ data, onSubmit, userRole }: { data: CaseData, onSubmit: (d: Partial<CaseData>) => Promise<void> | void, userRole: UserRole }) => {
    const isPlaintiff = userRole === UserRole.PLAINTIFF;
    const isDefendant = userRole === UserRole.DEFENDANT;
    const isSpectator = userRole === UserRole.SPECTATOR;

    const handleArgUpdate = (pointId: string, text: string) => {
        const updatedPoints = data.disputePoints.map(p => {
            if (p.id === pointId) {
                return isPlaintiff ? { ...p, plaintiffArg: text } : { ...p, defendantArg: text };
            }
            return p;
        });
        onSubmit({ disputePoints: updatedPoints });
    };

    const handleFinishDebate = () => {
        if (isPlaintiff) {
             if (data.defendantFinishedDebate) {
                 onSubmit({ plaintiffFinishedDebate: true, status: CaseStatus.ADJUDICATING });
             } else {
                 onSubmit({ plaintiffFinishedDebate: true });
             }
        } else if (isDefendant) {
             if (data.plaintiffFinishedDebate) {
                 onSubmit({ defendantFinishedDebate: true, status: CaseStatus.ADJUDICATING });
             } else {
                 onSubmit({ defendantFinishedDebate: true });
             }
        }
    };

    const getButtonState = () => {
        if (isSpectator) return { text: "等待双方结束辩论...", disabled: true, icon: <Hourglass size={20}/> };

        const myStatus = isPlaintiff ? data.plaintiffFinishedDebate : data.defendantFinishedDebate;
        const otherStatus = isPlaintiff ? data.defendantFinishedDebate : data.plaintiffFinishedDebate;
        const otherRoleName = isPlaintiff ? "被告" : "原告";

        if (myStatus) {
            if (otherStatus) {
                 return { text: "双方已完成，正在进入判决...", disabled: true, icon: <Loader2 className="animate-spin" size={20}/> };
            } else {
                 return { text: `等待${otherRoleName}结束辩论...`, disabled: true, icon: <Hourglass className="animate-pulse" size={20}/> };
            }
        } else {
            return { text: "辩论结束，申请判决", disabled: false, icon: <Gavel size={20}/> };
        }
    };
    
    const btnState = getButtonState();

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="bg-purple-50 border border-purple-200 p-6 rounded-xl text-center">
                <div className="inline-flex p-3 bg-white rounded-full mb-3 shadow-sm">
                    <Swords className="text-purple-600" size={32} />
                </div>
                <h2 className="text-xl font-bold text-purple-900 mb-2 font-cute">核心争议焦点辩论</h2>
                <p className="text-purple-700 text-sm">AI 已结合双方论述与案件事实，总结出以下核心辩论题。请针对每个问题进行回答。</p>
            </div>

            <div className="space-y-6">
                {data.disputePoints.map((point, index) => (
                    <div key={point.id} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <div className="flex items-center gap-3 mb-4 border-b border-slate-100 pb-3">
                            <span className="bg-slate-800 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0">
                                {index + 1}
                            </span>
                            <div>
                                <h3 className="font-bold text-slate-800 text-lg">{point.title}</h3>
                                <p className="text-slate-500 text-sm">{point.description}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-6">
                            {/* Plaintiff Side */}
                            <div className={`p-4 rounded-lg border-l-4 ${isPlaintiff ? 'bg-rose-50 border-rose-500' : 'bg-slate-50 border-slate-300'}`}>
                                <div className="flex items-center gap-2 mb-2 font-bold text-rose-700 text-sm">
                                    <User size={14} /> 原告观点
                                    {!isPlaintiff && !point.plaintiffArg && <span className="text-slate-400 font-normal ml-auto text-xs">等待输入...</span>}
                                </div>
                                {isPlaintiff ? (
                                    <VoiceTextarea 
                                        label=""
                                        placeholder="针对此问题（是/否），请陈述你的理由..."
                                        value={point.plaintiffArg || ""}
                                        onChange={(val) => handleArgUpdate(point.id, val)}
                                    />
                                ) : (
                                    <p className="text-sm text-slate-700 italic">{point.plaintiffArg || "暂无陈述"}</p>
                                )}
                            </div>

                            {/* Defendant Side */}
                            <div className={`p-4 rounded-lg border-l-4 ${isDefendant ? 'bg-indigo-50 border-indigo-500' : 'bg-slate-50 border-slate-300'}`}>
                                <div className="flex items-center gap-2 mb-2 font-bold text-indigo-700 text-sm">
                                    <User size={14} /> 被告观点
                                    {!isDefendant && !point.defendantArg && <span className="text-slate-400 font-normal ml-auto text-xs">等待输入...</span>}
                                </div>
                                {isDefendant ? (
                                    <VoiceTextarea 
                                        label=""
                                        placeholder="针对此问题（是/否），请陈述你的理由..."
                                        value={point.defendantArg || ""}
                                        onChange={(val) => handleArgUpdate(point.id, val)}
                                    />
                                ) : (
                                    <p className="text-sm text-slate-700 italic">{point.defendantArg || "暂无陈述"}</p>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-xl text-sm text-yellow-800 flex gap-2 items-start">
                <AlertOctagon className="shrink-0 mt-0.5" size={18}/>
                <p>辩论结束后，将直接提交给 AI 法官进行最终裁决。请确保已充分表达。</p>
            </div>

            <button 
                onClick={handleFinishDebate} 
                disabled={btnState.disabled}
                className={`w-full font-bold py-4 rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all ${
                   btnState.disabled 
                     ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200' 
                     : 'bg-slate-900 text-white hover:bg-black hover:scale-[1.01]'
                }`}
            >
                {btnState.icon} {btnState.text}
            </button>
        </div>
    );
};

const AdjudicationStep = ({ data, onSubmit }: { data: CaseData, onSubmit: (d: Partial<CaseData>) => Promise<void> | void }) => {
  const [persona, setPersona] = useState(data.judgePersona);
  const [isDeliberating, setIsDeliberating] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleJudgement = async () => {
    setIsDeliberating(true);
    setProgress(0);
    
    const timer = setInterval(() => {
      setProgress(old => {
        if (old >= 95) {
            return old < 99 ? old + 0.05 : 99;
        }
        return old + 0.4; 
      });
    }, 200);

    try {
      const verdict = await GeminiService.generateVerdict(
        data.category, data.description, data.demands, data.defenseStatement,
        data.evidence, data.defendantEvidence, 
        data.plaintiffRebuttal, data.plaintiffRebuttalEvidence, 
        data.defendantRebuttal || "", data.defendantRebuttalEvidence || [],
        data.disputePoints || [],
        persona
      );
      
      clearInterval(timer);
      setProgress(100);

      setTimeout(() => {
          onSubmit({ verdict, judgePersona: persona, status: CaseStatus.CLOSED });
      }, 500);
    } catch (e) { 
        clearInterval(timer);
        alert("AI 法官忙碌中: " + (e as any).message); 
        setIsDeliberating(false); 
        setProgress(0); 
    } 
  };

  const personas = [
    { 
      id: JudgePersona.BORDER_COLLIE, 
      name: "汪汪法官", 
      desc: "客观中立，理性判断，法理思维断案",
      icon: <Dog size={32} className="text-slate-800" />
    },
    { 
      id: JudgePersona.CAT, 
      name: "喵喵法官", 
      desc: "兼顾事实与情绪，治愈系中立判决",
      icon: <Cat size={32} className="text-rose-600" />
    }
  ];

  if (isDeliberating) {
    const isCat = persona === JudgePersona.CAT;
    return (
       <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 space-y-10 animate-fade-in">
          <div className="relative flex flex-col items-center justify-center mt-12 mb-12">
             <div className="relative z-10 transition-transform animate-reading-head">
                <div className="absolute -top-12 left-1/2 -translate-x-1/2 z-20 transform -rotate-6">
                    <GraduationCap size={64} className="text-slate-900 fill-slate-800 drop-shadow-md" strokeWidth={1.5} />
                </div>
                {isCat ? (
                   <Cat size={110} className="text-rose-500 drop-shadow-xl" strokeWidth={1.8} />
                ) : (
                   <Dog size={110} className="text-slate-800 drop-shadow-xl" strokeWidth={1.8} />
                )}
             </div>
          </div>

          <div className="text-center space-y-3 max-w-xs mx-auto">
             <h3 className="text-2xl font-bold text-slate-800 font-cute animate-pulse">
               AI 法官正在审理中...
             </h3>
             <p className="text-slate-500 font-medium">
               （预计 1分钟）
             </p>
          </div>

          <div className="w-full max-w-xs">
            <div className="bg-slate-100 h-3 rounded-full overflow-hidden shadow-inner border border-slate-200 mb-2">
               <div 
                 className="h-full rounded-full transition-all ease-linear duration-200"
                 style={{ 
                   width: `${progress}%`, 
                   backgroundColor: isCat ? '#fb7185' : '#475569'
                 }}
               ></div>
            </div>
            <div className="flex items-center justify-center gap-2 mt-2">
                <p className="text-xs text-slate-400 italic">正在查阅案卷与证据...</p>
                <span className={`text-xs font-bold ${isCat ? 'text-rose-500' : 'text-slate-500'}`}>{Math.floor(progress)}%</span>
            </div>
          </div>
       </div>
    )
  }

  return (
    <div className="p-4 space-y-6">
      <div className="text-center space-y-2 py-4">
        <Gavel size={48} className="text-slate-800 mx-auto" />
        <h2 className="text-2xl font-bold text-slate-800 font-cute">AI 法庭已开庭</h2>
        <p className="text-slate-500">请选择本案的主审法官风格</p>
      </div>
      
      <div className="grid gap-4">
        {personas.map(p => (
          <button 
            key={p.id} 
            onClick={() => setPersona(p.id)} 
            className={`flex items-center p-4 rounded-xl border-2 transition-all text-left group ${
              persona === p.id 
                ? 'border-rose-500 bg-rose-50 shadow-md scale-[1.02]' 
                : 'border-slate-200 bg-white hover:border-rose-200'
            }`}
          >
            <div className={`w-14 h-14 rounded-full flex items-center justify-center mr-4 transition-colors ${
              persona === p.id ? 'bg-white' : 'bg-slate-100 group-hover:bg-slate-50'
            }`}>
              {p.icon}
            </div>
            <div>
              <h3 className={`font-bold text-lg font-cute ${persona === p.id ? 'text-rose-700' : 'text-slate-800'}`}>
                {p.name}
              </h3>
              <p className={`text-xs ${persona === p.id ? 'text-rose-600' : 'text-slate-500'}`}>
                {p.desc}
              </p>
            </div>
          </button>
        ))}
      </div>

      <button onClick={handleJudgement} className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl shadow-xl flex justify-center items-center gap-2 mt-4 hover:scale-[1.01] transition-transform">
        <><Gavel size={20} /> 召唤 AI 判决</>
      </button>
    </div>
  );
};

const VerdictView = ({ verdict, persona, onReset, onAppeal }: { verdict: Verdict, persona: JudgePersona, onReset: () => void, onAppeal: () => void }) => {
  const isCat = persona === JudgePersona.CAT;
  const headerClass = isCat ? 'bg-rose-400' : 'bg-slate-800';
  
  const plaintiffTasks = verdict.penaltyTasks.filter(t => t.assignee === 'PLAINTIFF');
  const defendantTasks = verdict.penaltyTasks.filter(t => t.assignee === 'DEFENDANT');

  return (
    <div className="p-4 pb-20 space-y-6 animate-fade-in font-cute">
      <div className={`${headerClass} text-white p-8 rounded-t-3xl shadow-lg relative overflow-hidden transition-all duration-500`}>
        {/* Background Paws */}
        <PawPrint className="absolute -top-4 -right-4 text-white opacity-10 transform rotate-12" size={120} />
        <PawPrint className="absolute bottom-2 left-4 text-white opacity-10 transform -rotate-12" size={60} />
        <PawPrint className="absolute top-10 left-10 text-white opacity-5 transform rotate-45" size={40} />

        <div className="relative z-10 text-center">
          <div className="flex justify-center mb-4 mt-2">
             {isCat ? (
                <Cat size={100} className="text-white drop-shadow-2xl" strokeWidth={1.5} />
             ) : (
                <Dog size={100} className="text-white drop-shadow-2xl" strokeWidth={1.5} />
             )}
          </div>
          <h2 className="text-4xl mb-2 tracking-widest drop-shadow-md font-normal">判决书</h2>
          <div className="flex items-center justify-center gap-2 opacity-90 text-sm font-sans bg-black/10 mx-auto w-fit px-3 py-1 rounded-full">
            <PawPrint size={14} />
            <span>{isCat ? '猫猫法庭 · 喵呜裁决' : '边牧法庭 · 汪汪裁决'}</span>
            <PawPrint size={14} />
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-b-3xl shadow-xl -mt-6 border-x border-b border-slate-100 relative z-20">
         <div className="flex justify-between mb-2 text-lg font-bold uppercase font-sans">
            <span className="text-rose-500 flex items-center gap-1"><User size={18}/> 原告 {verdict.responsibilitySplit.plaintiff}%</span>
            <span className="text-indigo-500 flex items-center gap-1">被告 {verdict.responsibilitySplit.defendant}% <User size={18}/></span>
         </div>
         <div className="h-6 bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
            <div className="bg-rose-500 h-full flex items-center justify-center transition-all duration-1000" style={{ width: `${verdict.responsibilitySplit.plaintiff}%` }}></div>
            <div className="bg-indigo-500 h-full flex items-center justify-center transition-all duration-1000" style={{ width: `${verdict.responsibilitySplit.defendant}%` }}></div>
         </div>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border-2 border-slate-100 relative overflow-hidden">
        <h3 className="text-xl text-slate-800 mb-4 flex items-center gap-2">
            <CheckCircle2 className={isCat ? "text-rose-500" : "text-slate-800"} /> 
            事实认定
        </h3>
        <ul className="space-y-3 text-slate-600 font-sans">
            {verdict.facts.map((f, i) => (
                <li key={i} className="flex gap-2 items-start text-base">
                    <span className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                    <span style={{ fontFamily: '"Noto Sans SC", sans-serif' }}>{f}</span>
                </li>
            ))}
        </ul>
      </div>

      {verdict.disputeAnalyses && verdict.disputeAnalyses.length > 0 && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border-2 border-slate-100 relative overflow-hidden">
          <h3 className="text-xl text-slate-800 mb-4 flex items-center gap-2">
             <Scale className={isCat ? "text-rose-500" : "text-slate-800"} />
             争议焦点分析
          </h3>
          <div className="space-y-4 font-sans">
            {verdict.disputeAnalyses.map((item, idx) => (
              <div key={idx} className={`p-4 rounded-xl ${isCat ? 'bg-rose-50/50 border border-rose-100' : 'bg-slate-50 border border-slate-100'}`}>
                 <h4 className={`font-bold mb-2 ${isCat ? 'text-rose-700' : 'text-slate-700'}`} style={{ fontFamily: '"Noto Sans SC", sans-serif' }}>{item.title}</h4>
                 <p className="text-slate-600 text-base leading-relaxed" style={{ fontFamily: '"Noto Sans SC", sans-serif' }}>{item.analysis}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`${isCat ? 'bg-orange-50 border-orange-100' : 'bg-blue-50 border-blue-100'} p-6 rounded-2xl shadow-sm border-2 relative`}>
        <div className="absolute top-0 right-0 p-4 opacity-10">
            <Gavel size={80} className={isCat ? "text-orange-500" : "text-blue-500"} />
        </div>
        <h3 className={`text-xl mb-3 flex items-center gap-2 ${isCat ? 'text-orange-800' : 'text-blue-800'}`}>
            <Sparkles size={20} /> 法官寄语
        </h3>
        <div className={`text-lg leading-relaxed ${isCat ? 'text-orange-900' : 'text-slate-800'}`}>
            <MessageContent text={verdict.finalJudgment} />
        </div>
      </div>
      
      {(plaintiffTasks.length > 0 || defendantTasks.length > 0) && (
         <div className="bg-white p-6 rounded-2xl shadow-sm border-2 border-slate-100">
             <div className="flex items-center gap-2 mb-2">
                <Gamepad2 className="text-purple-500" size={24}/>
                <h3 className="text-xl text-slate-800 font-bold">
                    爱的破冰大冒险
                </h3>
             </div>
             <p className="text-xs text-slate-400 mb-4 ml-1">完成这些互动小挑战，让爱重新流动起来~</p>
             
             <div className="space-y-6">
                 {plaintiffTasks.length > 0 && (
                     <div className="bg-rose-50 rounded-xl p-4 border border-rose-100 relative overflow-hidden">
                         <div className="absolute -right-2 -bottom-2 text-rose-100 opacity-50 transform rotate-12">
                             <Heart size={60} />
                         </div>
                         <h4 className="font-bold text-rose-800 mb-3 flex items-center gap-2">
                             <User size={16} /> 原告请执行：
                         </h4>
                         <ul className="space-y-2">
                           {plaintiffTasks.map((t, i) => (
                             <li key={i} className="bg-white/80 p-3 rounded-lg text-slate-700 shadow-sm text-sm font-sans flex items-start gap-2 border border-rose-100/50">
                                <span className="text-rose-400 mt-0.5"><Gift size={14}/></span>
                                {t.content}
                             </li>
                           ))}
                         </ul>
                     </div>
                 )}

                 {defendantTasks.length > 0 && (
                     <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100 relative overflow-hidden">
                         <div className="absolute -right-2 -bottom-2 text-indigo-100 opacity-50 transform rotate-12">
                             <Gamepad2 size={60} />
                         </div>
                         <h4 className="font-bold text-indigo-800 mb-3 flex items-center gap-2">
                             <User size={16} /> 被告请执行：
                         </h4>
                         <ul className="space-y-2">
                           {defendantTasks.map((t, i) => (
                             <li key={i} className="bg-white/80 p-3 rounded-lg text-slate-700 shadow-sm text-sm font-sans flex items-start gap-2 border border-indigo-100/50">
                                <span className="text-indigo-400 mt-0.5"><Gift size={14}/></span>
                                {t.content}
                             </li>
                           ))}
                         </ul>
                     </div>
                 )}
             </div>
         </div>
      )}

      <div className="space-y-3 pt-2 font-sans">
        <button onClick={onReset} className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl">结案，新案件</button>
        <button onClick={onAppeal} className="w-full bg-white text-rose-600 border-2 border-rose-100 font-bold py-3 rounded-xl">不服判决？换法官重审</button>
      </div>
    </div>
  )
};

const CaseManager = ({ caseId, user, onBack, onSwitchUser }: { caseId: string, user: string, onBack: () => void, onSwitchUser: () => void }) => {
  const [data, setData] = useState<CaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDefaultJudgmentConfirm, setShowDefaultJudgmentConfirm] = useState(false);
  
  const lastActionTimeRef = useRef<number>(0);

  const load = async () => {
    if (Date.now() - lastActionTimeRef.current < 5000) {
        return;
    }

    const c = await MockDb.syncCaseFromCloud(caseId);
    if (c) setData(c);
    setLoading(false);
  };

  useEffect(() => { 
      load(); 
      
      const channel = supabase
        .channel('schema-db-changes')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'cases',
            filter: `share_code=eq.${caseId}`,
          },
          (payload) => {
            console.log('Realtime update received!', payload);
            load();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
  }, [caseId]);

  const update = async (patch: Partial<CaseData>) => {
    if (!data) return;
    lastActionTimeRef.current = Date.now();
    const updated = await MockDb.updateCase(data.id, patch);
    setData(updated);
  };

  const handleDefaultJudgment = () => {
    update({ 
      defenseStatement: "（被告缺席，放弃答辩）",
      defenseSummary: "被告未出庭应诉，视为放弃答辩权利。",
      status: CaseStatus.ADJUDICATING,
      disputePoints: [] 
    });
    setShowDefaultJudgmentConfirm(false);
  };

  if (loading || !data) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-rose-600" /></div>;

  const isPlaintiff = user === data.plaintiffId;
  const isDefendant = user === data.defendantId;
  const role = isPlaintiff ? UserRole.PLAINTIFF : isDefendant ? UserRole.DEFENDANT : UserRole.SPECTATOR;

  const handleStepBack = () => {
    if (!data) {
      onBack();
      return;
    }

    if (data.status === CaseStatus.DRAFTING) {
        onBack();
        return;
    }

    if (isPlaintiff && data.status === CaseStatus.PLAINTIFF_EVIDENCE) {
      update({ status: CaseStatus.DRAFTING });
      return;
    }

    if (data.status === CaseStatus.DEFENSE_PENDING) {
        if (isPlaintiff) {
            update({ status: CaseStatus.PLAINTIFF_EVIDENCE });
            return;
        }
        onBack();
        return;
    }

    if (data.status === CaseStatus.CROSS_EXAMINATION) {
        update({ status: CaseStatus.DEFENSE_PENDING });
        return;
    }

    if (data.status === CaseStatus.DEBATE) {
        // Unconditionally reset both user flags when stepping back from DEBATE to CROSS_EXAMINATION.
        // This ensures that re-entering DEBATE requires explicit confirmation ("Finish") from BOTH parties again.
        // This also fixes the bug where users could get stuck in "Both sides finished" state without transitioning.
        update({ 
            status: CaseStatus.CROSS_EXAMINATION,
            plaintiffFinishedDebate: false,
            defendantFinishedDebate: false,
            plaintiffFinishedCrossExam: false,
            defendantFinishedCrossExam: false
        });
        return;
    }

    if (data.status === CaseStatus.ADJUDICATING) {
        if (data.defenseStatement === "（被告缺席，放弃答辩）") {
             update({ 
                 status: CaseStatus.DEFENSE_PENDING,
                 defenseStatement: "", 
                 defenseSummary: undefined 
             });
             return;
        }

        update({ 
            status: CaseStatus.DEBATE,
            disputePoints: data.disputePoints,
            // Reset flags so they can debate again
            plaintiffFinishedDebate: false,
            defendantFinishedDebate: false
        });
        return;
    }

    onBack();
  };

  let content = null;
  let title = "";

  const Waiting = ({ msg }: { msg: string }) => (
    <div className="flex flex-col items-center justify-center py-12 text-center px-6">
      <div className="bg-slate-100 p-4 rounded-full mb-4 animate-pulse"><Users size={32} className="text-slate-400" /></div>
      <h3 className="text-lg font-bold text-slate-700 mb-2">{msg}</h3>
      <p className="text-sm text-slate-500 mb-6">您可以刷新页面或稍后回来。</p>
      <button onClick={load} className="flex items-center gap-2 text-rose-600 font-bold bg-white px-4 py-2 rounded-full shadow-sm border border-rose-100"><RefreshCw size={16} /> 刷新状态</button>
    </div>
  );

  switch (data.status) {
    case CaseStatus.DRAFTING:
      title = "原告起诉";
      content = isPlaintiff ? <FilingForm data={data} onSubmit={update} /> : <Waiting msg="等待原告填写起诉状..." />;
      break;
    case CaseStatus.PLAINTIFF_EVIDENCE:
      title = "原告举证";
      content = isPlaintiff ? <PlaintiffEvidenceStep data={data} onSubmit={update} /> : <Waiting msg="等待原告提交证据..." />;
      break;
    case CaseStatus.DEFENSE_PENDING:
      title = "被告答辩";
      if (isDefendant) {
        content = <DefenseStep data={data} onSubmit={update} />;
      } else {
        const isWaitingForJoin = !data.defendantId;
        const msg = isWaitingForJoin 
          ? `等待被告加入... 案件码: ${data.shareCode}` 
          : "等待被告提交答辩...";
        
        content = (
          <div className="flex flex-col gap-6">
            <Waiting msg={msg} />
            {isPlaintiff && (
              <div className="mt-8 relative">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-slate-200"></div>
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-slate-50 px-4 text-xs text-slate-400">
                    {isWaitingForJoin ? "被告一直不加入？" : "被告一直不回应？"}
                  </span>
                </div>
              </div>
            )}
            {isPlaintiff && (
               <div className="mt-2 flex justify-center">
                <button 
                  onClick={() => setShowDefaultJudgmentConfirm(true)}
                  className="group relative flex items-center gap-2 px-6 py-3 rounded-full bg-white border-2 border-slate-200 text-slate-600 font-bold text-sm shadow-sm hover:border-rose-400 hover:text-rose-600 hover:shadow-md transition-all active:scale-95"
                >
                  <div className="p-1 bg-slate-100 rounded-full group-hover:bg-rose-100 transition-colors">
                      <UserX size={14} className="text-slate-500 group-hover:text-rose-500" />
                  </div>
                  申请缺席判决
                </button>
              </div>
            )}
          </div>
        );
      }
      break;
    case CaseStatus.CROSS_EXAMINATION: 
      title = "质证环节";
      content = <VerdictSection data={data} onSubmit={update} role={role} />;
      break;
    case CaseStatus.DEBATE: 
      title = "争议焦点辩论";
      content = <DisputeDebateStep data={data} onSubmit={update} userRole={role} />;
      break;
    case CaseStatus.ADJUDICATING:
      title = "AI 审理中";
      content = (isPlaintiff || isDefendant) ? <AdjudicationStep data={data} onSubmit={update} /> : <Waiting msg="法官正在审理..." />;
      break;
    case CaseStatus.CLOSED:
      title = "最终判决";
      content = <VerdictView 
        verdict={data.verdict!} 
        persona={data.judgePersona} 
        onReset={() => onBack()} 
        onAppeal={() => {
            update({ 
                status: CaseStatus.ADJUDICATING,
                disputePoints: data.disputePoints
            });
        }} 
      />;
      break;
    case CaseStatus.CANCELLED:
      title = "已撤诉";
      content = <div className="text-center p-8 text-slate-500">案件已撤销</div>;
      break;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <ConfirmDialog 
        isOpen={showDefaultJudgmentConfirm}
        title="缺席判决确认"
        message="是否要在被告不在场的情况下进行判决？这将跳过后续所有互动环节，直接由 AI 法官根据您单方面的陈述进行裁决。"
        confirmText="是"
        cancelText="否"
        onConfirm={handleDefaultJudgment}
        onCancel={() => setShowDefaultJudgmentConfirm(false)}
      />

      <header className="bg-rose-600 text-white p-4 sticky top-0 z-50 shadow-md flex justify-between items-center">
        <div className="flex items-center gap-2">
          <button onClick={handleStepBack}><ChevronLeft /></button>
          <span className="font-bold font-cute">{title}</span>
        </div>
        <div className="flex items-center gap-3">
           <button onClick={onBack} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-all" title="返回首页">
              <Home size={20} />
           </button>
           {data.status !== CaseStatus.CLOSED && data.status !== CaseStatus.CANCELLED && (
             <div className="bg-rose-700 px-2 py-1 rounded text-xs flex items-center gap-1 cursor-pointer" onClick={() => {navigator.clipboard.writeText(data.shareCode); alert("已复制");}}>
               <Copy size={12}/> 码: {data.shareCode}
             </div>
           )}
           <button onClick={onSwitchUser} className="text-xs bg-white text-rose-600 px-2 py-1 rounded font-bold">切换账号</button>
        </div>
      </header>
      <main className="flex-1 max-w-2xl mx-auto w-full p-4">{content}</main>
    </div>
  );
};

const App = () => {
  const [user, setUser] = useState<{ id: string, name: string } | null>(null);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [myCases, setMyCases] = useState<CaseData[]>([]);
  const [caseToDelete, setCaseToDelete] = useState<string | null>(null);

  // Auth Listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        // Try metadata first, then email, then ID
        const name = session.user.user_metadata?.username || session.user.email?.split('@')[0] || "User";
        setUser({ id: session.user.id, name: name });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const name = session.user.user_metadata?.username || session.user.email?.split('@')[0] || "User";
        setUser({ id: session.user.id, name: name });
      } else {
        setUser(null);
        setActiveCaseId(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load cases
  useEffect(() => {
    if (user) {
      const cases = MockDb.getCasesForUser(user.id);
      setMyCases(cases);
      
      const interval = setInterval(() => {
         const updated = MockDb.getCasesForUser(user.id);
         setMyCases(updated);
      }, 3000); // Poll for updates in list view
      return () => clearInterval(interval);
    }
  }, [user, activeCaseId]);

  const handleCreateCase = async () => {
    if (!user) return;
    const newCase = await MockDb.createCase(user.id);
    setActiveCaseId(newCase.id);
  };

  const handleJoinCase = async () => {
    if (!user || !joinCode) return;
    setIsJoining(true);
    const result = await MockDb.joinCase(joinCode, user.id);
    setIsJoining(false);
    if (result.success && result.caseId) {
      setActiveCaseId(result.caseId);
    } else {
      alert(result.error || "加入失败");
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const confirmDeleteCase = async () => {
      if (caseToDelete) {
          MockDb.deleteCase(caseToDelete);
          setMyCases(prev => prev.filter(c => c.id !== caseToDelete));
          setCaseToDelete(null);
      }
  };

  if (!user) {
    return <Auth onLoginFallback={(name) => setUser({ id: name, name })} />;
  }

  if (activeCaseId) {
    return (
      <CaseManager 
        caseId={activeCaseId} 
        user={user.id} 
        onBack={() => setActiveCaseId(null)}
        onSwitchUser={handleLogout}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 flex flex-col items-center animate-fade-in">
        <ConfirmDialog 
            isOpen={!!caseToDelete}
            title="删除案件"
            message="确定要删除这个案件记录吗？此操作无法撤销。"
            onConfirm={confirmDeleteCase}
            onCancel={() => setCaseToDelete(null)}
        />
        <div className="w-full max-w-md flex justify-between items-center mb-8">
            <div className="flex items-center gap-3">
                <div className="bg-gradient-to-br from-rose-100 to-pink-100 p-2 rounded-full border border-rose-200">
                    <User className="text-rose-600" size={24} />
                </div>
                <div>
                    <h1 className="font-bold text-slate-800 text-lg">你好, {user.name}</h1>
                    <p className="text-xs text-slate-500 flex items-center gap-1">
                       <Heart size={10} className="fill-rose-300 text-rose-300" /> 
                       今天也是充满爱的一天
                    </p>
                </div>
            </div>
            <button 
                onClick={handleLogout} 
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
                title="退出登录"
            >
                <LogOut size={20} />
            </button>
        </div>

        <div className="w-full max-w-md space-y-5 mb-8">
            <button 
                onClick={handleCreateCase}
                className="w-full bg-gradient-to-r from-rose-500 to-pink-600 text-white p-6 rounded-3xl shadow-xl shadow-rose-200 hover:scale-[1.02] transition-transform flex items-center justify-between group relative overflow-hidden"
            >
                <div className="absolute top-0 right-0 p-8 opacity-10">
                   <Gavel size={100} className="text-white transform rotate-12" />
                </div>
                <div className="text-left relative z-10">
                    <h2 className="text-2xl font-bold flex items-center gap-2 mb-1"><PlusCircle className="fill-white/20" /> 我要起诉</h2>
                    <p className="text-rose-100 text-sm font-medium">发起一个新的案件，邀请对方加入</p>
                </div>
                <div className="bg-white/20 p-2 rounded-full relative z-10">
                    <ArrowRight className="group-hover:translate-x-1 transition-transform" />
                </div>
            </button>

            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                <h2 className="font-bold text-slate-800 mb-4 flex items-center gap-2 text-lg">
                    <Users className="text-indigo-500" /> 被告应诉
                </h2>
                <div className="flex flex-col gap-3">
                    <input 
                        value={joinCode}
                        onChange={e => setJoinCode(e.target.value)}
                        placeholder="输入 6 位案件码"
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3 outline-none focus:ring-2 focus:ring-indigo-200 uppercase tracking-widest font-mono text-lg text-center font-bold text-slate-700 placeholder:font-normal placeholder:tracking-normal placeholder:text-sm"
                        maxLength={6}
                    />
                    <button 
                        onClick={handleJoinCase}
                        disabled={isJoining || joinCode.length < 6}
                        className="w-full bg-indigo-600 text-white py-3 rounded-2xl font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 flex justify-center items-center"
                    >
                        {isJoining ? <Loader2 className="animate-spin" /> : "应诉"}
                    </button>
                </div>
            </div>
        </div>

        <div className="w-full max-w-md flex-1">
            <h3 className="font-bold text-slate-400 mb-4 text-xs uppercase tracking-wider flex items-center gap-2">
                <div className="h-px bg-slate-200 flex-1"></div>
                我的案件记录
                <div className="h-px bg-slate-200 flex-1"></div>
            </h3>
            <div className="space-y-3 pb-10">
                {myCases.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 bg-white rounded-3xl border border-slate-100 border-dashed">
                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3">
                            <Gavel size={32} className="text-slate-300" />
                        </div>
                        <p className="font-medium">暂无记录</p>
                        <p className="text-xs mt-1 text-slate-300">发起的案件将显示在这里</p>
                    </div>
                ) : (
                    myCases.map(c => {
                         const isMyCase = c.plaintiffId === user.id;
                         return (
                            <div 
                                key={c.id} 
                                onClick={() => setActiveCaseId(c.id)}
                                className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-pointer group active:scale-[0.98] relative overflow-hidden"
                            >
                                <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${c.status === CaseStatus.CLOSED ? 'bg-slate-300' : (isMyCase ? 'bg-rose-500' : 'bg-indigo-500')}`}></div>
                                <div className="flex justify-between items-start mb-2 pl-2">
                                    <div className="flex gap-2 items-center">
                                        <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${isMyCase ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-600'}`}>
                                            {isMyCase ? '我起诉' : '我应诉'}
                                        </span>
                                        <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${
                                            c.status === CaseStatus.CLOSED ? 'bg-slate-100 text-slate-500' : 
                                            c.status === CaseStatus.ADJUDICATING ? 'bg-purple-100 text-purple-600' :
                                            c.status === CaseStatus.CANCELLED ? 'bg-red-50 text-red-400' :
                                            'bg-green-100 text-green-600'
                                        }`}>
                                            {(() => {
                                                switch (c.status) {
                                                    case CaseStatus.DRAFTING: return '原告起诉';
                                                    case CaseStatus.PLAINTIFF_EVIDENCE: return '原告举证';
                                                    case CaseStatus.DEFENSE_PENDING: return '被告答辩';
                                                    case CaseStatus.CROSS_EXAMINATION: return '质证中';
                                                    case CaseStatus.DEBATE: return '辩论中';
                                                    case CaseStatus.ADJUDICATING: return 'AI审理中';
                                                    case CaseStatus.CLOSED: return '已结案';
                                                    case CaseStatus.CANCELLED: return '已撤诉';
                                                    default: return '进行中';
                                                }
                                            })()}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-slate-400 font-mono bg-slate-50 px-2 py-1 rounded-full">{new Date(c.lastUpdateDate).toLocaleDateString()}</span>
                                        {isMyCase && (
                                            <button 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setCaseToDelete(c.id);
                                                }}
                                                className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-full transition-colors"
                                                title="删除案件"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="pl-2">
                                    <h4 className="font-bold text-slate-800 mb-1 group-hover:text-rose-600 transition-colors line-clamp-1 text-lg">
                                        {c.title || (c.description ? c.description.slice(0, 15) + "..." : "未命名案件")}
                                    </h4>
                                    <p className="text-xs text-slate-500 line-clamp-1">
                                        {c.plaintiffSummary || c.description || "暂无摘要"}
                                    </p>
                                </div>
                            </div>
                         )
                    })
                )}
            </div>
        </div>
    </div>
  );
};

export default App;