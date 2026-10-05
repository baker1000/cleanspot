// Creates the Android upload key for Google Play (Play App Signing keeps the real app key; this
// key only signs uploads). Writes android/cleanspot-upload.jks and android/keystore.properties,
// both git-ignored. The random password is written to keystore.properties only, never printed.
//
//   npm run android:keystore            create (refuses to overwrite an existing key)
//   npm run android:keystore -- status  show whether a key exists and its fingerprint
//
// BACK UP BOTH FILES (e.g. a password manager). Losing them means asking Google support to
// reset the upload key, which takes days.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ANDROID = join(import.meta.dirname, '..', 'android');
const STORE = join(ANDROID, 'cleanspot-upload.jks');
const PROPS = join(ANDROID, 'keystore.properties');
const ALIAS = 'cleanspot-upload';

const keytool = process.env.JAVA_HOME
  ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool')
  : 'keytool';

function run(args, env = {}) {
  const result = spawnSync(keytool, args, {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return result;
}

function readPassword() {
  const line = readFileSync(PROPS, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('storePassword='));
  return line?.slice('storePassword='.length);
}

const command = process.argv[2] ?? 'create';

if (command === 'status') {
  if (!existsSync(STORE) || !existsSync(PROPS)) {
    console.log('No upload key yet. Create one with: npm run android:keystore');
    process.exit(0);
  }
  const result = run(
    ['-list', '-v', '-keystore', STORE, '-alias', ALIAS, '-storepass:env', 'KS_PASS'],
    {
      KS_PASS: readPassword() ?? '',
    },
  );
  const lines = result.stdout.split(/\r?\n/);
  for (const key of ['Alias name', 'Creation date', 'Valid from', 'SHA256']) {
    const found = lines.find((l) => l.trim().startsWith(key));
    if (found) console.log(found.trim());
  }
  process.exit(result.status ?? 1);
}

if (command !== 'create') {
  console.error(`Unknown command: ${command} (use create or status)`);
  process.exit(1);
}
if (existsSync(STORE) || existsSync(PROPS)) {
  console.error('An upload key already exists (android/cleanspot-upload.jks). Not overwriting it.');
  process.exit(1);
}

const password = randomBytes(24).toString('base64url');
const result = run(
  [
    '-genkeypair',
    '-keystore',
    STORE,
    '-storetype',
    'PKCS12',
    '-alias',
    ALIAS,
    '-keyalg',
    'RSA',
    '-keysize',
    '4096',
    // Google Play requires validity beyond 22 October 2033.
    '-validity',
    '10000',
    '-dname',
    'CN=CleanSpot, O=CleanSpot, C=DE',
    '-storepass:env',
    'KS_PASS',
    '-keypass:env',
    'KS_PASS',
  ],
  { KS_PASS: password },
);
if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status ?? 1);
}
writeFileSync(
  PROPS,
  [
    '# Android upload key for Google Play. Git-ignored. BACK UP this file and the .jks file.',
    'storeFile=cleanspot-upload.jks',
    `storePassword=${password}`,
    `keyAlias=${ALIAS}`,
    `keyPassword=${password}`,
    '',
  ].join('\n'),
  { mode: 0o600 },
);
console.log(
  'Created android/cleanspot-upload.jks and android/keystore.properties (password inside).',
);
console.log('Back up both files now. `npm run android:keystore -- status` shows the fingerprint.');
