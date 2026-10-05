// Runs the Android Gradle wrapper on any OS: node scripts/gradle.mjs <task…>
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const cwd = join(import.meta.dirname, '..', 'android');
const windows = process.platform === 'win32';
// cmd.exe needs the full, quoted path (the project path may contain spaces).
const command = windows ? `"${join(cwd, 'gradlew.bat')}"` : './gradlew';
const result = spawnSync(command, process.argv.slice(2), { cwd, stdio: 'inherit', shell: windows });
process.exit(result.status ?? 1);
