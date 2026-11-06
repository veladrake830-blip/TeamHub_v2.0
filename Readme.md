# TeamHub Project
Version 1.9 (draft), November 2026

## 1. About TeamHub project
TeamHub is a private website for managing our internal teams, including members who have just joined.
It is for our organization only. It is not open to the public, and all pages require login except register, login and password reset.

## 2. Roles and Permissions

### Roles
- **Admin**: an account-wide role. There is exactly one Admin, created by a seed script.
- **TeamLeader** and **Member**: roles held per team, stored on the team membership.
  One user can be a TeamLeader in one team and a Member in another.
- **User without a team**: a registered user who has not joined a team yet.
  They can use their profile and News & Forum, and view the Activity Time Log dashboard and Work Logs, but have no team permissions.

### Permission summary
| Action | Admin | TeamLeader | Member | No team |
|---|---|---|---|---|
| Edit own profile | Yes | Yes | Yes | Yes |
| Create a team and appoint its first TeamLeader | Yes | No | No | No |
| Edit TeamInfo | All teams | Own teams | No | No |
| Invite users, approve join requests, remove members from a team | All teams | Own teams | No | No |
| Change team roles | All teams | Own teams | No | No |
| Issue a password reset link | All users | Members of own teams, except anyone who is a TeamLeader of any team | No | No |
| Add, activate, deactivate or edit accounts | All users | No | No | No |
| See the audit log | Yes | No | No | No |
| Record own Activity Time Log and Work Log | No | Yes | Yes | No |
| See Activity Time Log dashboard and Work Logs | Yes | Yes | Yes | Yes |
| Create news and forum topics, and answer topics | Yes | Yes | Yes | Yes |
| Edit or delete news, topics and answers | All | Own, and those of members of own teams | Own | Own |

## 3. Main Features

### User Management
**Accounts**
- Users register with name, email and password. New accounts have no team and no elevated role.
  The registration form must not accept a role.
- New accounts stay pending until the Admin activates them. A pending user cannot log in.
- Registering with an email that is already taken gets the same response as a new one, and creates nothing.
- Login sessions last up to 14 days without use, and 30 days at most.
  Accounts added by the Admin are active immediately, and the user sets their password through a one-time reset link. The Admin never sets it.
- Users log in only to their own account.
- Users can edit their own profile (name, email, avatar, slogan, follows and password).
- `Follows` means following other users and teams, shown on the profile. It does not send notifications.
- Accounts are deactivated, not permanently deleted. A deactivated user cannot log in, and their posts and logs stay visible.
- Changing your email requires your current password. Changing your password ends your other sessions.
- Avatars must be PNG, JPEG or WebP images of up to 2 MB.
- A deactivated user keeps their team memberships, and any unused reset links for them stop working.
  Their pending invitations and join requests are closed.
- The Admin can reactivate a deactivated account, which restores access to their teams.
- Logged-in users can browse a user directory, so that TeamLeaders can find people to invite.
  The directory shows name, avatar and slogan, but not email.

**Admin**
- The Admin's role is always "Admin". Nobody can change it, including the Admin. Another user cannot be promoted to Admin.
- The Admin cannot be deactivated.
- The Admin is never a member of a team. This keeps the Admin's account out of reach of TeamLeader reset links.
- The Admin can edit their own profile.
- The Admin can add, activate, edit and deactivate the accounts of all other users, and change their team roles, at any time.
- The Admin can see all user activity through the audit log on their dashboard.
- If the Admin loses their password, it is reset with a server command-line script.

**Teams**
- The Admin creates a team and appoints its first TeamLeader.
- A team can have more than one TeamLeader.
- TeamLeaders can edit TeamInfo (name, avatar and slogan) of their own teams.
- TeamLeaders can invite any active user, remove members from their team, and change team roles within their team.
- Only active accounts can be invited or appointed as TeamLeader.
- Removing a user from a team does not affect their account or their other teams.
- TeamLeaders cannot delete accounts, or change a member's email or password directly.
- A user can belong to several teams. They join by accepting an invitation, or by sending a join request that a TeamLeader approves.
- Users can leave any team they belong to.
- The last active TeamLeader cannot leave a team until another is appointed.
  If the last active TeamLeader is deactivated, the Admin appoints a new one.
- The last active TeamLeader also cannot be demoted or removed, except by the Admin.
- Teams cannot be deleted.
- Logged-in users can browse a team directory and send join requests from it.
- Pending invitations and join requests are shown in the app, because the system does not send email.

**Password reset**
- The system does not send email.
- A forgotten password is reset with a one-time link, issued by the Admin or by a TeamLeader of one of the user's teams, and passed to the user directly.
- Only the Admin can issue a link for a user who is a TeamLeader of any team, or who stopped being a TeamLeader in the last 7 days.
- A link stops working if its issuer could no longer issue it, for example if the user becomes a TeamLeader or the issuer loses their role. Changing your own password also cancels any open link.
- Links expire after 24 hours and work once. The user chooses their own new password.
- Issuing a link and using it are both recorded in the audit log.
- The token is kept in the part of the address after `#`, so it does not reach server or proxy logs.
- Completing a reset ends all of the user's sessions, and the user sees a notice at their next login.
  This makes misuse of a link detectable. It does not prevent it.
  The notice is not shown when a user sets the first password on an Admin-added account.

### Audit Log
- The system automatically records user actions, including the Admin's own: login, account changes, team and role changes, password reset links issued and used, and content edits or deletions made by someone other than the author.
- For content changed by someone other than the author, the entry keeps the earlier text (the body up to 2,000 characters).
- Audit log entries cannot be edited or deleted.

### Activity Time Log
- TeamLeaders and Members can record only their own daily activity time.
- Each entry records date, start time, end time, category and note. Categories are free text, and entries may overlap.
- Entries can be created only for today or yesterday, and each stays within one day.
- Entries can be edited or deleted until the end of the following day, in the organization timezone. After that they are read-only.
- A user who leaves or is removed from their last team cannot record or change entries until they join a team. Their entries stay visible.
- Every logged-in user can see this data through the shared dashboard.
- Connect to the MyLifeLens app through its Web API, and provide a Web API to MyLifeLens.
  The data, authentication and conflict rules are not defined yet (see section 6).

### News & Forum
- All logged-in users can see all news and forums, across all teams.
- News is for announcements. Forums are for discussion topics that users can answer.
- All users can create news and forum topics, and answer forum topics.
- Edit and delete rights for news, topics and answers:
  - The Admin can edit and delete all of them.
  - TeamLeaders can edit and delete their own, and those of current members of their teams.
  - Members can edit and delete only their own.
- If a member belongs to several teams, a TeamLeader of any of those teams can edit or delete their content.
- TeamLeaders count as members for this rule, so co-leaders can edit and delete each other's content.
- Deleting is a soft delete: the content is hidden from all users, including the Admin, but stays in the database. Deleting a topic also hides its answers.
- Only forum topics can be answered, not news. Content is plain text.

### Work Log
- TeamLeaders and Members record their own daily plan with 2~5 tasks and the result of each task.
- A plan belongs to the person, not to a team.
- Plans cannot be deleted.
- Each person has one plan per day, and can create it only for today or yesterday.
- A plan and its results can be edited until the end of the following day, in the organization timezone. After that they are read-only.
- A user who leaves or is removed from their last team cannot record or change plans until they join a team. Their plans stay visible.
- All logged-in users, including the Admin, can see all daily work logs.

### Setting
- UI setting: each user's display preferences. Theme can be light, dark, or match the device.
- API setting: the Admin's configuration of the MyLifeLens connection.
- Organization setting: the Admin's choice of the single timezone used for deadlines such as the Work Log.

## 4. Project Configuration
- Use Express.js as backend
- Use React.js as frontend
- Use PostgreSQL as database
- Use Prisma as ORM
- Use JWT as authentication
- Don't add other services or platforms. Small libraries that support this stack are allowed, such as `bcrypt`, `multer` and `react-router`.
- Hash passwords with `bcrypt`.
- Use short-lived access tokens, and refresh tokens stored in the database. Removing access or changing a role must take effect without waiting for a token to expire.
- Enforce all permissions on the server. Hiding a button in the UI does not count.
- Store avatars on the server's local disk.

## 5. Build Order
1. Accounts, teams and permissions, with audit recording and tests
2. Audit log viewer and Admin dashboard
3. Work Log, with the organization timezone setting
4. News & Forum
5. Activity Time Log
6. MyLifeLens API
7. Remaining settings

## 6. Open Decisions
The rules above use these assumptions until they are confirmed.

| Topic | Current assumption | Status |
|---|---|---|
| Team roles | Roles are per team, and one user can hold different roles in different teams | To confirm |
| Team creation | Only the Admin creates teams | To confirm |
| Leader powers | TeamLeaders manage team membership, and only the Admin edits or deactivates accounts | To confirm |
| Password reset | No email is sent, and reset links are passed on by hand | To confirm |
| Previous version | This is a new build with no data migration | To confirm |
| News posting | Members can publish news | To confirm |
| Follows | Following users and teams, with no notifications | To confirm |
| Work Log deadline | Editable until the end of the following day | To confirm |
| Work Log dates | One plan per person per day, created only for today or yesterday | To confirm |
| Users without a team | Can view the Activity Time Log dashboard and Work Logs | To confirm |
| Admin and teams | The Admin is never a team member | To confirm |
| Last TeamLeader | The last active TeamLeader cannot be demoted or removed, except by the Admin | To confirm |
| Admin-added accounts | The user sets their password through a reset link | To confirm |
| Reactivation | The Admin can reactivate deactivated accounts | To confirm |
| Deleted content | News, topics and answers are soft-deleted, and deleting a topic hides its answers | To confirm |
| Team deletion | Teams cannot be deleted | To confirm |
| Directories | Logged-in users can browse users and teams, and see invitations and join requests in the app | To confirm |
| Registration | New accounts stay pending until the Admin activates them | Confirmed |
| Reset link misuse | TeamLeaders can issue links. Each reset is audited, ends the user's sessions and shows a notice at next login | Confirmed |
| Timezone | One organization timezone, stored as a setting. It starts as Europe/Moscow until the Admin changes it | Confirmed, timezone not yet named |
| Deleting plans | Work plans cannot be deleted | To confirm |
| Activity entry dates | Entries are created only for today or yesterday, and time past midnight goes in a second entry | To confirm |
| Activity entry | Date, start time, end time, category and note | Confirmed |
| Activity rules | Same edit deadline as the Work Log, free-text categories, overlaps allowed | Confirmed |
| Leader reset links | Only the Admin can issue a link for a user who is a TeamLeader of any team | Confirmed |
| Deactivated members | Memberships are kept, and only active TeamLeaders count as leaders | Confirmed |
| Leaving the last team | Existing logs stay visible and become read-only at once | Confirmed |
| Invitations | Only active accounts can be invited or appointed | Confirmed |
| Leader reset protection | The protection lasts 7 days after someone stops being a TeamLeader | To confirm |
| Session length | Sessions end after 14 unused days, and after 30 days at most | To confirm |
| Account safeguards | Email changes need the current password, password changes end other sessions, deactivation closes pending invitations and join requests, avatars are PNG, JPEG or WebP up to 2 MB | To confirm |
| Avatar access | Avatars are served from hard-to-guess URLs without a login check | To confirm |
| MyLifeLens | Whether time is entered by hand, synced, or both | **Blocked: needs API documentation** |
| Hosting | Hosting, backups and expected number of users | **Not defined** |

## 7. Note
- This specification is not completed and should be updated later.
- The final purpose of this project is supporting all features needed for our internal team management.
- Try your best to build the instantly usable product.
"# TeamHub_v2.0" 
