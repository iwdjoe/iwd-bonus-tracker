-- ============================================================
-- IWD Agency Expense Tracker — Supabase Database Schema
-- Run this in your Supabase SQL Editor to set up the tables
-- ============================================================

-- Expenses table
CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    date DATE NOT NULL,
    vendor TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'Other',
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'one-time' CHECK (type IN ('one-time', 'recurring')),
    frequency TEXT CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'annually', NULL)),
    next_due DATE,
    owner TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('paid', 'pending', 'overdue')),
    notes TEXT,
    comments JSONB DEFAULT '[]'::jsonb,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Settings table (for budget, etc.)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_owner ON expenses(owner);
CREATE INDEX IF NOT EXISTS idx_expenses_type ON expenses(type);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER expenses_updated_at
    BEFORE UPDATE ON expenses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER settings_updated_at
    BEFORE UPDATE ON settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Enable Row Level Security (optional — configure as needed)
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read/write (adjust for your needs)
CREATE POLICY "Allow all access to expenses" ON expenses
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access to settings" ON settings
    FOR ALL USING (true) WITH CHECK (true);
