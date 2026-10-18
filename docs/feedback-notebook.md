# Dibia feedback notebook

The Feedback button is added to the HMS and Console route trees. HMS visibility is limited to the two reviewer email addresses `olawoyinabdulsalam202@gmail.com` and `iezediba@gmail.com`, plus staff in the explicitly configured reviewer hospital. Console visibility is limited to signed-in platform administrators. Set `VITE_FEEDBACK_ENABLED=false` to disable the feature.

## Configure reviewers

Set these build-time variables for the HMS Vercel project:

```env
VITE_FEEDBACK_ENABLED=true
VITE_FEEDBACK_REVIEWER_EMAILS=olawoyinabdulsalam202@gmail.com,iezediba@gmail.com
VITE_FEEDBACK_HOSPITAL_ID=your-review-hospital-id
VITE_FEEDBACK_DEMO_REVIEW_MODE=false
VITE_FEEDBACK_PUBLIC_REVIEW=false
VITE_APP_BUILD=your-deployed-build-id
```

`VITE_FEEDBACK_HOSPITAL_ID` enables the button for authenticated staff in that one facility. Leave it empty to show HMS feedback only to the two listed addresses. `VITE_FEEDBACK_DEMO_REVIEW_MODE=true` shares the browser notebook between the allowed reviewers while preserving each note's captured role. Public unauthenticated review is off unless `VITE_FEEDBACK_PUBLIC_REVIEW=true`; public notes are browser-only. `VITE_APP_BUILD` should identify the build being reviewed. Rebuild and deploy after changing these values.

In the Console project, `VITE_FEEDBACK_ENABLED=true` controls the notebook. The Console session is validated by the backend platform-admin guard.

## Where reports are stored

Unsent notes, drafts, search preferences and update-review markers are stored in browser local storage, separated by app and reviewer. They survive navigation, refreshes and browser restarts in that browser profile. They do not automatically follow a reviewer to another device. A quota or browser-storage error is shown in the panel; download or copy the draft before leaving.

Selecting **Save note** keeps the report in that browser. **Save and send to the Dibia team** sends it through the authenticated HMS backend and stores it in Supabase tables `feedback_reports` and `feedback_updates`. Sent reports are visible in the signed-in Console feedback notebook and to staff in the same hospital. HMS staff can also send a direct message to another active hospital; only staff in the sender and recipient hospitals can read that message. A Console platform administrator can send a direct message to one selected hospital, visible to that hospital's signed-in staff. Reports are not automatically shared with other hospitals. There is no email or push notification integration; inboxes must be opened to see new items.

The feature captures interface context only: app, date/time, safe route, page title, role, hospital, build, viewport, and a selected control label/reference. It does not read form values, cookies, tokens, passwords, patient records, or page text. Feedback text is written by the reviewer; do not enter patient information, credentials, or other sensitive data. Review exported notes before sharing them.

## Apply the database migration

Apply `backend/supabase/migrations/202610180001_feedback_notebook.sql` to the Supabase project using the SQL editor or your migration workflow. It enables row-level security and adds tenant-scoped report, message, and platform-admin update policies. The migration has not been run against a live project.

## Update an issue and handle retesting

Open the Feedback button in the Console, choose **Notebook**, then select a sent issue by its permanent `FB-...` ID. Add a status, a description of the change, and the build available to the reviewer. Choosing **Ready to retest** is accepted only when the build exactly matches the build recorded in the original report. This prevents a fix on another environment from being presented as ready in the reviewer's environment.

In HMS, the reporter can mark a ready issue **Fixed** or **Still happening**. Reopening requires evidence; the issue remains outstanding until a developer reviews it again. Updates are retained with their author, time, status, and build. The Console also shows **Updates since your last review**.

## Exports

The default Markdown export includes outstanding issues, including reopened and partially addressed reports. Turn on **Include full history in exports** to include resolved reports. If a draft exists, the export includes it under **Unsaved draft**. Copy has a selectable manual fallback if clipboard access is denied. Exports do not change report status or remove notes.

## Limitations

The notebook uses browser local storage for unsent notes and does not synchronise those notes across devices. Only sent reports and messages are stored in Supabase. The Console is a review inbox, not an automated development tracker: a human must add status updates and builds. Cross-hospital access is limited to messages explicitly sent to a selected recipient; reports remain private to their own hospital and the platform Console.
