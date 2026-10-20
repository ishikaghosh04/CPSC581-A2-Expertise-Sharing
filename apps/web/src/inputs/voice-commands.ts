export type BrightnessPreset = 'low' | 'medium' | 'high';
export type VoiceRunState =
  | 'off'
  | 'starting'
  | 'listening'
  | 'listening-unmetered'
  | 'error';

interface RecognitionAlternative {
  transcript: string;
}

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative;
}

interface RecognitionResultEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResult>;
}

interface RecognitionErrorEvent {
  readonly error: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(audioTrack?: MediaStreamTrack): void;
  stop(): void;
}

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
}

function parseBrightnessCommand(transcript: string): BrightnessPreset | null {
  const normalized = transcript.toLowerCase().replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ').trim();
  const match = normalized.match(/\b(low|medium|high) brightness\b/);
  if (!match) return null;
  if (match[1] === 'low' || match[1] === 'medium' || match[1] === 'high') return match[1];
  return null;
}

function recognitionErrorMessage(error: string): string {
  if (error === 'not-allowed' || error === 'service-not-allowed') {
    return 'Microphone permission was denied. Allow microphone access in browser settings, then try again.';
  }
  if (error === 'audio-capture') {
    return 'No microphone is available. Connect a microphone and try again.';
  }
  if (error === 'no-speech') return 'No speech was heard. Try speaking a brightness command.';
  if (error === 'network') return 'Speech recognition needs a network connection in this browser.';
  if (error === 'aborted') return 'Microphone listening was interrupted.';
  return 'Speech recognition encountered an error. Try again.';
}

export class VoiceCommandController {
  private recognition: SpeechRecognitionLike | null = null;
  private active = false;
  private metered = false;
  private runId = 0;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private frameRequest = 0;

  constructor(
    private readonly onStatus: (message: string, state: VoiceRunState) => void,
    private readonly onCommand: (preset: BrightnessPreset) => void,
    private readonly onAudioLevel: (level: number | null) => void
  ) {}

  get isActive(): boolean {
    return this.active;
  }

  async start(): Promise<void> {
    if (this.active) return;
    const speechWindow = window as SpeechRecognitionWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      this.onStatus(
        'Speech recognition is not supported in this browser. Try Chrome or Edge.',
        'error'
      );
      return;
    }

    const runId = ++this.runId;
    this.active = true;
    this.metered = false;
    this.onStatus('Requesting microphone access…', 'starting');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is unavailable in this browser.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!this.isCurrentRun(runId)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      this.stream = stream;
      try {
        await this.startAudioMeter(stream);
      } catch (meterError) {
        if (!this.isCurrentRun(runId)) return;
        console.info('Live microphone metering is unavailable; using speech recognition without a meter.', meterError);
        this.startUnmeteredRecognition(
          Recognition,
          runId,
          'Listening · live microphone level is not supported by this browser.'
        );
        return;
      }
      if (!this.isCurrentRun(runId)) return;

      let recognition = this.createRecognition(Recognition, runId);
      this.recognition = recognition;
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) throw new Error('No microphone audio track is available.');

      try {
        recognition.start(audioTrack);
        this.metered = true;
        this.onStatus('Listening', 'listening');
      } catch (trackError) {
        console.info('Speech recognition cannot use a supplied microphone track; using its built-in input.', trackError);
        this.startUnmeteredRecognition(
          Recognition,
          runId,
          'Listening · live microphone level is not supported by this browser.'
        );
      }
    } catch (error) {
      if (!this.isCurrentRun(runId)) return;
      console.error('voice input could not start', error);
      this.active = false;
      this.recognition = null;
      this.stopAudioMeter();
      this.onStatus(this.startErrorMessage(error), 'error');
    }
  }

  stop(): void {
    ++this.runId;
    const recognition = this.recognition;
    this.recognition = null;
    this.active = false;
    this.metered = false;
    if (recognition) recognition.stop();
    this.stopAudioMeter();
    this.onStatus('Microphone is off.', 'off');
  }

  private isCurrentRun(runId: number): boolean {
    return this.active && runId === this.runId;
  }

  private startUnmeteredRecognition(
    Recognition: new () => SpeechRecognitionLike,
    runId: number,
    status: string
  ): void {
    this.stopAudioMeter();
    const recognition = this.createRecognition(Recognition, runId);
    this.recognition = recognition;
    recognition.start();
    this.metered = false;
    this.onStatus(status, 'listening-unmetered');
  }

  private createRecognition(
    Recognition: new () => SpeechRecognitionLike,
    runId: number
  ): SpeechRecognitionLike {
    const recognition = new Recognition();
    let lastErrorMessage: string | null = null;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (event) => {
      if (this.recognition !== recognition || !this.isCurrentRun(runId)) return;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result || !result.isFinal) continue;
        const alternative = result[0];
        if (!alternative) continue;
        const transcript = alternative.transcript.trim();
        const preset = parseBrightnessCommand(transcript);
        this.onStatus(
          preset ? `Recognized: “${transcript}”` : `Recognized: “${transcript}” — no matching command.`,
          this.metered ? 'listening' : 'listening-unmetered'
        );
        if (preset) this.onCommand(preset);
      }
    };
    recognition.onerror = (event) => {
      if (this.recognition !== recognition || !this.isCurrentRun(runId)) return;
      lastErrorMessage = recognitionErrorMessage(event.error);
      this.active = false;
      this.recognition = null;
      this.stopAudioMeter();
      this.onStatus(lastErrorMessage, 'error');
    };
    recognition.onend = () => {
      if (this.recognition !== recognition || !this.isCurrentRun(runId)) return;
      this.active = false;
      this.recognition = null;
      this.stopAudioMeter();
      this.onStatus(lastErrorMessage ?? 'Microphone is off.', lastErrorMessage ? 'error' : 'off');
    };
    return recognition;
  }

  private async startAudioMeter(stream: MediaStream): Promise<void> {
    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor) {
      throw new Error('Live microphone monitoring is not supported in this browser.');
    }

    const context = new AudioContextConstructor();
    this.audioContext = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    this.analyser = analyser;
    await context.resume();

    const samples = new Uint8Array(analyser.fftSize);
    const updateLevel = (): void => {
      if (!this.active || this.analyser !== analyser || context.state !== 'running') return;
      analyser.getByteTimeDomainData(samples);
      let sumSquares = 0;
      for (const sample of samples) {
        const value = (sample - 128) / 128;
        sumSquares += value * value;
      }
      const rms = Math.sqrt(sumSquares / samples.length);
      this.onAudioLevel(rms < 0.008 ? 0 : Math.min(rms, 1));
      this.frameRequest = window.setTimeout(updateLevel, 33);
    };
    updateLevel();
  }

  private stopAudioMeter(): void {
    if (this.frameRequest) window.clearTimeout(this.frameRequest);
    this.frameRequest = 0;
    this.analyser?.disconnect();
    this.analyser = null;
    const context = this.audioContext;
    this.audioContext = null;
    if (context && context.state !== 'closed') void context.close();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.onAudioLevel(null);
  }

  private startErrorMessage(error: unknown): string {
    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
        return 'Microphone permission was denied. Allow microphone access in browser settings, then try again.';
      }
      if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        return 'No microphone was found. Connect a microphone and try again.';
      }
    }
    return error instanceof Error
      ? error.message
      : 'Could not start the microphone. Check browser permissions and try again.';
  }
}
