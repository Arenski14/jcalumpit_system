-- J. Calumpit Dental Clinic — database
-- Import in phpMyAdmin (Import tab) or:  mysql -u root < database.sql
-- WARNING: this DROPS and recreates every table. If you already have data, import migrate_v2.sql instead.

CREATE DATABASE IF NOT EXISTS jcalumpit_dental
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE jcalumpit_dental;

DROP TABLE IF EXISTS login_attempts;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS payment_sessions;
DROP TABLE IF EXISTS treatments;
DROP TABLE IF EXISTS records;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS appointments;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  first_name    VARCHAR(60)  NOT NULL,
  middle_name   VARCHAR(60)  NULL,
  last_name     VARCHAR(60)  NOT NULL,
  gender        ENUM('male','female','non-binary','prefer-not-to-say') NOT NULL,
  birth_date    DATE         NOT NULL,
  email         VARCHAR(150) NOT NULL,
  phone         VARCHAR(20)  NOT NULL,
  address       VARCHAR(255) NOT NULL,
  username      VARCHAR(30)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('patient','staff','dentist','admin') NOT NULL DEFAULT 'patient',
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  last_login    DATETIME     NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB;

CREATE TABLE appointments (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id      INT UNSIGNED NOT NULL,
  patient_name VARCHAR(150) NOT NULL,
  phone        VARCHAR(20)  NOT NULL,
  email        VARCHAR(150) NOT NULL,
  service      VARCHAR(100) NOT NULL,
  dentist      VARCHAR(100) NOT NULL DEFAULT 'Dr. Calumpit',
  appt_date    DATE         NOT NULL,
  appt_time    TIME         NOT NULL,
  prev_date    DATE         NULL,          -- set when staff reschedules
  prev_time    TIME         NULL,
  notes        TEXT         NULL,          -- patient's notes
  admin_note   VARCHAR(500) NULL,          -- staff message shown to the patient
  fee          DECIMAL(10,2) NOT NULL DEFAULT 0.00,   -- amount billed for the visit (set by staff)
  billed_at    DATETIME     NULL,          -- when the fee was first set (invoice date)
  status       ENUM('pending','approved','rescheduled','declined','cancelled','completed')
               NOT NULL DEFAULT 'pending',
  handled_by   INT UNSIGNED NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_slot (appt_date, appt_time, status),
  KEY idx_user (user_id),
  CONSTRAINT fk_appt_user    FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_appt_handler FOREIGN KEY (handled_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Payments recorded by staff against an appointment's fee
CREATE TABLE payments (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  appointment_id INT UNSIGNED  NOT NULL,
  user_id        INT UNSIGNED  NOT NULL,
  amount         DECIMAL(10,2) NOT NULL,
  method         ENUM('cash','gcash','maya','card','bank_transfer','other') NOT NULL DEFAULT 'cash',
  reference      VARCHAR(100)  NULL,
  note           VARCHAR(255)  NULL,
  paid_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recorded_by    INT UNSIGNED  NULL,
  provider       VARCHAR(20)   NULL,          -- 'paymongo' / 'demo' for online payments, NULL for staff-entered
  provider_ref   VARCHAR(100)  NULL,          -- gateway payment id (stops the same payment being counted twice)
  UNIQUE KEY uq_pay_provider (provider, provider_ref),
  KEY idx_pay_appt (appointment_id),
  KEY idx_pay_user (user_id),
  CONSTRAINT fk_pay_appt FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  CONSTRAINT fk_pay_user FOREIGN KEY (user_id)        REFERENCES users(id)        ON DELETE CASCADE,
  CONSTRAINT fk_pay_by   FOREIGN KEY (recorded_by)    REFERENCES users(id)        ON DELETE SET NULL
) ENGINE=InnoDB;

-- Patient records (medical history, prescriptions, x-rays, lab results, documents)
CREATE TABLE records (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  patient_id  INT UNSIGNED NOT NULL,
  record_type ENUM('medical_history','prescription','xray','lab_result','document') NOT NULL,
  title       VARCHAR(150) NOT NULL,
  details     TEXT         NULL,
  file_name   VARCHAR(255) NULL,           -- original file name
  file_path   VARCHAR(100) NULL,           -- stored name inside /storage/records
  file_mime   VARCHAR(100) NULL,
  record_date DATE         NOT NULL,
  added_by    INT UNSIGNED NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_rec_patient (patient_id),
  KEY idx_rec_type (record_type),
  CONSTRAINT fk_rec_patient FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_rec_by      FOREIGN KEY (added_by)   REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Treatments and treatment plans
CREATE TABLE treatments (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  patient_id     INT UNSIGNED NOT NULL,
  name           VARCHAR(150) NOT NULL,
  dentist        VARCHAR(100) NOT NULL DEFAULT 'Dr. Calumpit',
  start_date     DATE         NOT NULL,
  status         ENUM('plan','ongoing','completed','cancelled') NOT NULL DEFAULT 'ongoing',
  completed_on   DATE         NULL,
  notes          TEXT         NULL,
  created_by     INT UNSIGNED NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_tr_patient (patient_id),
  KEY idx_tr_status (status),
  CONSTRAINT fk_tr_patient FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tr_by      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Online payment attempts (one row per checkout started by a patient)
CREATE TABLE payment_sessions (
  id                  INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  token               CHAR(32)      NOT NULL,
  user_id             INT UNSIGNED  NOT NULL,
  appointment_id      INT UNSIGNED  NOT NULL,
  provider            VARCHAR(20)   NOT NULL,          -- 'paymongo' or 'demo'
  provider_session_id VARCHAR(100)  NULL,              -- PayMongo checkout session id (cs_...)
  amount              DECIMAL(10,2) NOT NULL,
  status              ENUM('pending','paid','cancelled') NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at             DATETIME      NULL,
  UNIQUE KEY uq_ps_token (token),
  KEY idx_ps_user (user_id),
  KEY idx_ps_appt (appointment_id),
  CONSTRAINT fk_ps_user FOREIGN KEY (user_id)        REFERENCES users(id)        ON DELETE CASCADE,
  CONSTRAINT fk_ps_appt FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Messages from the landing-page contact form and password-reset requests
CREATE TABLE messages (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kind       ENUM('contact','password_reset') NOT NULL DEFAULT 'contact',
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(150) NOT NULL,
  phone      VARCHAR(30)  NULL,
  subject    VARCHAR(100) NULL,
  message    TEXT         NOT NULL,
  ip         VARCHAR(45)  NULL,
  is_read    TINYINT(1)   NOT NULL DEFAULT 0,
  read_by    INT UNSIGNED NULL,
  read_at    DATETIME     NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_msg_read (is_read, created_at),
  KEY idx_msg_ip (ip, created_at),
  CONSTRAINT fk_msg_by FOREIGN KEY (read_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Failed sign-in attempts (used to slow down password guessing)
CREATE TABLE login_attempts (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ip           VARCHAR(45)  NOT NULL,
  identifier   VARCHAR(150) NOT NULL,
  attempted_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_la (identifier, ip, attempted_at)
) ENGINE=InnoDB;

-- Starter accounts (CHANGE THESE PASSWORDS after your first login: Settings > Change password)
--   admin / Admin@123     staff / Staff@123     dentist / Dentist@123
INSERT INTO users (first_name, middle_name, last_name, gender, birth_date, email, phone, address, username, password_hash, role) VALUES
('Clinic',   NULL, 'Admin',    'prefer-not-to-say', '1990-01-01', 'admin@jcalumpit.local',   '09120000001', '2nd floor Banlicom Sentre 217 Maharlika Hwy, Banlic, Cabuyao, Philippines, 4025', 'admin',   '$2y$12$Fqy16fdnqNxOKhTq.Z2w8.pErpI.YDNWmDYb/EIdpqZeT0CIbvyga', 'admin'),
('Clinic',   NULL, 'Staff',    'prefer-not-to-say', '1990-01-01', 'staff@jcalumpit.local',   '09120000002', '2nd floor Banlicom Sentre 217 Maharlika Hwy, Banlic, Cabuyao, Philippines, 4025', 'staff',   '$2y$12$isb1RFEM7PusaB432S8ESO2b/7cJ0xmCeHAunvQDydQ6RjBIam88O', 'staff'),
('Jonathan', NULL, 'Calumpit', 'male',              '1990-01-01', 'dentist@jcalumpit.local', '09120000003', '2nd floor Banlicom Sentre 217 Maharlika Hwy, Banlic, Cabuyao, Philippines, 4025', 'dentist', '$2y$12$AN2BewfnBsSpo9iaGtc02OX21st.sdyDgiZ1unWsL/DFUVYFKIrLG',  'dentist');
