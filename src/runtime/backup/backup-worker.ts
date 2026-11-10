import { BackupJobs } from './backup-job';
import { BackupPeer, type BackupMessage } from './backup-peer';
import { createBackupRecords } from './backup-records';

const scope = self as unknown as { postMessage(message: BackupMessage): void };
const peer: BackupPeer = new BackupPeer((message) => scope.postMessage(message), (name, args) => jobs.handle(name, args));
const jobs: BackupJobs = new BackupJobs(peer, createBackupRecords);
addEventListener('message', ({ data }: MessageEvent<BackupMessage>) => peer.receive(data));
