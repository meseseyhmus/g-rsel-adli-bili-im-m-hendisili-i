/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useCallback, useEffect } from 'react';
import { askPulsarAI } from '@/lib/gemini';
import axios from 'axios';

// ── Types ────────────────────────────────────────────────────────
export type VoiceStatus =
  | 'idle'
  | 'listening'
  | 'wakeword_detected'
  | 'processing'
  | 'speaking'
  | 'silent_mode'
  | 'standby'
  | 'error';

export type VoiceMode = 'push_to_talk' | 'continuous';

export interface VoiceCommandEvent {
  type: 'greeting' | 'status' | 'jamming' | 'spoofing' | 'stop_attack' | 'last_alarm' | 'download' | 'silent' | 'shutdown' | 'help' | 'unknown' | 'no_speech';
  transcript: string;
  response: string;
}

export interface UseVoiceCommandsOptions {
  onTriggerJammingTest?: () => void;
  onOpenXAIPanel?: () => void;
  onDownloadEvidence?: () => void;
  getSystemStatus?: () => string;
  getLastAlarm?: () => string;
  getTrustScore?: () => number;
  onEventHandled?: (event: VoiceCommandEvent) => void;
  micDeviceId?: string;
}

// ── Constants ────────────────────────────────────────────────────
const WAKE_WORDS = ['pulsar', 'jarvis'];

const RESPONSES = {
  greeting: (score: number) => `Efendim, hoş geldiniz. Sistem normal operasyonda. Güven skoru ${score}.`,
  status: (s: string) => s,
  jamming: `Jamming saldırısı başlatılıyor efendim. Red Team protokolü aktive edildi.`,
  spoofing: `Spoofing testi başlatılıyor efendim. Sistem hazırlanıyor.`,
  stop_attack: `Saldırı durduruluyor efendim. Sistem normale dönüyor.`,
  last_alarm: (alarm: string) => `Son alarm kaydı: ${alarm}. Açıklayıcı panel açıldı efendim.`,
  download: `Delil paketi hazırlanıyor. JSON formatında dışa aktarılıyor efendim.`,
  silent_on: `Sessiz mod aktive edildi. Sesli yanıtlar devre dışı efendim.`,
  silent_off: `Sesli mod yeniden aktive edildi. Dinliyorum efendim.`,
  shutdown: `Sistemi bekleme moduna alıyorum efendim. Görüşmek üzere.`,
  help: `Mevcut komutlar: merhaba, sistem durumu, jamming başlat, spoofing testi yap, saldırıyı durdur, son alarmı açıkla, delil paketini indir, sessiz mod, kapat.`,
  no_speech: `Sizi duyamadım efendim, tekrar eder misiniz?`,
  mic_denied: `Mikrofon izni reddedildi. Lütfen tarayıcı ayarlarından mikrofon iznini etkinleştirin.`,
};

// ── Command matcher ───────────────────────────────────────────────
export function matchCommand(transcript: string): VoiceCommandEvent['type'] | null {
  const t = transcript.toLowerCase().trim();
  if (t.includes('merhaba') || t.includes('hoş geldin') || t.includes('selam')) return 'greeting';
  if (t.includes('sistem durumu') || t.includes('durum nedir') || t.includes('durum raporu') || t.includes('sistem raporu')) return 'status';
  if (t.includes('jamming') && (t.includes('başlat') || t.includes('start') || t.includes('yap'))) return 'jamming';
  if (t.includes('spoofing') && (t.includes('başlat') || t.includes('start') || t.includes('yap') || t.includes('test'))) return 'spoofing';
  if (t.includes('saldırı') && (t.includes('durdur') || t.includes('stop') || t.includes('bitir'))) return 'stop_attack';
  if (t.includes('red team') || t.includes('saldırı testi') || t.includes('test başlat')) return 'jamming';
  if (t.includes('son alarm') || t.includes('alarm açıkla') || t.includes('alarm detay') || t.includes('son uyarı')) return 'last_alarm';
  if (t.includes('delil') || t.includes('indir') || t.includes('kaydet') || t.includes('export')) return 'download';
  if (t.includes('sessiz') || t.includes('ses kapat') || t.includes('mute')) return 'silent';
  if (t.includes('kapat') || t.includes('bekle') || t.includes('bekleme') || t.includes('sleep')) return 'shutdown';
  if (t.includes('komut') || t.includes('yardım') || t.includes('help')) return 'help';
  return null;
}

// ── Hook ─────────────────────────────────────────────────────────
export function useVoiceCommands(options: UseVoiceCommandsOptions = {}) {
  const {
    onTriggerJammingTest, onOpenXAIPanel, onDownloadEvidence,
    getSystemStatus, getLastAlarm, getTrustScore, onEventHandled,
    micDeviceId,
  } = options;

  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [mode] = useState<VoiceMode>('push_to_talk');
  const [lastEvent, setLastEvent] = useState<VoiceCommandEvent | null>(null);
  const [transcript, setTranscript] = useState('');
  const [isSilentMode, setIsSilentMode] = useState(false);
  const [wakeWordDetected, setWakeWordDetected] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [micAvailable, setMicAvailable] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [micLevel, setMicLevel] = useState(0);        // 0-100 canlı ses seviyesi
  const [soundDetected, setSoundDetected] = useState(false); // ses sinyali var mı
  const [speechDetected, setSpeechDetected] = useState(false); // konuşma var mı

  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const continuousRef = useRef(false);
  const onEventHandledRef = useRef(onEventHandled);
  const micDeviceIdRef = useRef(micDeviceId);
  const collectedRef = useRef(''); // PTT sırasında biriken metin

  // ── UI Sound Effects (Cyber Style) ──────────────────────────
  const playUISound = useCallback((type: 'start' | 'stop' | 'success' | 'processing' | 'error') => {
    if (isSilentMode) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const masterGain = ctx.createGain();
      masterGain.connect(ctx.destination);
      masterGain.gain.setValueAtTime(0, ctx.currentTime);
      masterGain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.01);

      if (type === 'start') {
        // High-pitched "listen" beep
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
        osc.connect(masterGain);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
        masterGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      } else if (type === 'stop') {
        // Lower-pitched "stop" blip
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
        osc.connect(masterGain);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
        masterGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      } else if (type === 'processing') {
        // Subtle "thinking" pulse
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        osc.connect(masterGain);
        osc.start();
        osc.stop(ctx.currentTime + 0.2);
        masterGain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.1);
        masterGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      } else if (type === 'success') {
        // Affirmative double beep
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1100, ctx.currentTime);
        osc.connect(masterGain);
        osc.start();
        osc.stop(ctx.currentTime + 0.2);
        masterGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        
        ctx.onstatechange = () => { if (ctx.state === 'closed') return; };
        setTimeout(() => {
          if (ctx.state === 'closed') return;
          const osc2 = ctx.createOscillator();
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(1320, ctx.currentTime);
          osc2.connect(masterGain);
          osc2.start();
          osc2.stop(ctx.currentTime + 0.1);
        }, 100);
      } else if (type === 'error') {
        // Error buzz
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(110, ctx.currentTime);
        osc.connect(masterGain);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
        masterGain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.05);
        masterGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      }

      setTimeout(() => ctx.close().catch(() => {}), 1000);
    } catch (e) {
      console.error('Sound play error:', e);
    }
  }, [isSilentMode]);

  useEffect(() => { onEventHandledRef.current = onEventHandled; }, [onEventHandled]);
  useEffect(() => { micDeviceIdRef.current = micDeviceId; }, [micDeviceId]);

  // ── Speech synthesis ──────────────────────────────────────────
  useEffect(() => {
    if ('speechSynthesis' in window) synthRef.current = window.speechSynthesis;
  }, []);

  // ── Speak ─────────────────────────────────────────────────────
  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (!synthRef.current || isSilentMode) { onEnd?.(); return; }
    synthRef.current.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'tr-TR';
    utter.rate = 0.95;
    utter.pitch = 1.0;
    utter.volume = 1;
    const setVoice = () => {
      const voices = synthRef.current!.getVoices();
      const preferred =
        voices.find(v => v.lang.startsWith('tr') && v.name.toLowerCase().includes('google')) ||
        voices.find(v => v.lang.startsWith('tr') && v.name.toLowerCase().includes('microsoft')) ||
        voices.find(v => v.lang.startsWith('tr')) ||
        voices[0];
      if (preferred) utter.voice = preferred;
    };
    if (speechSynthesis.getVoices().length > 0) setVoice();
    else speechSynthesis.addEventListener('voiceschanged', setVoice, { once: true });
    utter.onstart = () => setStatus('speaking');
    utter.onend = () => { setStatus('idle'); onEnd?.(); };
    utter.onerror = () => { setStatus('idle'); onEnd?.(); };
    synthRef.current.speak(utter);
  }, [isSilentMode]);

  const stopMicMonitor = useCallback(() => {
    if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => null); audioCtxRef.current = null; }
    analyserRef.current = null;
    setMicLevel(0);
  }, []);

  // ── Stream kapat ──────────────────────────────────────────────
  const stopActiveStream = useCallback(() => {
    stopMicMonitor();
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach(t => t.stop());
      activeStreamRef.current = null;
    }
  }, [stopMicMonitor]);

  // ── Seçili mikrofonu aç, cihazı Chrome'a kayıt ettir, sonra kapat ──
  // Chrome SR cihaz seçimi: getUserMedia ile cihazı "aktif" hale getirip kapattıktan
  // sonra SR başlatırsak, Chrome o cihazı SR için kullanır.
  const openMicStream = useCallback(async (): Promise<boolean> => {
    stopActiveStream();
    try {
      const deviceId = micDeviceIdRef.current;
      const constraint: MediaStreamConstraints['audio'] =
        deviceId && deviceId !== 'default'
          ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true }
          : { echoCancellation: true, noiseSuppression: true };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: constraint });
      // Stream'i sakla ama hemen kapatıyoruz —
      // Chrome cihazı "son aktif cihaz" olarak register eder,
      // ardından SR aynı cihazı kullanır.
      stream.getTracks().forEach(t => t.stop());
      console.log('[PULSAR MIC] ✅ Cihaz kayıt edildi:', deviceId || 'default');
      return true;
    } catch (err: any) {
      console.error('[PULSAR MIC] ❌ Cihaz açılamadı:', err.message);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setPermissionDenied(true);
      }
      setMicAvailable(false);
      return false;
    }
  }, [stopActiveStream]);

  // ── Komutu işle ───────────────────────────────────────────────
  const processCommand = useCallback(async (rawTranscript: string) => {
    if (!rawTranscript.trim()) return;
    setTranscript(rawTranscript);
    setStatus('processing');
    playUISound('processing');
    const score = getTrustScore?.() ?? 96;
    let cmd = rawTranscript.toLowerCase();
    WAKE_WORDS.forEach(w => { cmd = cmd.replace(w, '').trim(); });
    const commandType = matchCommand(cmd);
    let response = '';
    let event: VoiceCommandEvent;

    switch (commandType) {
      case 'greeting':
        response = RESPONSES.greeting(score);
        event = { type: 'greeting', transcript: rawTranscript, response };
        break;
      case 'status': {
        const statusText = getSystemStatus?.() ?? `Sistem normal. Güven skoru ${score}.`;
        response = RESPONSES.status(statusText);
        event = { type: 'status', transcript: rawTranscript, response };
        break;
      }
      case 'jamming':
        response = RESPONSES.jamming;
        event = { type: 'jamming', transcript: rawTranscript, response };
        try {
          await axios.post('http://localhost:8000/api/attack/start', { attack_name: 'jamming' });
          speak(response, () => onTriggerJammingTest?.());
        } catch {
          response = 'Jamming başlatılamadı efendim. Backend bağlantısını kontrol edin.';
          speak(response);
        }
        setLastEvent(event); onEventHandledRef.current?.(event); setWakeWordDetected(false); return;
      case 'spoofing':
        response = RESPONSES.spoofing;
        event = { type: 'spoofing', transcript: rawTranscript, response };
        try {
          await axios.post('http://localhost:8000/api/attack/start', { attack_name: 'spoofing' });
          speak(response, () => onTriggerJammingTest?.());
        } catch {
          response = 'Spoofing testi başlatılamadı efendim. Backend bağlantısını kontrol edin.';
          speak(response);
        }
        setLastEvent(event); onEventHandledRef.current?.(event); setWakeWordDetected(false); return;
      case 'stop_attack':
        response = RESPONSES.stop_attack;
        event = { type: 'stop_attack', transcript: rawTranscript, response };
        try {
          await axios.post('http://localhost:8000/api/attack/stop', { attack_name: 'all' });
          speak(response);
        } catch {
          response = 'Saldırı durdurulamadı efendim. Backend bağlantısını kontrol edin.';
          speak(response);
        }
        setLastEvent(event); onEventHandledRef.current?.(event); setWakeWordDetected(false); return;
      case 'last_alarm': {
        const alarm = getLastAlarm?.() ?? 'Kayıtlı alarm bulunamadı.';
        response = RESPONSES.last_alarm(alarm);
        event = { type: 'last_alarm', transcript: rawTranscript, response };
        speak(response, () => onOpenXAIPanel?.());
        setLastEvent(event); onEventHandledRef.current?.(event); setWakeWordDetected(false); return;
      }
      case 'download':
        response = RESPONSES.download;
        event = { type: 'download', transcript: rawTranscript, response };
        speak(response, () => onDownloadEvidence?.());
        setLastEvent(event); onEventHandledRef.current?.(event); setWakeWordDetected(false); return;
      case 'silent':
        response = isSilentMode ? RESPONSES.silent_off : RESPONSES.silent_on;
        setIsSilentMode(v => !v);
        event = { type: 'silent', transcript: rawTranscript, response };
        break;
      case 'shutdown':
        response = RESPONSES.shutdown;
        event = { type: 'shutdown', transcript: rawTranscript, response };
        speak(response, () => { continuousRef.current = false; setIsRecording(false); setStatus('standby'); });
        setLastEvent(event); onEventHandledRef.current?.(event); setWakeWordDetected(false); return;
      case 'help':
        response = RESPONSES.help;
        event = { type: 'help', transcript: rawTranscript, response };
        break;
      default:
        response = await askPulsarAI(rawTranscript, `Güven Skoru: ${score}`);
        event = { type: 'unknown', transcript: rawTranscript, response };
    }
    setLastEvent(event);
    onEventHandledRef.current?.(event);
    setWakeWordDetected(false);
    speak(response);
  }, [speak, isSilentMode, getTrustScore, getSystemStatus, getLastAlarm, onTriggerJammingTest, onOpenXAIPanel, onDownloadEvidence]);

  // ── Recognition instance ──────────────────────────────────────
  const buildRecognition = useCallback(() => {
    const API = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!API) return null;
    const rec = new API();
    rec.lang = 'tr-TR';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    return rec;
  }, []);

  // ── Push-to-Talk: BAŞLAT ──────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (isRecording || status === 'processing' || status === 'speaking') return;

    const API = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!API) {
      setMicAvailable(false);
      console.error('[PULSAR MIC] ❌ SpeechRecognition API yok. Google Chrome kullanın.');
      return;
    }

    // Cihazı Chrome'a kayıt ettir
    const streamOk = await openMicStream();
    if (!streamOk) return;

    // Chrome'un audio routing'i güncellemesi için bekliyoruz
    await new Promise(r => setTimeout(r, 300));

    const rec = buildRecognition();
    if (!rec) { setMicAvailable(false); return; }

    recognitionRef.current = rec;
    collectedRef.current = '';
    setIsRecording(true);
    setSoundDetected(false);
    setSpeechDetected(false);
    setTranscript('');
    setMicLevel(0);

    rec.onstart = () => {
      console.log('[PULSAR SR] 🎙 Recognition başladı — konuşabilirsiniz');
      setStatus('listening');
      playUISound('start');
      // Başladığında düşük seviye animasyonu
      setMicLevel(5);
    };

    rec.onsoundstart = () => {
      console.log('[PULSAR SR] 🔊 Ses sinyali alındı!');
      setSoundDetected(true);
      setMicLevel(45);
    };

    rec.onspeechstart = () => {
      console.log('[PULSAR SR] 🗣 Konuşma algılandı!');
      setSpeechDetected(true);
      setMicLevel(80);
    };

    rec.onspeechend = () => {
      console.log('[PULSAR SR] Konuşma bitti, işleniyor...');
      setMicLevel(20);
    };

    rec.onresult = (event: any) => {
      let final = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) final += event.results[i][0].transcript;
        else interim += event.results[i][0].transcript;
      }
      if (final) collectedRef.current += ' ' + final;
      const displayText = (collectedRef.current + ' ' + interim).trim();
      setTranscript(displayText);
      console.log('[PULSAR SR] 📝 Metin:', displayText);
    };

    rec.onerror = (e: any) => {
      console.error('[PULSAR SR] ❌ Hata:', e.error);
      if (e.error === 'not-allowed' || e.error === 'permission-denied') {
        setPermissionDenied(true);
        setMicAvailable(false);
        setIsRecording(false);
        stopActiveStream();
        setStatus('error');
      } else if (e.error === 'no-speech') {
        // no-speech: recognition henüz ses almadı, devam et — onend sonra gelir
        console.log('[PULSAR SR] 🔇 no-speech — kullanıcı henüz konuşmadı');
      } else if (e.error === 'network') {
        console.error('[PULSAR SR] ❌ Network hatası — internet bağlantısı gerekli');
        setStatus('error');
      } else if (e.error === 'audio-capture') {
        console.error('[PULSAR SR] ❌ Ses yakalama hatası — mikrofon erişilemiyor');
        setStatus('error');
      }
    };

    rec.onend = () => {
      console.log('[PULSAR SR] Bitti. Toplanan:', collectedRef.current.trim());
      playUISound('stop');
      // Eğer hâlâ recording state'indeyse ve collected boşsa → no-speech, yeniden başlat
      // Eğer kullanıcı butona basmadan ended → yeniden başlatma, sadece dur
      setIsRecording(false);
      stopActiveStream();
      setSoundDetected(false);
      setSpeechDetected(false);
      const collected = collectedRef.current.trim();
      if (collected.length > 1) {
        processCommand(collected);
      } else {
        setStatus('idle');
        setTranscript('');
      }
    };

    try {
      rec.start();
    } catch (err) {
      console.error('[PULSAR SR] rec.start() hatası:', err);
      setIsRecording(false);
      stopActiveStream();
    }
  }, [isRecording, status, openMicStream, buildRecognition, processCommand, stopActiveStream]);

  // ── Push-to-Talk: DURDUR ──────────────────────────────────────
  const stopRecording = useCallback(() => {
    if (!isRecording) return;
    console.log('[PULSAR SR] Kullanıcı durdurdu, toplanan:', collectedRef.current.trim());
    recognitionRef.current?.stop(); // onend fırlar ve transcript işlenir
  }, [isRecording]);

  // ── Toggle ────────────────────────────────────────────────────
  const toggleRecording = useCallback(() => {
    if (isRecording) stopRecording();
    else startRecording();
  }, [isRecording, startRecording, stopRecording]);

  // ── Eski API uyumluluğu ───────────────────────────────────────
  const startListening = useCallback(() => { startRecording(); }, [startRecording]);
  const stopListening = useCallback(() => {
    continuousRef.current = false;
    recognitionRef.current?.stop();
    synthRef.current?.cancel();
    stopActiveStream();
    setIsRecording(false);
    setStatus('idle');
    setWakeWordDetected(false);
    setTranscript('');
  }, [stopActiveStream]);
  const toggleListening = toggleRecording;

  return {
    status,
    mode,
    setMode: () => {},
    lastEvent,
    transcript,
    isSilentMode,
    wakeWordDetected,
    permissionDenied,
    micAvailable,
    isRecording,
    micLevel,
    soundDetected,
    speechDetected,
    startListening,
    stopListening,
    toggleListening,
    startRecording,
    stopRecording,
    toggleRecording,
    speak: useCallback((text: string) => speak(text), [speak]),
    setIsSilentMode,
  };
}
