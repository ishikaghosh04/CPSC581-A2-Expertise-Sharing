export type BrightnessPreset = 'low' | 'medium' | 'high';
export type VoiceRunState = 'off' | 'listening' | 'error';

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
  start(): void;
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

  constructor(
    private readonly onStatus: (message: string, state: VoiceRunState) => void,
    private readonly onCommand: (preset: BrightnessPreset) => void
  ) {}

  get isActive(): boolean {
    return this.active;
  }

  start(): void {
    const speechWindow = window as SpeechRecognitionWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      this.onStatus(
        'Speech recognition is not supported in this browser. Try Chrome or Edge.',
        'error'
      );
      return;
    }

    const recognition = new Recognition();
    let lastErrorMessage: string | null = null;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (event) => {
      if (this.recognition !== recognition || !this.active) return;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result || !result.isFinal) continue;
        const alternative = result[0];
        if (!alternative) continue;
        const transcript = alternative.transcript.trim();
        const preset = parseBrightnessCommand(transcript);
        this.onStatus(preset
          ? `Recognized: “${transcript}”`
          : `Recognized: “${transcript}” — no matching command.`, 'listening');
        if (preset) this.onCommand(preset);
      }
    };
    recognition.onerror = (event) => {
      if (this.recognition !== recognition || !this.active) return;
      lastErrorMessage = recognitionErrorMessage(event.error);
      this.active = false;
      this.recognition = null;
      this.onStatus(lastErrorMessage, 'error');
    };
    recognition.onend = () => {
      if (this.recognition === recognition) {
        this.active = false;
        this.recognition = null;
        this.onStatus(lastErrorMessage ?? 'Microphone is off.', lastErrorMessage ? 'error' : 'off');
      }
    };

    try {
      recognition.start();
      this.recognition = recognition;
      this.active = true;
      this.onStatus('Listening for a brightness command…', 'listening');
    } catch (error) {
      console.error('speech recognition could not start', error);
      this.onStatus(
        'Could not start the microphone. Check browser permissions and try again.',
        'error'
      );
    }
  }

  stop(): void {
    const recognition = this.recognition;
    this.recognition = null;
    this.active = false;
    if (recognition) recognition.stop();
    this.onStatus('Microphone is off.', 'off');
  }
}
