import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('release version', () => {
  it('is identical across package, Tauri bundle and Rust crate', () => {
    const version = JSON.parse(read('package.json')).version;
    expect(JSON.parse(read('src-tauri/tauri.conf.json')).version).toBe(version);
    expect(/^version = "(.+)"/m.exec(read('src-tauri/Cargo.toml'))?.[1]).toBe(version);
    expect(__APP_VERSION__).toBe(version);
  });
});
