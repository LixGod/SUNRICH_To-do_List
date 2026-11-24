CREATE TABLE login_tokens (
    token_hash VARCHAR(64) NOT NULL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    INDEX idx_login_tokens_user (user_id),
    CONSTRAINT fk_login_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
