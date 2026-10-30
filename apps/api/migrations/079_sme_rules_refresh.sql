-- EKOTRACE SME: requirement rules, schemes library and calendar templates revised (October 2026): Labour Codes,
-- pollution consents, hazardous waste, BIS orders, Udyam, e-waste and battery EPR split, EPR target tables, CSR
-- Schedule VII list; CGTMSE, MCGS-MSME, PMEGP and state subsidies with document checklists; battery EPR and unspent
-- CSR due dates. Only an untouched first version is removed; it is stored again from the new defaults the next time
-- it is read. A version anyone saved or activated in the SME console is kept.
DELETE FROM sme_setting s
 WHERE s.skey IN ('requirements', 'schemes', 'calendar') AND s.version = 1 AND s.created_name = 'system'
   AND NOT EXISTS (SELECT 1 FROM sme_setting o WHERE o.skey = s.skey AND o.version <> 1);
