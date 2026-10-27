import { Folder } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import styles from './FolderMark.module.css';

export function FolderMark({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  return (
    <span className={styles.mark}>
      <Icon icon={Folder} size={size} />
    </span>
  );
}
