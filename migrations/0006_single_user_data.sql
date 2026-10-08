-- Single-user conversion, data step (Guides/pathway-to-single-user.md, Phase 2).
-- Not in meta/_journal.json: run manually, once. Column drops happen in Phase 3
-- via db-init's dropMultiUserColumns() on startup.
--
-- Run as one transaction (ON COMMIT DROP needs it too). face_pair_dismissals
-- duplicates are removed by db-init before it adds the unique pair index.
--
-- The surviving account is the highest-ranked, oldest user.

BEGIN;

CREATE TEMP TABLE main_user ON COMMIT DROP AS
SELECT id FROM users
ORDER BY CASE role WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, id
LIMIT 1;

-- "Me" moves from people.user_id to an app setting.
INSERT INTO app_settings (key, value)
SELECT 'me_person_id', p.id FROM people p JOIN main_user m ON p.user_id = m.id
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Other users' private shared-table rows.
DELETE FROM people          WHERE visibility = 'private' AND created_by_user_id <> (SELECT id FROM main_user);
DELETE FROM interactions    WHERE visibility = 'private' AND created_by_user_id <> (SELECT id FROM main_user);
DELETE FROM groups          WHERE visibility = 'private' AND created_by_user_id <> (SELECT id FROM main_user);
DELETE FROM social_accounts WHERE visibility = 'private' AND created_by_user_id <> (SELECT id FROM main_user);
DELETE FROM insights        WHERE visibility = 'private' AND created_by_user_id <> (SELECT id FROM main_user);
DELETE FROM conversations   WHERE visibility = 'private' AND created_by_user_id <> (SELECT id FROM main_user);

-- Other users. Cascades their notes, daily notes, AI chats, tasks, image tasks,
-- API keys, SSO config, extension sessions, and their "Me" person row.
DELETE FROM users WHERE id <> (SELECT id FROM main_user);
COMMIT;
