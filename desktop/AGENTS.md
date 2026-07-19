# Codex to Antigravity Handoff

## Roles

- Codex is the planner for software changes in this workspace.
- Antigravity is the default implementation agent.
- Unless the user explicitly asks Codex itself to implement, Codex must inspect the repository, prepare the implementation plan, and stop before editing product code.
- Documentation or configuration needed to maintain this handoff protocol may be edited directly by Codex.

## Creating the handoff plan

For a feature, fix, refactor, or other code change requested from Codex:

1. Explore enough of the repository to make the plan executable without another design interview.
2. Create or replace `implementation_plan.md` in the workspace root.
3. Use this YAML frontmatter exactly, filling in the timestamp with an ISO-8601 value:

   ```yaml
   ---
   handoff_version: 1
   status: ready
   executor: antigravity
   created_by: codex
   updated_at: <ISO-8601 timestamp>
   ---
   ```

4. Include these sections: Objective, Current Behavior, Scope, Implementation Tasks, Verification, Acceptance Criteria, and Constraints/Risks.
5. In Implementation Tasks, name concrete files and describe the intended changes in dependency order. Do not use vague placeholders such as "update as needed".
6. In Verification, include exact commands when they can be determined from the repository.
7. Tell the user that the plan is ready and that sending `hadi` or `.` in Antigravity will execute it.

Do not mark a plan `completed`; only the executor does that after verification. A new user request may replace an old `completed` or `blocked` plan, but Codex must not silently replace a currently `ready` or `in_progress` plan unless the user asks for a new plan.

## Repair planning

If Antigravity marks the plan `blocked`, read the Failure Report and the actual repository state. Produce a revised, decision-complete repair plan in the same file, preserve useful failure evidence, increment `handoff_version`, and set `status: ready` again.

