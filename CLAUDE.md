# Reusable AI workflow agent

This project contains a user-facing frontend and a backend agent. The frontend calls the agent to run reusable workflow skills. We will add more skills later.

The first skill is **Project Manager**. It turns a meeting transcript into:

- a concise project update
- action items with an assignee
- due dates only when explicitly stated
- missing information clearly marked
- proposed actions for human approval

## Working rules

- Read the README and existing code before changing anything.
- Separate facts, assumptions and recommendations.
- Never invent owners, dates, decisions or project status.
- Keep each workflow modular so more skills can be added later.
- Preserve the existing frontend, backend, database and Docker structure.
- Show proposed external changes before writing to any project-management tool.
- Ask for approval before sending, publishing or changing external systems.
- Never expose secrets.
