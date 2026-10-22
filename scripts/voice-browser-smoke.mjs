import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Use a generated tone, never the machine's real microphone.
  await page.addInitScript(() => {
    window.testTracks = [];
    class TestUtterance {
      constructor(text) { this.text = text; this.lang = ''; this.voice = null; this.onend = null; this.onerror = null; }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: TestUtterance });
    let activeUtterance;
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ localService: true, default: true, lang: 'en-US', voiceURI: 'test', name: 'Test voice' }],
      addEventListener() {}, removeEventListener() {},
      cancel() {
        if (activeUtterance?.onerror) {
          const cancelled = activeUtterance; activeUtterance = undefined;
          cancelled.onerror({ error: 'interrupted' });
        }
      },
      speak(utterance) {
        activeUtterance = utterance;
        if (utterance.text.startsWith('Hi,')) setTimeout(() => { activeUtterance = undefined; utterance.onend?.(); }, 20);
      }
    } });
    navigator.mediaDevices.getUserMedia = async () => {
      if (window.denyMic) throw new DOMException('Denied', 'NotAllowedError');
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      oscillator.connect(destination); oscillator.start(); await context.resume();
      const track = destination.stream.getTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => { stop(); oscillator.stop(); void context.close(); };
      window.testTracks.push(track);
      return destination.stream;
    };
  });
  let chatCalls = 0;
  let transcriptions = 0;
  let hold = false;
  await page.route('**/api/transcribe', async route => {
    transcriptions++;
    const bytes = route.request().postDataBuffer();
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
    assert.equal(bytes.readUInt32LE(24), 16000);
    if (hold) await new Promise(resolve => setTimeout(resolve, 600));
    await route.fulfill({ json: { text: 'A fictional voice test.' } }).catch(() => {});
  });
  await page.route('**/api/chat', route => { chatCalls++; return route.fulfill({ json: { message: { role: 'assistant', content: 'What would you like to share?' } } }); });
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:3000');
  await page.getByLabel('Your message').fill('Existing draft.');
  async function record() {
    await page.getByRole('button', { name: 'Record message', exact: true }).click();
    await page.getByRole('button', { name: 'Stop & transcribe' }).waitFor();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Stop & transcribe' }).click();
  }
  await record();
  await page.getByText('Review and correct the transcript below, then press Send.').waitFor();
  assert.equal(await page.getByLabel('Your message').inputValue(), 'Existing draft.\nA fictional voice test.');
  assert.equal(chatCalls, 0);
  assert.ok(await page.evaluate(() => window.testTracks.every(t => t.readyState === 'ended')));
  await page.getByLabel('Your message').fill('Corrected fictional text.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('What would you like to share?', { exact: true }).waitFor();
  assert.equal(chatCalls, 1);
  hold = true;
  await record();
  await page.waitForFunction(() => document.body.innerText.includes('Transcribing…'));
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await page.waitForTimeout(800);
  assert.equal(await page.getByLabel('Your message').inputValue(), '');
  await page.getByRole('button', { name: 'Record message', exact: true }).click();
  await page.getByRole('button', { name: 'Stop & transcribe' }).waitFor();
  await page.getByRole('button', { name: 'Cancel recording' }).click();
  assert.ok(await page.evaluate(() => window.testTracks.every(t => t.readyState === 'ended')));
  await page.evaluate(() => { window.denyMic = true; });
  await page.getByRole('button', { name: 'Record message', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /permission was denied/);
  assert.equal(await page.getByLabel('Your message').isEnabled(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  assert.ok(transcriptions >= 1);
  // Exercise the call-like VAD/record/transcribe/chat loop with generated audio.
  // The speech engine is mocked so an interruption is deterministic and repeatable.
  hold = false;
  await page.getByRole('button', { name: 'Start voice call' }).click();
  await page.getByRole('button', { name: 'I’m done speaking' }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'I’m done speaking' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('What would you like to share?'));
  await page.getByRole('button', { name: 'Interrupt AI and speak' }).waitFor();
  await page.getByRole('button', { name: 'Interrupt AI and speak' }).click();
  await page.getByRole('button', { name: 'I’m done speaking' }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'End call' }).click();
  assert.ok(await page.evaluate(() => window.testTracks.every(t => t.readyState === 'ended')));
  assert.deepEqual(errors, []);
  console.log('PASS: browser recording/PCM conversion, transcript review and correction, explicit send, cancellation, restart, VAD call loop, interrupted AI speech/resumed listening, microphone cleanup, denied permission and mobile layout. Transcription, chat and speech output mocked.');
} finally { await browser.close(); }
