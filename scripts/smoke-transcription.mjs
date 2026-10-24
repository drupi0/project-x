// Optional real Whisper smoke test. Uses only generated fictional speech, no downloads.
// macOS: node scripts/smoke-transcription.mjs (app + Whisper must be running).
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const base = new URL(process.env.TEST_APP_URL || 'http://127.0.0.1:3000');
assert(['localhost', '127.0.0.1'].includes(base.hostname), 'Use the local fictional test app.');
const directory = await mkdtemp(join(tmpdir(), 'fictional-whisper-test-'));
try {
  const file = join(directory, 'generated.wav');
  execFileSync('say', ['-r', '135', '--file-format=WAVE', '--data-format=LEI16@16000', '-o', file,
    'This is a fictional test. My name is Samir. I am from Sudan and I am staying in Cairo.']);
  const wav = await readFile(file);
  let pcm;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    if (wav.toString('ascii', offset, offset + 4) === 'data') pcm = wav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + size % 2;
  }
  assert(pcm?.length, 'Generated speech must contain PCM data.');
  // Canonical WAV header required by our existing upload boundary.
  const bytes = Buffer.alloc(44 + pcm.length);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(pcm.length, 40); pcm.copy(bytes, 44);
  for (const vocabulary of [[], ['Samir', 'Sudan', 'Cairo']]) {
    const response = await fetch(new URL('/api/transcribe', base), {
      method: 'POST', headers: { 'Content-Type': 'audio/wav',
        'X-Transcription-Vocabulary': encodeURIComponent(JSON.stringify(vocabulary)) },
      body: bytes, signal: AbortSignal.timeout(130000)
    });
    assert.equal(response.status, 200, 'Transcription request failed.');
    const result = await response.json();
    assert.equal(typeof result.rawText, 'string');
    assert(result.text.trim().length > 0);
    // Counts and match booleans only; no transcript logging or saved recordings.
    console.log({ hints: vocabulary.length, recognizedWords: result.text.split(/\s+/).length,
      nameRecognized: /samir/i.test(result.text), originRecognized: /sudan/i.test(result.text), cityRecognized: /cairo/i.test(result.text) });
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
