-- Run this once in your `selfstudy` MySQL database (e.g. via MySQL Workbench,
-- phpMyAdmin, or `mysql -u root -p selfstudy < migration_timetable_fix.sql`).
--
-- It fixes the timetable feature so uploading/editing overwrites the existing
-- saved row for a user instead of endlessly inserting new rows.

USE selfstudy;

-- 1) Remove any duplicate rows created by the old "always INSERT" bug,
--    keeping only the most recent row per user.
DELETE t1 FROM timetable_images t1
INNER JOIN timetable_images t2
WHERE t1.user_id = t2.user_id AND t1.id < t2.id;

DELETE t1 FROM timetable_days t1
INNER JOIN timetable_days t2
WHERE t1.user_id = t2.user_id AND t1.day = t2.day AND t1.id < t2.id;

-- 2) Add an `updated_at` column so we can see when the image was last edited.
ALTER TABLE timetable_images
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- 3) Add the uniqueness constraints the new UPSERT queries rely on:
--    one timetable image per user, one end-time row per user per day.
ALTER TABLE timetable_images
    ADD UNIQUE KEY unique_user_image (user_id);

ALTER TABLE timetable_days
    ADD UNIQUE KEY unique_user_day (user_id, day);
