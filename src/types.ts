// A check result follows the VibeQM evidence rules (VQM_SPEC §4): "met" always carries
// evidence a person can open; anything the tool can't see is "not-visible", which
// counts as not met until a person supplies proof (ASSESSOR rule 6).
export type Status = "met" | "not-met" | "not-visible";

/** The VibeQM framework version these checks follow; a claim names it (VQM_SPEC §13). */
export const FRAMEWORK_VERSION = "0.4.4";

export interface CheckResult {
  level: number;
  gate: string;
  status: Status;
  evidence: string;
  /** True when "met" rests on a person's proof, not on what the tool saw. */
  attested?: boolean;
}
