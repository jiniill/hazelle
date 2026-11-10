-- Log rows older builds wrote, in today's shapes (src/contracts/admin.ts LogDetails); values keep their stored text.
-- A restore's report is the operator-only post under the same id (0015).
UPDATE admin_log
SET detail = json_object('username', detail -> 'username', 'operation', detail -> 'operation', 'post', detail -> 'report', 'at', detail -> 'at', 'undoes', detail -> 'undoes')
WHERE action = 'restore-begun' AND json_type(detail, '$.report') IS NOT NULL;

-- A notice that answered no report.
UPDATE admin_log SET detail = json_remove(detail, '$.report') WHERE action = 'send-notice' AND json_type(detail, '$.report') = 'null';
