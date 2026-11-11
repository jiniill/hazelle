import { useContext } from 'react';
import { classNames } from '../foundation/classNames';
import { StatusFrameContext, StatusMemberContext, StatusOpenContext, UNSET } from './frame';
import { shortOf, type ShownField, type ShownRecord } from './shown';
import { StatusField } from './StatusField';
import { StatusPress } from './StatusPress';
import styles from './StatusRecords.module.css';

type Props = { id: string; name: string; look: 'cards' | 'rows' | 'table'; columns: { id: string; name: string }[]; members: ShownRecord[] };

// A record's name, pressed where records open a page of their own.
function Name({ of, name, className }: { of: { group: string; id: string }; name: string; className?: string }) {
  const open = useContext(StatusOpenContext);
  return open ? (
    <button type="button" className={classNames(className, styles.open)} onClick={() => open(of)}>
      {name}
    </button>
  ) : className ? (
    <span className={className}>{name}</span>
  ) : (
    name
  );
}

const isTag = (field: ShownField) => field.kind === 'stage' && !field.scale && field.value !== '';

// A 묶음's records: a card each (a face, the name, its stages as tags, then its fields), a line each, or a table whose
// columns are the fields.
export function StatusRecords({ id, name, look, columns, members }: Props) {
  const of = (member: ShownRecord) => ({ group: id, id: member.id });
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
            <StatusMemberContext.Provider key={member.id} value={of(member)}>
              <tr>
                <th scope="row">
                  <Name of={of(member)} name={member.name} />
                </th>
                {columns.map((column) => {
                  const field = member.fields.find((each) => each.id === column.id);
                  return (
                    <td key={column.id}>
                      {(field && shortOf(field)) || UNSET}
                      {field?.delta && <span className={field.delta.down ? styles.down : styles.up}> {field.delta.text}</span>}
                      {field && <StatusPress id={field.id} name={field.name} />}
                    </td>
                  );
                })}
              </tr>
            </StatusMemberContext.Provider>
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
              <StatusMemberContext.Provider key={member.id} value={of(member)}>
                <li>
                  <Name of={of(member)} name={member.name} className={styles.rowName} />
                  {member.fields.map((field) => (
                    <StatusField key={field.id} field={field} />
                  ))}
                </li>
              </StatusMemberContext.Provider>
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
            <StatusMemberContext.Provider key={member.id} value={of(member)}>
              <li className={styles.card}>
                <div className={styles.head}>
                  <span className={styles.face} aria-hidden>
                    {[...member.name][0]}
                  </span>
                  <Name of={of(member)} name={member.name} className={styles.memberName} />
                  {member.fields.filter(isTag).map((field) => (
                    <span key={field.id} className={styles.tag} title={field.name}>
                      {shortOf(field)}
                      <StatusPress id={field.id} name={field.name} />
                    </span>
                  ))}
                </div>
                {member.fields
                  .filter((field) => !isTag(field))
                  .map((field) => (
                    <StatusField key={field.id} field={{ ...field, main: false }} />
                  ))}
              </li>
            </StatusMemberContext.Provider>
          ))}
        </ul>
      </StatusFrameContext.Provider>
    </section>
  );
}
