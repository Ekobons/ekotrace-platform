-- EKOTRACE SME: settings first stored by the system before their defaults were revised (the DPDP checklist
-- grew from 10 to 25 items with areas and evidence; the UK CBAM rule text lost glass and ceramics).
-- Only an untouched first version is removed; it is stored again from the new defaults the next time it is read.
-- A version anyone saved or activated in the SME console is kept.
DELETE FROM sme_setting s
 WHERE s.skey IN ('dpdp', 'requirements') AND s.version = 1 AND s.created_name = 'system'
   AND NOT EXISTS (SELECT 1 FROM sme_setting o WHERE o.skey = s.skey AND o.version <> 1);
