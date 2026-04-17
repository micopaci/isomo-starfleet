-- Seed: default admin user (password: test1234)
-- bcrypt hash of "test1234" with cost factor 10
INSERT INTO users (email, password_hash, role)
VALUES ('admin@test.com', '$2a$10$RIVOYV.UBQ9SVGD2Bk2FaekuOpVWTNvp/XVycEFqxuAGM4dRS29IW', 'admin')
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;
