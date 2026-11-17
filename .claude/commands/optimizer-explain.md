# /optimizer-explain

Explain how the OR optimizer works end-to-end, from API request to assignment result.

## Steps

1. Read the current state of these files:
   - `optimizer/src/optimizer/models/` (notably `project.py`, `assignment.py`, `coverage.py`)
   - `optimizer/src/optimizer/domain/solver.py`
   - `optimizer/src/optimizer/adapters/pulp_solver.py`
   - `optimizer/src/optimizer/objectives.py`
   - `optimizer/src/optimizer/constraints.py`
   - `optimizer/src/optimizer/availability.py`
   - `backend/src/api/v1/optimization.py`

2. Produce a structured explanation covering:
   - **Input**: what data the solver receives and where it comes from. A `ProjectInput` holds only phases (at least one); each phase carries its own skill requirements and optional date range.
   - **Objectives**: each scoring dimension (performance, chemistry, growth, cost) and how it is computed.
   - **Constraints**: what rules are enforced (per-skill FTE and minimum level, `max_people`, availability on the phase's dates, etc.).
   - **Algorithm**: which OR technique is used and why.
   - **Output**: the shape of `AssignmentResult` (members and coverage tagged by `phase_id`) and how the final score is derived.

3. Keep the explanation concise — use bullet points and short paragraphs, not walls of text.
4. If the user passes a specific term (e.g., `/optimizer-explain chemistry`), focus only on that dimension.
