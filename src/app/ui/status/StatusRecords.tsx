import { StatusFrameContext, UNSET } from './frame';
import { shortOf, type ShownField, type ShownRecord } from './shown';
import { StatusField } from './StatusField';
import styles from './StatusRecords.module.css';

type Props = { name: string; look: 'cards' | 'rows' | 'table'; columns: { id: string; name: string }[]; members: ShownRecord[] };

const isTag = (field: ShownField) => field.kind === 'stage' && !field.scale && field.value !== '';

// A 묶음's records: a card each (a face, the name, its stages as tags, then its fields), a line each, or a table whose
// columns are the fields.
export function StatusRecords({ name, look, columns, members }: Props) {
  if (look === 'table') {
    return (
      <table className={styles.table}>
        <caption className={styles.title}>{name}</caption>
        <thead>
          <tr>
            <th scope="col">이름</th>
            {columns.map((column) => (
              <th key={column.id} scope="col">
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id}>
              <th scope="row">{member.name}</th>
              {columns.map((column) => {
                const field = member.fields.find(({ id }) => id === column.id);
                return (
                  <td key={column.id}>
                    {(field && shortOf(field)) || UNSET}
                    {field?.delta && <span className={field.delta.down ? styles.down : styles.up}> {field.delta.text}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (look === 'rows') {
    return (
      <section className={styles.group} aria-label={name}>
        <h4 className={styles.title}>{name}</h4>
        <StatusFrameContext.Provider value="line">
          <ul className={styles.rows}>
            {members.map((member) => (
              <li key={member.id}>
                <span className={styles.rowName}>{member.name}</span>
                {member.fields.map((field) => (
                  <StatusField key={field.id} field={field} />
                ))}
              </li>
            ))}
          </ul>
        </StatusFrameContext.Provider>
      </section>
    );
  }
  return (
    <section className={styles.group} aria-label={name}>
      <h4 className={styles.title}>{name}</h4>
      <StatusFrameContext.Provider value="card">
        <ul className={styles.cards}>
          {members.map((member) => (
            <li key={member.id} className={styles.card}>
              <div className={styles.head}>
                <span className={styles.face} aria-hidden>
                  {[...member.name][0]}
                </span>
                <span className={styles.memberName}>{member.name}</span>
                {member.fields.filter(isTag).map((field) => (
                  <span key={field.id} className={styles.tag} title={field.name}>
                    {shortOf(field)}
                  </span>
                ))}
              </div>
              {member.fields
                .filter((field) => !isTag(field))
                .map((field) => (
                  <StatusField key={field.id} field={{ ...field, main: false }} />
                ))}
            </li>
          ))}
        </ul>
      </StatusFrameContext.Provider>
    </section>
  );
}
