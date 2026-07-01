DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;


-- ************************ Users TABLES ************************ -- 
CREATE TABLE user_roles (
  role_id SERIAL PRIMARY KEY,
  role_name TEXT NOT NULL
);

CREATE TABLE users (
  user_id SERIAL PRIMARY KEY,
  role_id INT REFERENCES user_roles(role_id),
  email TEXT NOT NULL UNIQUE,  
  password TEXT NOT NULL,
  username TEXT UNIQUE, 

  phone_number TEXT, 
  avatar_url TEXT,
  date_of_birth DATE,
  gender TEXT,
  bio TEXT,
  notes TEXT,  

  active BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at TIMESTAMP DEFAULT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_seen_at TIMESTAMP DEFAULT NOW()
);
