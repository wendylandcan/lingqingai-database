import { CaseData } from "../types";

const stableEvidenceSignature = (items: CaseData["evidence"]) => {
  return items
    .map((e) =>
      [
        e.id,
        e.type,
        e.description || "",
        e.content || "",
        e.isContested ? "1" : "0",
        e.submittedBy || "",
      ].join("::")
    )
    .join("||");
};

const stableDisputeSignature = (points: CaseData["disputePoints"]) => {
  return points
    .map((p) =>
      [
        p.id,
        p.title || "",
        p.description || "",
        p.plaintiffArg || "",
        p.defendantArg || "",
      ].join("::")
    )
    .join("||");
};

export const buildDebateInputHash = (data: CaseData): string => {
  const relevant = {
    description: data.description || "",
    demands: data.demands || "",
    defenseStatement: data.defenseStatement || "",
    plaintiffRebuttal: data.plaintiffRebuttal || "",
    defendantRebuttal: data.defendantRebuttal || "",
    evidence: stableEvidenceSignature(data.evidence || []),
    defendantEvidence: stableEvidenceSignature(data.defendantEvidence || []),
    plaintiffRebuttalEvidence: stableEvidenceSignature(data.plaintiffRebuttalEvidence || []),
    defendantRebuttalEvidence: stableEvidenceSignature(data.defendantRebuttalEvidence || []),
  };

  return JSON.stringify(relevant);
};

export const buildVerdictInputHash = (data: CaseData): string => {
  const relevant = {
    debateHash: buildDebateInputHash(data),
    disputePoints: stableDisputeSignature(data.disputePoints || []),
  };

  return JSON.stringify(relevant);
};
