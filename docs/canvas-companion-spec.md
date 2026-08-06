# Canvas Companion Specification

**Status: specification only. Nothing described in this document is implemented.** No Canvas
OAuth flow, no Canvas API integration, and no notification system exist in the app today. This
document exists to remove architectural ambiguity before implementation begins.

**Interval is not officially affiliated with Canvas or Instructure.** Nothing in this document, or
any future implementation of it, should claim or imply institutional endorsement, partnership, or
certification. School-specific Canvas developer-key requirements may apply and are outside
Interval's control — some institutions may not permit third-party OAuth access to their Canvas
instance at all, and this specification cannot assume otherwise for every school a future user
might attend.

## Purpose

**The purpose is not to replace Canvas.** Canvas remains the system of record for courses,
assignments, and grades. The goal of a Canvas companion is narrower and more modest: **improve
preparation and reminders where students may overlook approaching deadlines**, by surfacing
already-authorized Canvas information inside the app a student is already using to study.

This is a read-only companion, not a course-management tool.

## Initial potential data

- Active courses
- Assignment title
- Assignment description, where authorized
- Due date
- Availability date
- Course name
- Assignment type
- Submission/completion status, where authorized and useful
- Quiz/exam calendar items
- Upcoming planner items

"Where authorized" matters throughout this document — Canvas's own permission model determines
what's actually visible to a given OAuth grant, and this specification assumes only what a
reasonable, standard read-only grant would expose, not special access.

## First product experience

1. User explicitly connects Canvas (an intentional action, never a default-on or assumed
   connection).
2. Interval displays the courses that connection is authorized to see.
3. User chooses which of those courses to actually follow in Interval — connecting Canvas does
   not mean every course automatically starts generating reminders.
4. Interval presents upcoming work for followed courses.
5. Interval summarizes assignment metadata and descriptions in plain language.
6. Interval provides supportive reminders (see "Reminder tone" below).
7. User may connect an assignment to Library sources (see
   `docs/library-and-source-architecture.md`) — e.g. "this Calculus exam relates to these three
   sources in my Library."
8. Interval may later suggest a study plan, informed by the assignment's due date and connected
   sources.
9. Any generated study material still requires Review & Approve — a Canvas-derived assignment
   description is not an exemption from the AI generation contract in
   `docs/library-and-source-architecture.md` §10.

## Reminder tone

### Tone requirements

- Supportive
- Calm
- Encouraging
- Not childish
- Not shaming
- Not alarmist
- Not excessively frequent
- User-configurable
- Actionable

### Example reminders

- "Your Calculus exam is coming up in two weeks on August 28. Let's start getting ready."
- "One week until Calculus. A few focused sessions now can make a difference."
- "Your Database project is due in three days. Let's make a manageable plan."
- "You have an assignment due tomorrow. Ready for a quick review?"

Every reminder should read like something a supportive study partner would say, not an
institutional deadline notice.

### Every reminder should lead somewhere useful

A reminder that doesn't lead anywhere actionable is just anxiety with extra steps. Every reminder
should offer at least one of:

- View assignment
- Open course collection
- Choose Library sources
- Start review
- Create study plan
- Snooze
- Mark handled
- Disable this reminder

## Canvas trust and institutional boundary

- **Read-only integration.** No write access to Canvas is requested or used.
- **User-authorized access only**, via Canvas's own OAuth flow.
- **No password collection.** Interval never sees or stores a user's Canvas password — OAuth
  means Interval never has it in the first place.
- **No assignment submission.** Interval never submits anything to Canvas on the user's behalf.
- **No grade modification.** Interval never writes to Canvas grades, ever.
- **No discussion posting.** Interval never posts to Canvas discussions.
- **No automatic completion.** Interval never marks anything complete in Canvas.
- **No exam-time assistance.** This companion is about preparation before work is due, not
  assistance during an active, timed Canvas quiz or exam.
- **No hidden data collection.** Whatever Canvas data Interval reads is exactly what this document
  (and its eventual in-app disclosure) says it reads — nothing additional, nothing undisclosed.
- **No access beyond granted permissions.** Interval only ever sees what the user's OAuth grant
  and Canvas's own permission model actually expose.
- **No institutional approval is claimed.** Connecting Canvas is a user's own individual action;
  it is not, and must never be described as, an institutional partnership or approval.
- **School-specific Canvas developer-key requirements may apply**, and are outside Interval's
  control — some institutions restrict third-party OAuth integrations entirely.
- **The user must be able to disconnect** Canvas at any time, cleanly.
- **Token revocation must be supported** — disconnecting should actually revoke Interval's access
  token, not just stop displaying data locally.
- **Data deletion expectations**: disconnecting (or deleting the account) should remove cached
  Canvas-derived data, consistent with the same honest deletion standard used elsewhere in this
  app (see the existing account-deletion flow's "request-based, human-verified" model, and
  `docs/library-and-source-architecture.md` §11's deletion-propagation principle).
- **Notification preferences** are user-controlled (see "Notification architecture" below).
- **Course-selection control**: the user decides which authorized courses actually generate
  reminders, not just which courses they're technically authorized to see.

## Notification architecture

No notification system is implemented by this document. This section defines the requirements for
whenever one is built.

### Reminder intervals

Two weeks, one week, three days, one day, and same-day are all plausible touchpoints — but this
should **not** be a rigid, universal, one-size-fits-all schedule applied identically to every
assignment for every user. An exam and a small weekly homework assignment don't deserve the same
reminder cadence.

### Requirements

- User-configurable notification timing (which intervals actually fire, not just how many).
- Quiet hours — a user should never expect a study reminder to arrive at 3 AM by default.
- Per-course controls — a user may want reminders for one class and not another.
- Assignment-type controls — e.g. exams might warrant earlier/more reminders than routine
  homework.
- Duplicate prevention — the same assignment should not generate redundant reminders across
  overlapping trigger windows.
- Timezone correctness — due dates and reminder timing must respect the user's actual timezone,
  not a server default.
- Handling changes to due dates — if Canvas shows a due date moved, previously-scheduled
  reminders need to move with it, not fire against a stale date.
- Handling canceled assignments — a canceled assignment's reminders should be canceled too, not
  fire for something that no longer exists.
- Handling submitted/completed work — once Canvas shows something submitted or complete, further
  reminders for it should stop.
- Snooze — a user should be able to push a reminder back without disabling it entirely.
- Notification deep links — tapping a reminder should take the user somewhere useful (the
  assignment, the course collection, a study plan), not just open the app generically.
- Opt-in behavior — Canvas notifications are off until a user explicitly connects Canvas and
  enables them; connecting Canvas alone should not silently enable a notification stream.
- Accessibility of notification text — concise, plain language, no information conveyed only
  through an emoji or icon with no textual equivalent.
- Localization — English and Spanish, same as every other user-facing string in this app.
- **No sensitive document content in lock-screen notifications by default** — a reminder should
  say "Your Calculus exam is coming up," not preview private assignment or source content on a
  potentially-visible-to-others lock screen.
