import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  b64_32,
  b64url48,
  isUnsetValue,
  parseEnvKeys,
  parseSchemaKeys,
  scanContent,
  SECRET_RULES,
} from '../env-tools.mjs';

describe('gen-secrets helpers (I1.1)', () => {
  it('b64url48 produces 48 bytes → 64 base64url chars', () => {
    const value = b64url48((n) => Buffer.alloc(n, 7));
    assert.equal(value.length, 64);
    assert.match(value, /^[A-Za-z0-9_-]+$/);
  });

  it('b64_32 produces 32 bytes → 44 base64 chars', () => {
    const value = b64_32((n) => Buffer.alloc(n, 9));
    assert.equal(value.length, 44);
  });

  it('isUnsetValue: empty, placeholder and example-prefixed values count as unset', () => {
    for (const v of [undefined, '', '  ', 'CHANGE_ME', 'fill-me', 'example-value', 'test-value']) {
      assert.equal(isUnsetValue(v), true, `expected unset: ${String(v)}`);
    }
  });

  it('isUnsetValue: a real-looking value is never overwritten', () => {
    const real = b64url48((n) => Buffer.alloc(n, 1));
    assert.equal(isUnsetValue(real), false);
    assert.equal(isUnsetValue('a-very-long-random-value-that-looks-real-9f8e7d6c'), false);
  });
});

describe('check-env parsers (I1.1)', () => {
  it('parseEnvKeys collects KEY=value lines', () => {
    const keys = parseEnvKeys('A=1\n# comment\nB_C=hello\n\nlower=x\n');
    assert.deepEqual([...keys].sort(), ['A', 'B_C']);
  });

  it('parseSchemaKeys takes only 2-space-indented keys from the z.object block', () => {
    const source = `
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test']).default('development'),
  API_PORT: z.coerce.number().default(4000),
  NESTED_OBJ: z
    .object({
      INNER_KEY: z.string(),
    })
    .optional(),
});
export const OTHER = z.object({
  NOT_A_SCHEMA_KEY: z.string(),
});
`;
    const keys = parseSchemaKeys(source);
    assert.deepEqual([...keys].sort(), ['API_PORT', 'NESTED_OBJ', 'NODE_ENV']);
  });

  it('parseSchemaKeys throws loudly when the block shape changes', () => {
    assert.throws(
      () => parseSchemaKeys('export const envSchema = z.object({}),'),
      /envSchema block end/,
    );
    assert.throws(() => parseSchemaKeys('nothing here'), /envSchema definition not found/);
  });
});

describe('check-secrets scanner (I1.1)', () => {
  it('flags private keys, sk- tokens, AKIA ids and hex secret assignments with line numbers', () => {
    // Credential-shaped literals are built at runtime so this test file
    // itself never contains a string the scanner would flag.
    const PRIVATE_KEY_HEADER = ['-----BEGIN ', 'RSA PRIVATE KEY', '-----'].join('');
    const AWS_ID = ['AKIA', 'IOSFODNN', '7EXAMPLE'].join('');
    const content = [
      `const a = "${PRIVATE_KEY_HEADER}";`,
      'clean line',
      'const key = "sk-abcdefghijklmnopqrstuvwx";',
      `aws_id = "${AWS_ID}"`,
      'const db_password = "aabbccddeeff00112233445566778899aabbccdd"',
    ].join('\n');
    const findings = scanContent(content);
    assert.equal(findings.length, 4);
    assert.deepEqual(
      findings.map((f) => f.line),
      [1, 3, 4, 5],
    );
    assert.equal(findings[0].rule, 'private key block');
    assert.equal(findings[2].rule, 'AWS access key id');
  });

  it('exempts lines marked fake-secret and accepts clean files', () => {
    assert.deepEqual(scanContent('const key = "sk-abcdefghijklmnopqrstuvwx"; // fake-secret'), []);
    assert.deepEqual(scanContent('totally normal source code\nconst x = 1;'), []);
    assert.deepEqual(scanContent('const hex = "aabbccdd".repeat(4);'), []); // not an assignment to a secret name
  });

  it('short sk- prefixes and short hex do not fire', () => {
    assert.deepEqual(scanContent('const x = "sk-short";'), []);
    assert.deepEqual(scanContent('const token = "aabbccdd";'), []);
    assert.equal(SECRET_RULES.length, 4);
  });
});
