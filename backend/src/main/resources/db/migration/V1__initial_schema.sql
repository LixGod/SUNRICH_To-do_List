CREATE TABLE users (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    CONSTRAINT uk_users_username UNIQUE (username)
);

CREATE TABLE user_roles (
    user_id BIGINT NOT NULL,
    role ENUM('SUPER_ADMIN', 'CHAIRMAN', 'VICE_PRESIDENT', 'MANAGING_DIRECTOR', 'DIRECTOR', 'ASSISTANT_VICE_PRESIDENT') NOT NULL,
    CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE employees (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL
);

CREATE TABLE tasks (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    recipient_id BIGINT,
    assigned_by_name VARCHAR(255),
    title VARCHAR(255) NOT NULL,
    notes TEXT,
    due_time TIME(6),
    priority ENUM('HIGH', 'MEDIUM', 'LOW') NOT NULL,
    category VARCHAR(255),
    status ENUM('ACTIVE', 'IN_PROGRESS', 'COMPLETED') NOT NULL,
    focus_date DATE,
    assignee_ids TEXT,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    completed_at DATETIME(6),
    INDEX idx_tasks_user_status (user_id, status),
    INDEX idx_tasks_recipient_status (recipient_id, status)
);
