-- Published purchase lines are browsed across batches (by month, facility, size).
CREATE INDEX IF NOT EXISTS purchase_line_published ON purchase_line(tenant_id, period_start) WHERE status = 'published';
