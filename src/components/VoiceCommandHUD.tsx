/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Radio, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import type { VoiceStatus, VoiceCommandEvent } from '../hooks/useVoiceCommands';

interface VoiceCommandHUDProps {
  status: VoiceStatus;
  transcript: string;
  lastEvent: VoiceCommandEvent | null;
  isSilentMode: boolean;
  wakeWordDetected: boolean;
  permissionDenied: boolean;
  micAvailable: boolean;
  onToggle: () => void;
  onStop?: () => void;
  onSilentToggle: () => void;
}

// Command reference list
const COMMANDS = [
  { cmd: 'PULSAR, merhaba', desc: 'Sistem karşılama' },
  { cmd: 'PULSAR, sistem durumu nedir?', desc: 'Detaylı özet' },
  { cmd: 'PULSAR, jamming testi başlat', desc: 'Red Team simülasyonu' },
  { cmd: 'PULSAR, son alarmı açıklar mısın?', desc: 'XAI paneli + sesli özet' },
  { cmd: 'PULSAR, delil paketini indir', desc: 'JSON dışa aktarım' },
  { cmd: 'PULSAR, sessiz mod', desc: 'Ses yanıtı aç/kapat' },
  { cmd: 'PULSAR, kapat', desc: 'Bekleme moduna geç' },
  { cmd: 'PULSAR, komutlar', desc: 'Bu listeyi sesli oku' },
];

// Status label map
const STATUS_LABELS: Record<VoiceStatus, { label: string; color: string }> = {
  idle: { label: 'BEKLEMEDE', color: '#475569' },
  listening: { label: 'DİNLİYOR', color: '#22d3ee' },
  wakeword_detected: { label: 'WAKE WORD ALINDI', color: '#f59e0b' },
  processing: { label: 'İŞLENİYOR', color: '#818cf8' },
  speaking: { label: 'KONUŞUYOR', color: '#34d399' },
  silent_mode: { label: 'SESSİZ MOD', color: '#64748b' },
  standby: { label: 'STANDBY', color: '#ef4444' },
  error: { label: 'HATA', color: '#ef4444' },
};

// Animated waveform bars
function WaveformBars({ active, color }: { active: boolean; color: string }) {
  const [heights, setHeights] = useState<number[]>(Array(16).fill(4));

  useEffect(() => {
    if (!active) {
      setHeights(Array(16).fill(4));
      return;
    }
    const interval = setInterval(() => {
      setHeights(prev => prev.map(() => active ? Math.random() * 28 + 4 : 4));
    }, 80);
    return () => clearInterval(interval);
  }, [active]);

  return (
    <div className="voice-waveform">
      {heights.map((h, i) => (
        <div
          key={i}
          className="voice-bar"
          style={{
            height: `${h}px`,
            backgroundColor: color,
            boxShadow: active ? `0 0 6px ${color}` : 'none',
            transition: 'height 0.08s ease, box-shadow 0.2s ease',
          }}
        />
      ))}
    </div>
  );
}

// Pulsing ring animation for wake word
function WakeWordRing() {
  return (
    <div className="wake-ring-container">
      <div className="wake-ring wake-ring-1" />
      <div className="wake-ring wake-ring-2" />
      <div className="wake-ring wake-ring-3" />
    </div>
  );
}

export default function VoiceCommandHUD({
  status,
  transcript,
  lastEvent,
  isSilentMode,
  wakeWordDetected,
  permissionDenied,
  micAvailable,
  onToggle,
  onStop,
  onSilentToggle,
}: VoiceCommandHUDProps) {
  const [showCommands, setShowCommands] = useState(false);
  const [eventLog, setEventLog] = useState<VoiceCommandEvent[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // Durma butonu handler - konuşma sırasında butona basıldığında çalışır
  const handleStopClick = () => {
    if (status === 'listening' || status === 'processing' || status === 'speaking') {
      onStop?.() || onToggle();
    } else {
      onToggle();
    }
  };

  // ESC tuşu ile durma
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (status === 'listening' || status === 'processing' || status === 'speaking')) {
        e.preventDefault();
        onStop?.() || onToggle();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [status, onStop, onToggle]);

  const isActive = status !== 'idle' && status !== 'standby';
  const statusInfo = STATUS_LABELS[status] ?? STATUS_LABELS.idle;
  const waveActive = status === 'listening' || status === 'speaking' || status === 'wakeword_detected';

  // Accumulate event log
  useEffect(() => {
    if (lastEvent) {
      setEventLog(prev => [lastEvent, ...prev].slice(0, 8));
    }
  }, [lastEvent]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [eventLog]);

  // Permission denied banner
  if (permissionDenied || !micAvailable) {
    return (
      <div className="voice-hud-root">
        <div className="voice-permission-denied">
          <MicOff className="w-5 h-5 text-red-400" />
          <span className="text-red-400 text-xs tracking-widest">MİKROFON İZNİ GEREKLİ</span>
          <span className="text-red-600 text-[10px]">
            Tarayıcı ayarlarından mikrofon iznini etkinleştirin
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="voice-hud-root">
      {/* ── Header row ── */}
      <div className="voice-hud-header">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4" style={{ color: statusInfo.color }} />
          <span className="text-xs font-bold tracking-[0.2em]" style={{ color: statusInfo.color }}>
            {statusInfo.label}
          </span>
          {isSilentMode && (
            <span className="text-[9px] bg-slate-800 border border-slate-600 text-slate-400 px-1.5 py-0.5 tracking-wider">
              SES KAPALI
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Silent toggle */}
          <button
            onClick={onSilentToggle}
            className="voice-icon-btn"
            title={isSilentMode ? 'Sesi Aç' : 'Sessiz Mod'}
          >
            {isSilentMode ? (
              <VolumeX className="w-4 h-4 text-slate-500" />
            ) : (
              <Volume2 className="w-4 h-4 text-cyan-500" />
            )}
          </button>

          {/* Commands panel toggle */}
          <button
            onClick={() => setShowCommands(p => !p)}
            className="voice-icon-btn"
            title="Komut Listesi"
          >
            {showCommands ? (
              <ChevronUp className="w-4 h-4 text-cyan-600" />
            ) : (
              <ChevronDown className="w-4 h-4 text-cyan-600" />
            )}
          </button>

          {/* Main mic button */}
          <button
            onClick={handleStopClick}
            className={`voice-mic-btn ${isActive ? 'voice-mic-active' : 'voice-mic-idle'}`}
            title={isActive ? 'Durdur (ESC)' : 'Başlat'}
          >
            {isActive ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* ── Wake word pulse ── */}
      {wakeWordDetected && (
        <div className="voice-wakeword-banner">
          <WakeWordRing />
          <Zap className="w-4 h-4 text-amber-400 z-10" />
          <span className="text-amber-400 text-xs tracking-[0.3em] z-10 font-bold">
            PULSAR AKTİF — KOMUT BEKLENİYOR
          </span>
        </div>
      )}

      {/* ── Waveform ── */}
      <div className="voice-waveform-container">
        <WaveformBars active={waveActive} color={statusInfo.color} />
      </div>

      {/* ── Live transcript ── */}
      {transcript && (
        <div className="voice-transcript">
          <span className="text-[9px] text-cyan-800 tracking-widest mb-0.5 block">ALGILANAN SES</span>
          <span className="text-[11px] text-cyan-400 font-mono leading-snug">{transcript}</span>
        </div>
      )}

      {/* ── Last response ── */}
      {lastEvent && (
        <div className="voice-response">
          <span className="text-[9px] text-cyan-700 tracking-widest mb-0.5 block">
            PULSAR YANITI
          </span>
          <span className="text-[11px] text-cyan-300 leading-snug font-mono">
            {lastEvent.response}
          </span>
        </div>
      )}

      {/* ── Event log ── */}
      {eventLog.length > 0 && (
        <div className="voice-log" ref={logRef}>
          {eventLog.map((e, i) => (
            <div key={i} className="voice-log-row">
              <span className="voice-log-type">{e.type.toUpperCase()}</span>
              <span className="voice-log-text">{e.response.slice(0, 60)}…</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Command reference (collapsible) ── */}
      {showCommands && (
        <div className="voice-commands-panel">
          <div className="text-[9px] text-cyan-700 tracking-widest mb-2">KOMUT REFERANSLARİ</div>
          {COMMANDS.map(({ cmd, desc }) => (
            <div key={cmd} className="voice-command-row">
              <span className="voice-command-text">{cmd}</span>
              <span className="voice-command-desc">{desc}</span>
            </div>
          ))}
          <div className="text-[9px] text-cyan-900 mt-2 italic">
            * "PULSAR" veya "Jarvis" ile başlatın
          </div>
        </div>
      )}

      {/* ── Idle prompt ── */}
      {!isActive && (
        <div className="voice-idle-prompt">
          <MicOff className="w-3.5 h-3.5 text-slate-600" />
          <span>"PULSAR, merhaba" deyin veya mikrofon butonuna tıklayın</span>
        </div>
      )}
    </div>
  );
}
