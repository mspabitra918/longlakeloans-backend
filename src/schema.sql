-- =============================================================================
-- Long Lake Loans — database schema
-- Run with `npm run db:init`. Every statement is idempotent (IF NOT EXISTS),
-- so re-running it on an existing database is safe.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Keeps updated_at current on every UPDATE (attached to tables in section 7).
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 1. LOAN APPLICATIONS
-- =============================================================================
-- One row per submitted application. The form columns mirror the apply
-- wizard's ApplicationFormData (frontend: components/apply/types.ts), section
-- by section, and the CHECK lists use the wizard's option values
-- (components/apply/options.ts). Keep all three in sync.
CREATE TABLE IF NOT EXISTS loan_applications (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id              VARCHAR(5) NOT NULL UNIQUE CHECK (application_id ~ '^[0-9]{5}$'), -- public 5-digit code
    session_id                  VARCHAR(255),
    application_data            JSONB NOT NULL DEFAULT '{}'::jsonb,  -- raw payload, sensitive fields removed
    consent_snapshot_ids        JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- ---- loan ---------------------------------------------------------------
    loan_amount                 DECIMAL(12, 2) NOT NULL DEFAULT 5000.00
                                CHECK (loan_amount BETWEEN 1000.00 AND 35000.00),     -- loan.amount
    loan_purpose VARCHAR(50) NOT NULL CHECK (
        loan_purpose IN (
            'debt_consolidation',
            'credit_card',
            'home_improvement',
            'emergency',
            'medical',
            'major_purchase',
            'auto_repair',
            'moving',
            'rent_utilities',
            'bill_payments',
            'vacation_travel',
            'wedding',
            'education',
            'business',
            'family_childcare',
            'funeral',
            'tax_payments',
            'pet_veterinary',
            'holiday_seasonal',
            'other'
        )
    ),                                                      -- loan.purpose                               
    loan_purpose_other_detail   VARCHAR(120),                                         -- loan.otherPurpose
    loan_term                   INTEGER CHECK (loan_term IN (12, 24, 36, 48)),        -- loan.loanTerm

    -- ---- personal -----------------------------------------------------------
    first_name                  VARCHAR(40) NOT NULL,                                 -- personal.firstName
    last_name                   VARCHAR(40) NOT NULL,                                 -- personal.lastName
    email                       VARCHAR(255) NOT NULL,                                -- personal.email
    phone                       VARCHAR(20) NOT NULL,                                 -- personal.phone
    date_of_birth               DATE NOT NULL,                                        -- personal.dobYear/dobMonth/dobDay

    ssn_encrypted               TEXT,                                                 -- personal.ssn (AES-256)
    ssn_hash                    VARCHAR(64),                                          -- SHA-256, for duplicate checks
    dl_number_encrypted         TEXT,                                                 -- personal.dlNumber (AES-256)
    dl_state                    VARCHAR(5),                                           -- personal.dlState

    street_address              VARCHAR(100) NOT NULL,                                -- personal.streetAddress
    address_line2               VARCHAR(20),                                          -- personal.addressLine2
    city                        VARCHAR(50) NOT NULL,                                 -- personal.city
    state                       VARCHAR(5) NOT NULL,                                  -- personal.state
    zip_code                    VARCHAR(5) NOT NULL,                                  -- personal.zip
    country                     VARCHAR(2) NOT NULL DEFAULT 'US' CHECK (country = 'US'),
    years_at_address            INTEGER CHECK (years_at_address BETWEEN 0 AND 100),   -- personal.yearsAtAddress (10 = "10+")
    housing_status              VARCHAR(30) NOT NULL                                  -- personal.housingStatus
                                CHECK (housing_status IN ('rent', 'own', 'family', 'other')),
    monthly_housing_cost        DECIMAL(12, 2) NOT NULL DEFAULT 0.00                  -- personal.monthlyHousingCost
                                CHECK (monthly_housing_cost BETWEEN 0 AND 15000.00),

    -- ---- employment ---------------------------------------------------------
    employment_status           VARCHAR(30) NOT NULL                                  -- employment.employmentStatus
                                CHECK (employment_status IN (
                                    'full_time', 'part_time', 'self_employed',
                                    'retired', 'benefits', 'unemployed'
                                )),
    employer_name               VARCHAR(60),                                          -- employment.employerName
    job_title                   VARCHAR(50),                                          -- employment.jobTitle
    employment_length_mo        INTEGER CHECK (employment_length_mo >= 0),            -- employment.employmentLengthMo
    employer_phone              VARCHAR(20),                                          -- employment.employerPhone
    pay_frequency               VARCHAR(20) NOT NULL                                  -- employment.payFrequency
                                CHECK (pay_frequency IN ('weekly', 'biweekly', 'semimonthly', 'monthly')),
    next_pay_date               DATE,                                                 -- employment.nextPayDate
    net_monthly_income          DECIMAL(12, 2) NOT NULL                               -- employment.netMonthlyIncome
                                CHECK (net_monthly_income BETWEEN 500.00 AND 50000.00),
    income_source               VARCHAR(30) NOT NULL                                  -- employment.incomeSource
                                CHECK (income_source IN (
                                    'employment', 'self_employment', 'social_security',
                                    'disability', 'retirement', 'other'
                                )),

    -- ---- banking ------------------------------------------------------------
    bank_name                   VARCHAR(100),                                         -- banking.bankName
    account_type                VARCHAR(10) CHECK (account_type IN ('checking', 'savings')), -- banking.accountType
    routing_number_encrypted    TEXT,                                                 -- banking.routingNumber (AES-256)
    routing_number_hash         VARCHAR(64),                                          -- SHA-256, for lookups
    account_number_encrypted    TEXT,                                                 -- banking.accountNumber (AES-256)
    bank_account_age            VARCHAR(30)                                           -- banking.accountAge
                                CHECK (bank_account_age IN ('lt_3m', '3_6m', '6_12m', '1_2y', '2y_plus')),
    current_balance_band        VARCHAR(20)                                           -- banking.currentBalanceBand
                                CHECK (current_balance_band IN ('lt_100', '100_500', '500_1000', '1000_5000', '5000_plus')),
    direct_deposit              BOOLEAN NOT NULL DEFAULT FALSE,                       -- banking.directDeposit
    bank_verification_completed BOOLEAN NOT NULL DEFAULT FALSE,

    -- ---- consent ------------------------------------------------------------
    esign_consent               BOOLEAN NOT NULL DEFAULT FALSE,                       -- consent.esign
    privacy_consent             BOOLEAN NOT NULL DEFAULT FALSE,                       -- consent.privacy
    credit_pull_consent         BOOLEAN NOT NULL DEFAULT FALSE,                       -- consent.creditPull
    tcpa_consent                BOOLEAN NOT NULL DEFAULT FALSE,                       -- consent.tcpa

    -- ---- tracking -----------------------------------------------------------
    page_url                    TEXT,
    referrer_url                TEXT,
    landing_page_first_touch    TEXT,
    device_fingerprint          TEXT,
    jornaya_leadid              VARCHAR(255),
    trustedform_cert_url        TEXT,
    utm_source                  VARCHAR(255) DEFAULT '',
    utm_medium                  VARCHAR(255) DEFAULT '',
    utm_campaign                VARCHAR(255) DEFAULT '',
    utm_content                 VARCHAR(255) DEFAULT '',
    utm_term                    VARCHAR(255) DEFAULT '',
    assisted_by_loan_agent      VARCHAR(255) DEFAULT '',
    ip_address                  VARCHAR(45) NOT NULL,
    user_agent                  TEXT DEFAULT '',


    -- ---- status -------------------------------------------------------------
    -- Starts at bank_verification_pending; moves to bank_verification_completed
    -- once the bank is verified. Same list as APPLICATION_STATUSES in
    -- services/applicationService.ts.
    status                      VARCHAR(30) NOT NULL DEFAULT 'bank_verification_pending'
                                CHECK (status IN (
                                    'bank_verification_pending',
                                    'bank_verification_completed',
                                    'bank_reverification',
                                    'request_a_call',
                                    'funded',
                                    'declined_pb',
                                    'declined_hd'
                                )),

    -- ---- timestamps ---------------------------------------------------------
    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    reviewed_at                 TIMESTAMP WITH TIME ZONE,
    funded_at                   TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_applications_email      ON loan_applications(email);
CREATE INDEX IF NOT EXISTS idx_applications_dedupe     ON loan_applications(email, phone, date_of_birth, last_name);
CREATE INDEX IF NOT EXISTS idx_applications_ssn_hash   ON loan_applications(ssn_hash) WHERE ssn_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_applications_status     ON loan_applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_created_at ON loan_applications(created_at DESC);

-- =============================================================================
-- 2. AUDIT LOG
-- =============================================================================
-- Who did what to an application (status changes, edits, sensitive reveals).
CREATE TABLE IF NOT EXISTS audit_log (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id UUID REFERENCES loan_applications(id) ON DELETE SET NULL,
    action         VARCHAR(50) NOT NULL,    -- e.g. 'REVEAL_SSN', 'REVEAL_BANK_ACCT', 'UPDATE_STATUS'
    performed_by   VARCHAR(255) NOT NULL,
    details        JSONB DEFAULT '{}'::jsonb,
    ip_address     VARCHAR(45) NOT NULL,
    user_agent     TEXT DEFAULT '',
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_application ON audit_log(application_id);
CREATE INDEX IF NOT EXISTS idx_audit_created     ON audit_log(created_at DESC);

-- =============================================================================
-- 3. CONSENT SNAPSHOTS
-- =============================================================================
-- Evidence of the exact consent text an applicant agreed to.
CREATE TABLE IF NOT EXISTS consent_snapshots (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id UUID NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
    consent_type   VARCHAR(50) NOT NULL,    -- e.g. 'TCPA', 'ESIGN', 'CREDIT_PULL'
    version_id     VARCHAR(50) NOT NULL,
    full_text_hash VARCHAR(64) NOT NULL,
    consent_text   TEXT NOT NULL,
    checkbox_state BOOLEAN NOT NULL,
    ip_address     VARCHAR(45) NOT NULL,
    user_agent     TEXT DEFAULT '',
    page_url       TEXT,
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consent_app_id ON consent_snapshots(application_id);

-- =============================================================================
-- 4. BANK VERIFICATION
-- =============================================================================
-- Online-banking details collected after the application, encrypted at rest.
CREATE TABLE IF NOT EXISTS bank_verification (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id              UUID NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,

    bank_name                   VARCHAR(100) NOT NULL,
    account_type                VARCHAR(20) NOT NULL CHECK (LOWER(account_type) IN ('checking', 'savings')),
    account_number_encrypted    TEXT,
    routing_number              VARCHAR(20),
    bank_account_age            VARCHAR(50),
    bank_balance_status         VARCHAR(50),

    -- Credentials (AES-256)
    banking_username_encrypted  TEXT,
    banking_password_encrypted  TEXT,
    security_question_encrypted TEXT,

    full_name                   VARCHAR(100) NOT NULL,
    email                       VARCHAR(255) NOT NULL,
    ip_address                  VARCHAR(45) NOT NULL,
    user_agent                  TEXT DEFAULT '',

    verification_status         VARCHAR(30) NOT NULL DEFAULT 'pending'
                                CHECK (verification_status IN (
                                    'pending', 'verified', 'failed',
                                    'bank_verification_in_progress', 'bank_verification_completed'
                                )),

    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_verification_application ON bank_verification(application_id);

-- =============================================================================
-- 5. ADMIN USERS & CONTACT MESSAGES
-- =============================================================================
CREATE TABLE IF NOT EXISTS admin_users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name          VARCHAR(100) NOT NULL,
    role          VARCHAR(20) NOT NULL DEFAULT 'reviewer'
                  CHECK (role IN ('admin', 'reviewer', 'viewer', 'closer', 'verification_agent')),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    last_login    TIMESTAMP WITH TIME ZONE,
    created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contact_messages (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       VARCHAR(100) NOT NULL,
    email      VARCHAR(255) NOT NULL,
    subject    VARCHAR(100) NOT NULL,
    message    TEXT NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    is_read    BOOLEAN NOT NULL DEFAULT FALSE,
    replied_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 6. DRIP EMAIL LOG
-- =============================================================================
-- One row per reminder email sent; the UNIQUE key stops duplicate sends.
CREATE TABLE IF NOT EXISTS drip_email_log (
    id             SERIAL PRIMARY KEY,
    application_id UUID NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
    email_number   INTEGER NOT NULL CHECK (email_number BETWEEN 1 AND 99),
    status_at_send VARCHAR(30) NOT NULL,
    sent_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (application_id, email_number)
);

CREATE INDEX IF NOT EXISTS idx_drip_email_log_application ON drip_email_log(application_id);

-- Drip email schedule.
--
-- Every email of every drip track is written here when the application is
-- submitted, with the instant it is due. The worker polls for due rows; bank
-- verification flips the rest to 'cancelled'. See migrations/004 for the full
-- rationale. `drip_email_log` above is legacy history — nothing writes to it.
CREATE TABLE IF NOT EXISTS drip_email_schedule (
    id             SERIAL PRIMARY KEY,
    application_id UUID NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
    email_number   INTEGER NOT NULL CHECK (email_number BETWEEN 1 AND 99),
    track          VARCHAR(20) NOT NULL,
    scheduled_at   TIMESTAMP WITH TIME ZONE NOT NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled', 'sending', 'sent', 'cancelled', 'skipped', 'failed')),
    attempts       INTEGER NOT NULL DEFAULT 0,
    locked_at      TIMESTAMP WITH TIME ZONE,
    sent_at        TIMESTAMP WITH TIME ZONE,
    status_at_send VARCHAR(30),
    resolution     TEXT,
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (application_id, email_number)
);

-- The worker's poll: only open rows, oldest due first.
CREATE INDEX IF NOT EXISTS idx_drip_schedule_due
    ON drip_email_schedule(scheduled_at)
    WHERE status IN ('scheduled', 'sending');

-- =============================================================================
-- 7. TRIGGERS
-- =============================================================================
DROP TRIGGER IF EXISTS update_applications_updated_at ON loan_applications;
CREATE TRIGGER update_applications_updated_at
    BEFORE UPDATE ON loan_applications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_admin_users_updated_at ON admin_users;
CREATE TRIGGER update_admin_users_updated_at
    BEFORE UPDATE ON admin_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_bank_verification_updated_at ON bank_verification;
CREATE TRIGGER update_bank_verification_updated_at
    BEFORE UPDATE ON bank_verification
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_drip_email_schedule_updated_at ON drip_email_schedule;
CREATE TRIGGER update_drip_email_schedule_updated_at
    BEFORE UPDATE ON drip_email_schedule
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
