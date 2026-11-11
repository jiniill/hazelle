import { useContext } from 'react';
import { StatusEditContext, StatusMemberContext } from './frame';
import styles from './looks.module.css';

// The press laid over a value that is edited by hand, so what draws the value stays as it is. Nothing where values are
// only shown. Its box is the nearest positioned one: the field, the cell or the tag it stands in.
export function StatusPress({ id, name }: { id: string; name: string }) {
  const edit = useContext(StatusEditContext);
  const member = useContext(StatusMemberContext);
  if (!edit) return null;
  return <button type="button" className={styles.press} aria-label={edit.label(name)} onClick={() => edit.onEdit({ field: id, ...(member && { member }) })} />;
}
