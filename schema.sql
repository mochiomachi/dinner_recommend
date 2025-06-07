-- Users table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT,
  allergies TEXT,
  dislikes TEXT,
  invited BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Meals table
CREATE TABLE meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  ate_date DATE NOT NULL,
  dish TEXT NOT NULL,
  tags TEXT,
  rating INTEGER,
  mood TEXT,
  decided BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id)
);