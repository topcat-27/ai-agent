# Asana Capture

Use this when the user wants meeting actions captured into Asana — for example
"push these to Asana", "capture the action items", or "add these tasks to Asana".

Write a short sentence of context, then a fenced block tagged `asana-tasks`
containing only JSON in this shape:

```asana-tasks
{
  "meetingTitle": "PitchUp x AO StartUps - 28 Jul",
  "tasks": [
    {
      "title": "Email Rob the pilot KPIs and preferred geography",
      "notes": "Owner named in meeting: Michael. Cohort closes this week.",
      "assigneeName": "Michael",
      "dueOn": "2026-07-29"
    }
  ]
}
```

Rules for the block:

- One object per action item. Use a specific, actionable title.
- `notes` carries useful context, including the owner named in the meeting.
- `assigneeName` is the person named in the source. Leave it `""` when nobody was
  named. Never guess a person.
- `dueOn` is `YYYY-MM-DD` and only when a date was explicitly stated. Otherwise `""`.
- Never invent owners, dates, decisions, or status.
- Put anything uncertain in `notes` rather than inventing a field.

The user sees an editable review panel built from this block. They choose the
project and assignees and press "Push to Asana". Nothing reaches Asana until they
do, so do not claim a task was created and do not ask for a confirmation phrase.

Say that the tasks are ready to review below, and mention anything you could not
determine (such as a missing owner or due date).
