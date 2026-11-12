CREATE TABLE IF NOT EXISTS contact_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(40) NOT NULL,
  CONSTRAINT contact_tags_name_nonempty CHECK (length(trim(name)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS contact_tags_id_user_unique ON contact_tags(id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS contact_tags_user_name_unique ON contact_tags(user_id, lower(name));
CREATE TABLE IF NOT EXISTS contact_tag_assignments (
  user_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  slot smallint NOT NULL,
  FOREIGN KEY (contact_id, user_id) REFERENCES contacts(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id, user_id) REFERENCES contact_tags(id, user_id) ON DELETE CASCADE,
  CONSTRAINT contact_tags_two_slots CHECK (slot IN (1, 2))
);
CREATE UNIQUE INDEX IF NOT EXISTS contact_tag_slot_unique ON contact_tag_assignments(user_id, contact_id, slot);
CREATE UNIQUE INDEX IF NOT EXISTS contact_tag_assignment_unique ON contact_tag_assignments(user_id, contact_id, tag_id);
CREATE INDEX IF NOT EXISTS contact_tag_filter_idx ON contact_tag_assignments(user_id, tag_id, contact_id);
