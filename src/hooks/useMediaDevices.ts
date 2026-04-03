import { useState, useEffect, useRef, useCallback } from 'react';

export interface AudioDevice {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
}

export interface UseMediaDevicesReturn {
  audioInputs: AudioDevice[];
  audioOutputs: AudioDevice[];
  selectedMicId: string;
  selectedSpeakerId: string;
  micLevel: number;
  permissionGranted: boolean;
  selectMic: (deviceId: string) => void;
  selectSpeaker: (deviceId: string) => void;
  startMicPreview: (deviceId: string) => Promise<void>;
  stopMicPreview: () => void;
  testSpeaker: (deviceId: string) => void;
  requestPermission: () => Promise<boolean>;
}

export function useMediaDevices(): UseMediaDevicesReturn {
  const [audioInputs, setAudioInputs] = useState<AudioDevice[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<AudioDevice[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>(
    () => localStorage.getItem('pulsar_mic_id') || 'default'
  );
  const [selectedSpeakerId, setSelectedSpeakerId] = useState<string>(
    () => localStorage.getItem('pulsar_speaker_id') || 'default'
  );
  const [micLevel, setMicLevel] = useState(0);
  const [permissionGranted, setPermissionGranted] = useState(false);

  const previewStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs: AudioDevice[] = devices
        .filter(d => d.kind === 'audioinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Mikrofon ${i + 1}`,
          kind: 'audioinput',
        }));
      const outputs: AudioDevice[] = devices
        .filter(d => d.kind === 'audiooutput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Hoparlör ${i + 1}`,
          kind: 'audiooutput',
        }));
      setAudioInputs(inputs);
      setAudioOutputs(outputs);
    } catch (err) {
      console.error('[PULSAR DEVICES] Cihaz listesi alınamadı:', err);
    }
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setPermissionGranted(true);
      await enumerateDevices();
      return true;
    } catch (err) {
      console.error('[PULSAR DEVICES] Mikrofon izni reddedildi:', err);
      return false;
    }
  }, [enumerateDevices]);

  const selectMic = useCallback((deviceId: string) => {
    setSelectedMicId(deviceId);
    localStorage.setItem('pulsar_mic_id', deviceId);
  }, []);

  const selectSpeaker = useCallback((deviceId: string) => {
    setSelectedSpeakerId(deviceId);
    localStorage.setItem('pulsar_speaker_id', deviceId);
  }, []);

  const stopMicPreview = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (previewStreamRef.current) {
      previewStreamRef.current.getTracks().forEach(t => t.stop());
      previewStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setMicLevel(0);
  }, []);

  const startMicPreview = useCallback(async (deviceId: string) => {
    stopMicPreview();
    try {
      const constraints: MediaStreamConstraints = {
        audio: deviceId && deviceId !== 'default'
          ? { deviceId: { exact: deviceId } }
          : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      previewStreamRef.current = stream;
      setPermissionGranted(true);

      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(data);
        const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length);
        setMicLevel(Math.min(100, Math.round((rms / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(tick);
      };
      animFrameRef.current = requestAnimationFrame(tick);

      await enumerateDevices();
    } catch (err) {
      console.error('[PULSAR DEVICES] Mikrofon önizleme hatası:', err);
    }
  }, [stopMicPreview, enumerateDevices]);

  const testSpeaker = useCallback((deviceId: string) => {
    try {
      const ctx = new AudioContext();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(440, ctx.currentTime);
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0);

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      // setSinkId desteği varsa hoparlörü yönlendir
      if (deviceId && deviceId !== 'default' && 'setSinkId' in ctx.destination) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ctx.destination as any).setSinkId(deviceId).catch(() => undefined);
      }

      oscillator.start();
      oscillator.stop(ctx.currentTime + 1.0);
      oscillator.onended = () => ctx.close();
    } catch (err) {
      console.error('[PULSAR DEVICES] Hoparlör testi hatası:', err);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    enumerateDevices();
    navigator.mediaDevices.addEventListener('devicechange', enumerateDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', enumerateDevices);
      stopMicPreview();
    };
  }, [enumerateDevices, stopMicPreview]);

  return {
    audioInputs,
    audioOutputs,
    selectedMicId,
    selectedSpeakerId,
    micLevel,
    permissionGranted,
    selectMic,
    selectSpeaker,
    startMicPreview,
    stopMicPreview,
    testSpeaker,
    requestPermission,
  };
}
