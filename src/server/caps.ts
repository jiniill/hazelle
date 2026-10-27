// The object bytes cap is read with the session and holds for that request's batch, in the account's store
// (session.ts); the picture cap is read by the upload's reservation, in the same statement (files.ts).
export const CAP = {
  bytes: 'CASE WHEN own_bytes_cap THEN bytes_cap ELSE (SELECT account_bytes_cap FROM service) END',
  fileBytes: 'CASE WHEN own_file_bytes_cap THEN file_bytes_cap ELSE (SELECT account_file_bytes_cap FROM service) END',
};

// Bill retained object rows, including tombstones, plus service share/link-file rows; bodies alone undercount disk.
// Measured row costs: objects 220–320 B, initial link ~780 B, linked file ~300 B.
export const ROW_BYTES = { object: 256, share: 512, shareFile: 300 };

// The service-database bytes an account's links hold, over ?1, its incarnation.
export const SHARED_BYTES = `SELECT ${ROW_BYTES.share} * COUNT(*)
  + ${ROW_BYTES.shareFile} * (SELECT COUNT(*) FROM share_versions WHERE share IN (SELECT id FROM shares WHERE incarnation = ?1))
  + ${ROW_BYTES.shareFile} * (SELECT COUNT(*) FROM share_files WHERE share IN (SELECT id FROM shares WHERE incarnation = ?1))
  AS bytes FROM shares WHERE incarnation = ?1`;
