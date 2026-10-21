# Requirements

Every change starts from a written requirement, and names it.

- **What the tool must do** is the fact checks of the VibeQM assessment procedure,
  `framework/ASSESSOR.md` §2 in the companion repository
  ([vibeqm/vqm](https://github.com/vibeqm/vqm)), for the version of the Vibe Quality
  Model the tool implements (v0.4). A check the procedure does not define is not added.
- **What the tool must never do:** change an existing file in the repository it reads
  (the only file it writes is a report the person asks for, with `--out`), send
  anything to us, or report a gate as met without evidence a person can open.
  Whatever it can't see is "not visible", never "met".
- **Traceability, light:** each commit message names the check or the requirement it
  serves; each check has tests and an entry in `src/fixes.ts`.
