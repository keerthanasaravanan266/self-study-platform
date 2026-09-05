-- Run this once against your `selfstudy` database, in addition to
-- migration_timetable_fix.sql (if you haven't already run that one).
--
-- mysql -u root -p selfstudy < migration_features_update.sql

USE selfstudy;

-- ---------------------------------------------------------------------
-- 1) Materials categories - lets you tag uploads/pasted items (e.g.
--    "Robotics", "Math", "OS") so the Materials page can group and filter
--    by subject instead of showing one long flat list.
-- ---------------------------------------------------------------------
ALTER TABLE materials
    ADD COLUMN IF NOT EXISTS category VARCHAR(100) NOT NULL DEFAULT 'Uncategorized';

ALTER TABLE pasted_materials
    ADD COLUMN IF NOT EXISTS category VARCHAR(100) NOT NULL DEFAULT 'Uncategorized';

-- ---------------------------------------------------------------------
-- 2) Quiz question bank - powers the new "dynamic" quiz generator.
--    Every generated question is saved here per user/topic. Questions you
--    get wrong come back sooner in a later quiz on the same topic;
--    questions you keep getting right come back less and less often
--    (a simple spaced-repetition / Leitner-style schedule), instead of
--    the quiz being a fresh unrelated static set every single time.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quiz_questions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    topic VARCHAR(255) NOT NULL DEFAULT 'General',
    question TEXT NOT NULL,
    option_a VARCHAR(500) NOT NULL,
    option_b VARCHAR(500) NOT NULL,
    option_c VARCHAR(500) NOT NULL,
    option_d VARCHAR(500) NOT NULL,
    correct_option CHAR(1) NOT NULL,
    correct_streak INT NOT NULL DEFAULT 0,
    total_attempts INT NOT NULL DEFAULT 0,
    correct_attempts INT NOT NULL DEFAULT 0,
    next_review_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_topic_due (user_id, topic, next_review_at)
);
