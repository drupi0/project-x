// macOS-only synthetic speech check. Never opens a real microphone or sends a chat request.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeWav } from '../src/lib/audio/wav.ts';

const directory = mkdtempSync(join(tmpdir(), 'refugee-voice-smoke-'));
const sample = join(directory, 'synthetic.aiff');
try {
  execFileSync('say', ['-o', sample, 'This is a test of the voice recording system.']);
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', sample, '-ar', '16000', '-ac', '1', '-f', 's16le', 'pipe:1']);
  const samples = new Float32Array(pcm.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
  const base = process.env.APP_URL || 'http://127.0.0.1:3000';
  const response = await fetch(`${base}/api/transcribe`, {
    method: 'POST', headers: { 'Content-Type': 'audio/wav', Origin: base }, body: encodeWav(samples),
    signal: AbortSignal.timeout(125000)
  });
  const result = await response.json();
  assert.equal(response.status, 200, result.error);
  assert.match(result.text, /voice recording system/i);
  console.log('PASS: synthetic speech transcribed through the app and real local Whisper service. No chat provider called.');
} finally {
  try { unlinkSync(sample); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  rmdirSync(directory);
}
