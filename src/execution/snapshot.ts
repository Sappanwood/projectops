import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import type { CodeSnapshot } from './attempt.js';
import { ExecutionError } from './store.js';
export function captureSnapshot(repo: string): CodeSnapshot {
    const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
        git(['rev-parse', '--is-inside-work-tree']);
        let head: string;
        try {
            head = git(['rev-parse', '--verify', 'HEAD']).trim();
        }
        catch {
            head = 'unborn';
        }
        let diff = head === 'unborn' ? git(['diff', '--binary', '--cached']) + git(['diff', '--binary']) : git(['diff', '--binary', 'HEAD']);
        const untracked = git(['ls-files', '-z', '--others', '--exclude-standard']).split('\0').filter(Boolean);
        const files = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))].sort();
        const hash = createHash('sha256').update(head).update(diff);
        for (const file of files) {
            hash.update(file);
            const full = path.join(repo, file);
            try {
                const s = lstatSync(full);
                const body = s.isSymbolicLink() ? Buffer.from(readlinkSync(full)) : readFileSync(full);
                hash.update(String(s.mode));
                hash.update(body);
                if (untracked.includes(file))
                    diff += `\nUntracked: ${file}\n${body.includes(0) ? '[binary file]' : body.toString('utf8')}\n`;
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                hash.update('deleted');
            }
        }
        return { head, digest: hash.digest('hex'), diff, files };
    }
    catch {
        throw new ExecutionError('EXECUTION_INVALID', 'Code snapshot requires a readable Git repository.');
    }
}
