// A check result follows the VibeQM evidence rules (VQM_SPEC §4): "met" always carries
// evidence a person can open; anything the tool can't see is "not-visible", which
// counts as not met until a person supplies proof (ASSESSOR rule 6). "in-place" is a
// gate whose practice is set up and recorded but measured over use (peer review needs
// 20 reviewed changes): it counts as not met for the level, and the result says how far
// along it is, so the person sees the delivery date instead of a flat refusal (VQM_SPEC §13).
export type Status = "met" | "not-met" | "not-visible" | "in-place";

/** The VibeQM framework version these checks follow; a claim names it (VQM_SPEC §13). */
export const FRAMEWORK_VERSION = "0.4.7";

export interface CheckResult {
  level: number;
  gate: string;
  status: Status;
  evidence: string;
  /** True when "met" rests on a person's proof, not on what the tool saw. */
  attested?: boolean;
  /** For "in-place": how much of the use the gate needs has happened, and in what unit. */
  progress?: { done: number; needed: number; unit: string };
}
