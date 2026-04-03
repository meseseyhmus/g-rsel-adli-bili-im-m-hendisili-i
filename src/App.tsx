import React, { useState, useRef, Suspense, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileAudio, FileImage, FileText, Upload, Settings, ShieldAlert,
  Search, ShieldCheck, Download, Activity, FileSearch, Fingerprint, Database, Mic, Cpu, Bot
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import EvaViewer from './components/EvaViewer';
import { askPulsarAI } from '@/lib/gemini';
import { useVoiceCommands } from './hooks/useVoiceCommands';
import VoiceCommandHUD from './components/VoiceCommandHUD';
import { useMediaDevices } from './hooks/useMediaDevices';
import DeviceSelector from './components/DeviceSelector';
import './App.css';

// ── Types ────────────────────────────────────────────────────────
type AnalysisStatus = 'IDLE' | 'ANALYZING' | 'COMPLETE';

interface FileItem {
  id: string;
  name: string;
  type: 'audio' | 'image' | 'document';
  size: string;
  file?: File;
}

// ── Component ───────────────────────────────────────────────────
export default function App() {
  const [status, setStatus] = useState<AnalysisStatus>('IDLE');
  const [files, setFiles] = useState<FileItem[]>([]);

  // Progress states
  const [progressSTT, setProgressSTT] = useState(0);
  const [progressStress, setProgressStress] = useState(0);
  const [progressELA, setProgressELA] = useState(0);
  const [progressReport, setProgressReport] = useState(0);

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const devices = useMediaDevices();

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fake analysis process
  const startAnalysis = () => {
    if (files.length === 0) return;
    setStatus('ANALYZING');
    setProgressSTT(0);
    setProgressStress(0);
    setProgressELA(0);
    setProgressReport(0);

    // Play Scanning UI Sound
    voice.speak("Analiz motoru başlatılıyor. Lütfen bekleyin efendim.");

    const animateProgress = (setter: React.Dispatch<React.SetStateAction<number>>, duration: number, delay: number) => {
      setTimeout(() => {
        let p = 0;
        const interval = setInterval(() => {
          p += Math.random() * 15;
          if (p >= 100) {
            p = 100;
            clearInterval(interval);
          }
          setter(Math.floor(p));
        }, duration / 10);
      }, delay);
    };

    animateProgress(setProgressSTT, 3000, 500);
    animateProgress(setProgressStress, 2000, 1500);
    animateProgress(setProgressELA, 4000, 1000);
    animateProgress(setProgressReport, 2000, 4500);

    setTimeout(() => {
      setStatus('COMPLETE');
    }, 7000); // Max 7 seconds simulation for analysis
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles) return;

    const newFiles: FileItem[] = Array.from(uploadedFiles).map((file, i) => {
      let type: 'audio' | 'image' | 'document' = 'document';
      const name = file.name.toLowerCase();
      if (file.type.startsWith('audio/') || name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.ogg')) type = 'audio';
      else if (file.type.startsWith('image/') || name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg')) type = 'image';

      return {
        id: Date.now().toString() + i,
        name: file.name,
        type,
        size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
        file
      };
    });

    setFiles(prev => [...prev, ...newFiles]);
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  // Mock Data for Results
  const mockTranscript = `Görüşülen Kişi: "Hayır, o saatte depoda kimse yoktu, ben de orada değildim. Kesinlikle o belgeleri ben değiştirmedim."
[02:30] Sistem: Yüksek Stres / Mikro-Titreme Algılandı.
Görüşülen Kişi: "Kamera kayıtlarına bakabilirsiniz, o odaya girmedim."`;

  const generatePDF = () => {
    alert("Pulsar-X Raporu PDF olarak indiriliyor...");
  };

  // Tabs state
  const [activeTab, setActiveTab] = useState<'analysis' | 'ai'>('analysis');

  // AI Chat states
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'pulsar', text: string }[]>([
    { role: 'pulsar', text: 'P.U.L.S.A.R. sistemleri aktif efendim. Size nasıl yardımcı olabilirim?' }
  ]);
  const [isAiThinking, setIsAiThinking] = useState(false);

  // Hook for voice commands
  const voice = useVoiceCommands({
    getTrustScore: () => 96,
    getSystemStatus: () => `Sistem normal çalışıyor. ${files.length} dosya yüklü.`,
    onEventHandled: (event) => {
      setChatMessages(prev => [...prev,
      { role: 'user', text: event.transcript },
      { role: 'pulsar', text: event.response }
      ]);
    },
    onTriggerJammingTest: () => {
      setStatus('ANALYZING');
      setTimeout(() => setStatus('COMPLETE'), 5000);
    }
  });

  const handleSendAi = async () => {
    if (!chatInput.trim() || isAiThinking) return;
    const userText = chatInput.trim();
    setChatMessages(prev => [...prev, { role: 'user', text: userText }]);
    setChatInput('');
    setIsAiThinking(true);

    try {
      const response = await askPulsarAI(userText, "Pulsar-X Dosya ve Ses Analiz Sistemi. Aktif dosyalar: " + files.map(f => f.name).join(', '));
      setChatMessages(prev => [...prev, { role: 'pulsar', text: response }]);
      // Speak response if not in silent mode
      if (!voice.isSilentMode) {
        voice.speak(response);
      }
    } catch (e) {
      console.error("AI Communication Error:", e);
      setChatMessages(prev => [...prev, { role: 'pulsar', text: "Bağlantı hatası oluştu efendim. Lütfen ağı kontrol edin." }]);
    } finally {
      setIsAiThinking(false);
    }
  };

  // Immersive Startup Sound
  useEffect(() => {
    const playStartupBeep = () => {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.5);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
        setTimeout(() => ctx.close(), 1000);
      } catch (e) {
        console.error("Startup sound blocked by browser:", e);
      }
    };

    // Play on first interaction to avoid browser block
    const handleFirstClick = () => {
      playStartupBeep();
      window.removeEventListener('click', handleFirstClick);
    };
    window.addEventListener('click', handleFirstClick);
    return () => window.removeEventListener('click', handleFirstClick);
  }, []);

  return (
    <div
      className="flex flex-col scanlines"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'radial-gradient(circle at 50% 30%, #0a1628 0%, #020817 60%, #000 100%)',
        color: '#e2e8f0',
        fontFamily: "'Inter', sans-serif"
      }}
    >
      <div className="absolute inset-0 bg-grid opacity-10 pointer-events-none" />
      <div className="scan-beam" />

      {/* HEADER */}
      <header className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: 'rgba(0, 212, 255, 0.2)', background: 'rgba(6, 14, 30, 0.8)', backdropFilter: 'blur(8px)', zIndex: 50 }}>
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6" style={{ color: '#00d4ff' }} />
          <h1 className="text-xl font-bold tracking-widest" style={{ color: '#00d4ff', textShadow: '0 0 10px rgba(0,212,255,0.5)' }}>
            PULSAR-X
          </h1>
          <div className="h-4 w-px bg-white/10 mx-2" />
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-ping opacity-75" />
            <span className="text-[10px] font-mono tracking-widest text-red-500 font-bold uppercase">Threat Level: High</span>
          </div>
        </div>
        <div className="flex gap-6 items-center">
          <div className="flex gap-4 border-r border-white/10 pr-6 mr-2">
            <div className="flex flex-col items-center">
              <span className="text-[9px] uppercase opacity-40 font-mono">CPU</span>
              <span className="text-xs font-mono text-[#00d4ff]">24%</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-[9px] uppercase opacity-40 font-mono">MEM</span>
              <span className="text-xs font-mono text-[#00d4ff]">4.2GB</span>
            </div>
          </div>
          <div className="text-right flex flex-col items-end mr-4">
            <span className="text-[10px] uppercase font-mono tracking-widest opacity-60">Neural Engine</span>
            <span className="text-sm font-bold text-green-400" style={{ textShadow: '0 0 8px rgba(74, 222, 128, 0.5)' }}>ACTIVE</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="hover:bg-[#00d4ff]/10 text-[#00d4ff]"
            onClick={() => setShowSettings(true)}
          >
            <Settings className="w-5 h-5" />
          </Button>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 overflow-auto p-6 relative z-10 flex gap-6">

        {/* LEFT PANEL: UPLOAD & CONTROLS */}
        <div className="w-[350px] flex flex-col gap-4">
          <div className="rounded border bg-black/40 p-5 backdrop-blur-md" style={{ borderColor: 'rgba(0, 212, 255, 0.15)' }}>
            <h2 className="text-sm font-bold tracking-wider mb-4 flex items-center gap-2" style={{ color: '#00d4ff' }}>
              <Upload className="w-4 h-4" /> VERİ GİRİŞİ
            </h2>

            <div
              className="border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-colors"
              style={{ borderColor: 'rgba(0, 212, 255, 0.3)', background: 'rgba(0, 212, 255, 0.02)' }}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileSearch className="w-10 h-10 mb-3 opacity-60" style={{ color: '#00d4ff' }} />
              <p className="text-sm text-gray-300 font-medium mb-1">Ses Kaydı veya Belge Yükle</p>
              <p className="text-xs text-gray-500 font-mono">.wav, .mp3, .pdf, .png, .jpg</p>
              <input
                type="file"
                multiple
                hidden
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept="audio/*,image/*,.pdf"
              />
            </div>

            <div className="mt-4 flex flex-col gap-2 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar">
              <AnimatePresence>
                {files.map(file => (
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    key={file.id}
                    className="flex items-center justify-between p-2 rounded border bg-black/60"
                    style={{ borderColor: 'rgba(255,255,255,0.05)' }}
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      {file.type === 'audio' ? <FileAudio className="w-4 h-4 text-cyan-400 flex-shrink-0" /> :
                        file.type === 'image' ? <FileImage className="w-4 h-4 text-purple-400 flex-shrink-0" /> :
                          <FileText className="w-4 h-4 text-orange-400 flex-shrink-0" />}
                      <div className="flex flex-col truncate">
                        <span className="text-xs font-medium truncate">{file.name}</span>
                        <span className="text-[9px] text-gray-500 font-mono">{file.size}</span>
                      </div>
                    </div>
                    <button onClick={() => removeFile(file.id)} className="text-gray-500 hover:text-red-400 px-2 flex-shrink-0">
                      ✕
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
              {files.length === 0 && (
                <div className="text-xs text-center text-gray-600 font-mono py-4">Giriş verisi bekleniyor...</div>
              )}
            </div>

            <Button
              className="w-full mt-5 font-bold tracking-widest text-black shadow-[0_0_15px_rgba(0,212,255,0.4)]"
              style={{ background: '#00d4ff', transition: 'all 0.3s' }}
              onClick={startAnalysis}
              disabled={files.length === 0 || status === 'ANALYZING'}
            >
              {status === 'ANALYZING' ? 'ANALİZ EDİLİYOR...' : 'ANALİZİ BAŞLAT'}
            </Button>
          </div>

          {/* ACTIVE MODULES */}
          <div className="rounded border bg-black/40 p-5 backdrop-blur-md flex-1" style={{ borderColor: 'rgba(0, 212, 255, 0.15)' }}>
            <h2 className="text-sm font-bold tracking-wider mb-4 flex items-center gap-2" style={{ color: '#00d4ff' }}>
              <Database className="w-4 h-4" /> AKTİF MODÜLLER
            </h2>
            <div className="flex flex-col gap-4">
              <ModuleProgress label="Ses -> Metin & STT Engine" progress={progressSTT} active={status !== 'IDLE'} color="#00d4ff" />
              <ModuleProgress label="Stres & Sentiment Analizi" progress={progressStress} active={status !== 'IDLE'} color="#fb923c" />
              <ModuleProgress label="Error Level Analysis (ELA)" progress={progressELA} active={status !== 'IDLE'} color="#c084fc" />
              <ModuleProgress label="LLM Raporlama Motoru" progress={progressReport} active={status !== 'IDLE'} color="#4ade80" />
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: DASHBOARD & RESULTS */}
        <div className="flex-1 flex flex-col rounded border bg-black/40 backdrop-blur-md relative overflow-hidden" style={{ borderColor: 'rgba(0, 212, 255, 0.15)' }}>

          {/* TAB SWITCHER */}
          <div className="flex border-b border-white/5 bg-black/20">
            <button
              onClick={() => setActiveTab('analysis')}
              className={`flex-1 py-3 text-[10px] uppercase font-bold tracking-widest transition-all ${activeTab === 'analysis' ? 'text-[#00d4ff] bg-[#00d4ff]/10' : 'text-gray-500 hover:text-gray-300'}`}
              style={{ borderBottom: activeTab === 'analysis' ? '2px solid #00d4ff' : '2px solid transparent' }}
            >
              <FileSearch className="w-4 h-4 inline-block mr-2 mt-[-2px]" /> Analiz Sonuçları
            </button>
            <button
              onClick={() => setActiveTab('ai')}
              className={`flex-1 py-3 text-[10px] uppercase font-bold tracking-widest transition-all ${activeTab === 'ai' ? 'text-[#00d4ff] bg-[#00d4ff]/10' : 'text-gray-500 hover:text-gray-300'}`}
              style={{ borderBottom: activeTab === 'ai' ? '2px solid #00d4ff' : '2px solid transparent' }}
            >
              <Cpu className="w-4 h-4 inline-block mr-2 mt-[-2px]" /> Pulsar AI (Bilinçli Zeka)
            </button>
          </div>

          <div className="flex-1 relative overflow-hidden">
            <AnimatePresence mode="wait">
              {activeTab === 'analysis' ? (
                <motion.div
                  key="analysis-tab"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="absolute inset-0"
                >
                  {status === 'IDLE' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center opacity-40">
                      <ShieldCheck className="w-24 h-24 mb-4" style={{ color: '#00d4ff' }} />
                      <p className="text-lg font-mono tracking-widest text-center" style={{ color: '#00d4ff' }}>
                        SİSTEM HAZIR<br />
                        <span className="text-sm opacity-60">Hedef verileri yükleyin.</span>
                      </p>
                    </div>
                  )}

                  {status === 'ANALYZING' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <div className="relative w-32 h-32 flex items-center justify-center">
                        <Spinner size={120} />
                        <Activity className="absolute text-cyan-400 w-10 h-10 animate-pulse" />
                      </div>
                      <p className="mt-6 text-sm font-mono tracking-widest text-cyan-400 animate-pulse">
                        SİNİR AĞLARI İŞLİYOR...
                      </p>
                    </div>
                  )}

                  {status === 'COMPLETE' && (
                    <motion.div
                      key="result-view"
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="absolute inset-0 p-6 flex flex-col overflow-y-auto custom-scrollbar"
                    >
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <h2 className="text-xl font-bold tracking-wider mb-2 flex items-center gap-2" style={{ color: '#fff' }}>
                            <Fingerprint className="w-5 h-5 text-red-400" /> ADLİ BİLİŞİM ANALİZ RAPORU
                          </h2>
                          <p className="text-sm text-gray-300 max-w-2xl leading-relaxed">
                            <span className="text-red-400 font-bold">[KRİTİK BULGU]</span> Yüklenen verilerde dijital manipülasyon ve sahtecilik izleri tespit edildi. Metin içeriğinde suç unsuru teşkil edebilecek ifadeler saptanmıştır.
                          </p>
                        </div>
                        <Button
                          onClick={generatePDF}
                          className="bg-green-600 hover:bg-green-500 text-white font-bold tracking-widest shadow-[0_0_15px_rgba(74,222,128,0.3)] flex gap-2"
                        >
                          <Download className="w-4 h-4" /> RAPOR OLUŞTUR
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-6 flex-1">
                        {/* Audio Analysis */}
                        <div className="rounded border bg-black/60 p-5 flex flex-col" style={{ borderColor: 'rgba(255,165,0,0.3)' }}>
                          <h3 className="text-sm font-bold tracking-wider mb-4 flex items-center gap-2 text-orange-400">
                            <Mic className="w-4 h-4" /> SESSEL SPEKTRUM & STRES ANALİZİ
                          </h3>

                          {files.filter(f => f.type === 'audio').length > 0 ? (
                            <>
                              <div className="mb-3">
                                {files.filter(f => f.type === 'audio').map(f => (
                                  <div key={f.id} className="text-[10px] font-mono text-cyan-400/70 mb-1 flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
                                    DOSYA: {f.name} ({f.size})
                                  </div>
                                ))}
                              </div>

                              <div className="h-16 flex items-end gap-1 mb-4 opacity-80" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                {Array.from({ length: 48 }).map((_, i) => {
                                  const isDanger = i >= 18 && i <= 24;
                                  const height = isDanger ? Math.random() * 50 + 50 : Math.random() * 40 + 10;
                                  return (
                                    <motion.div
                                      key={i}
                                      className="flex-1 rounded-t"
                                      initial={{ height: 0 }}
                                      animate={{ height: `${height}%` }}
                                      style={{
                                        background: isDanger ? '#ef4444' : '#fb923c',
                                        opacity: isDanger ? 1 : 0.4
                                      }}
                                    />
                                  );
                                })}
                              </div>

                              <div className="bg-black/50 border border-gray-800 rounded p-3 text-[11px] font-mono text-gray-300 overflow-y-auto flex-1 whitespace-pre-line leading-relaxed custom-scrollbar">
                                <span className="text-orange-400/60">[SİSTEM TESPİTİ]</span><br />
                                {mockTranscript}
                                <br /><br />
                                <span className="text-cyan-400/60">[META VERİ]</span><br />
                                Sample Rate: 44.1kHz | Channels: Mono | BitDepth: 16bit
                              </div>

                              <div className="mt-4 flex flex-wrap gap-2">
                                <span className="text-[9px] px-2 py-1 rounded bg-red-900/50 text-red-400 border border-red-800/50 uppercase tracking-tighter">
                                  Kritik Stres: %81 (Zaman: 02:30)
                                </span>
                                <span className="text-[9px] px-2 py-1 rounded bg-orange-900/40 text-orange-400 border border-orange-800/40 uppercase tracking-tighter">
                                  Ses Sahteciliği: TEMİZ
                                </span>
                                <span className="text-[9px] px-2 py-1 rounded bg-green-900/40 text-green-400 border border-green-800/40 uppercase tracking-tighter">
                                  Doğruluk Payı: %94
                                </span>
                              </div>
                            </>
                          ) : (
                            <div className="flex-1 flex flex-col items-center justify-center opacity-40 text-center">
                              <Mic className="w-12 h-12 mb-3 text-gray-600" />
                              <p className="text-xs font-mono">ANALİZDE SES DOSYASI SAPTANMADI.<br />BU MODÜL DEVRE DIŞI.</p>
                            </div>
                          )}
                        </div>

                        {/* File Analysis */}
                        <div className="rounded border bg-black/60 p-5 flex flex-col" style={{ borderColor: 'rgba(192,132,252,0.3)' }}>
                          <h3 className="text-sm font-bold tracking-wider mb-4 flex items-center gap-2 text-purple-400">
                            <Search className="w-4 h-4" /> ELA & METADATA KONTROLÜ
                          </h3>
                          <div className="grid grid-cols-2 gap-4 mb-4">
                            <div className="bg-black/40 border border-gray-800 rounded flex items-center justify-center p-2 relative h-32 overflow-hidden group">
                              <div className="absolute inset-0 flex items-center justify-center text-xs opacity-30">
                                [Şüpheli Belge 2 JPG]
                              </div>
                              <div className="absolute inset-0 bg-gradient-to-tr from-purple-900/40 to-transparent mix-blend-overlay"></div>
                              <div className="absolute top-1/2 left-1/2 w-10 h-10 border-2 border-red-500 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-sm"></div>
                            </div>
                            <div className="flex flex-col gap-2 justify-center">
                              <div className="bg-red-900/30 border border-red-800/50 rounded p-2">
                                <div className="text-[10px] text-gray-400 mb-1">Error Level Analysis</div>
                                <div className="text-xs font-bold text-red-400 flex items-center gap-1">
                                  <ShieldAlert className="w-3 h-3" /> MANİPÜLASYON (%87)
                                </div>
                              </div>
                              <div className="bg-black/40 border border-gray-800 rounded p-2">
                                <div className="text-[10px] text-gray-400 mb-1">EXIF Oluşturulma</div>
                                <div className="text-xs font-mono text-gray-200">2023-10-12 14:05</div>
                              </div>
                            </div>
                          </div>
                          <div className="bg-black/50 border border-gray-800 rounded p-3 text-xs font-mono text-gray-300 flex-1 overflow-y-auto custom-scrollbar">
                            <span className="text-purple-400 font-bold">[ELA ANALİZİ]:</span><br />
                            &gt; "Fatura No: 48921" bölgesinde %87 oranında dijital fırça izi saptandı.<br />
                            &gt; Pixel Gürültüsü: Seviye 4 (Yüksek manipülasyon riski).<br />
                            &gt; EXIF: Orijinal kamera verileri silinmiş (Photoshop 24.0 kullanılmış).<br /><br />

                            <span className="text-red-400 font-bold">[SUÇ UNSURU TESPİTİ]:</span><br />
                            &gt; Belge içeriğinde TC kanunlarına aykırı "resmi belgede sahtecilik" emareleri mevcut.<br />
                            &gt; Dolandırıcılık şüphesi: %91 korelasyon.
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              ) : (
                /* AI COMMAND CENTER TAB (PULSAR CORE) */
                <motion.div
                  key="ai-tab"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="absolute inset-0 flex flex-col items-center justify-between p-12 bg-[#020817]/40"
                >
                  {/* Floating Chat History Overlay */}
                  <div className="absolute top-16 left-8 w-64 max-h-[400px] overflow-y-auto pr-2 flex flex-col gap-3 pointer-events-auto opacity-40 hover:opacity-100 transition-opacity custom-scrollbar z-20">
                    {chatMessages.map((msg, i) => (
                      <div key={i} className="flex flex-col gap-1">
                        <span className="text-[8px] font-mono tracking-widest text-[#00d4ff]/60 uppercase">
                          {msg.role === 'user' ? 'Giriş' : 'Pulsar'}
                        </span>
                        <span className={`${msg.role === 'user' ? 'text-cyan-200' : 'text-gray-300'} text-[10px] font-mono bg-black/40 p-2 rounded border border-white/5`}>
                          {msg.text}
                        </span>
                      </div>
                    ))}
                    {isAiThinking && (
                      <div className="flex gap-1 items-center px-2">
                        <div className="w-1 h-1 bg-[#00d4ff] rounded-full animate-bounce [animation-duration:0.6s]"></div>
                        <div className="w-1 h-1 bg-[#00d4ff] rounded-full animate-bounce [animation-duration:0.6s] [animation-delay:0.2s]"></div>
                        <div className="w-1 h-1 bg-[#00d4ff] rounded-full animate-bounce [animation-duration:0.6s] [animation-delay:0.4s]"></div>
                      </div>
                    )}
                  </div>

                  {/* CENTRAL 3D AVATAR (eva.glb) */}
                  <div className="flex-1 flex items-center justify-center relative w-full">
                    <div className="absolute inset-x-0 -top-8 flex flex-col items-center gap-1 z-20">
                      <Bot className="w-5 h-5 text-[#00d4ff] opacity-40" />
                      <div className="text-[10px] font-mono tracking-[0.4em] text-[#00d4ff] opacity-25 uppercase">Neural Avatar Interface</div>
                    </div>

                    <div className="w-full h-full max-h-[80vh] relative group cursor-grab active:cursor-grabbing">
                      <Suspense fallback={
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Spinner size={60} />
                        </div>
                      }>
                        <EvaViewer
                          size="100%"
                          voiceState={voice.status === 'speaking' ? 'speaking' : voice.status === 'listening' ? 'listening' : isAiThinking ? 'processing' : 'idle'}
                          status={isAiThinking || voice.status === 'error' ? 'WARNING' : 'SECURE'}
                        />
                      </Suspense>
                    </div>

                    {/* Floating Voice HUD Overlay */}
                    <div className="absolute right-12 top-16 w-[320px] pointer-events-auto z-30">
                      <VoiceCommandHUD
                        status={voice.status}
                        transcript={voice.transcript}
                        lastEvent={voice.lastEvent}
                        isSilentMode={voice.isSilentMode}
                        wakeWordDetected={voice.wakeWordDetected}
                        permissionDenied={voice.permissionDenied}
                        micAvailable={voice.micAvailable}
                        onToggle={voice.toggleListening}
                        onSilentToggle={() => voice.setIsSilentMode(!voice.isSilentMode)}
                      />
                    </div>

                    {/* Technical Readout Overlays (Floating) */}
                    <div className="absolute left-12 top-1/2 -translate-y-1/2 flex flex-col gap-6 pointer-events-none opacity-40">
                      <div className="flex flex-col">
                        <span className="text-[8px] font-mono text-cyan-500 uppercase tracking-widest">Process ID</span>
                        <span className="text-xs font-mono">EVA-NODE-01</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[8px] font-mono text-cyan-500 uppercase tracking-widest">Memory Link</span>
                        <span className="text-xs font-mono">92.4% ACTIVE</span>
                      </div>
                    </div>
                  </div>

                  {/* COMMAND BAR */}
                  <div className="w-full max-w-2xl mt-4 z-20">
                    <div className="flex flex-col items-center gap-2 mb-4">
                      <span className="text-[9px] font-mono tracking-[0.5em] text-[#00d4ff] opacity-40 animate-pulse uppercase">Neural Input Pending</span>
                    </div>

                    <div
                      className="flex items-center gap-4 bg-black/60 p-2 pl-4 pr-3 rounded border backdrop-blur-xl"
                      style={{ borderColor: 'rgba(0, 212, 255, 0.2)', boxShadow: '0 0 30px rgba(0,0,0,0.8)' }}
                    >
                      <button
                        onClick={voice.toggleListening}
                        className={`p-2 rounded-full transition-colors group ${voice.isRecording ? 'bg-cyan-500/20' : 'hover:bg-[#00d4ff]/10'}`}
                        title={voice.isRecording ? 'Dinlemeyi Durdur' : 'Sesli Komut Başlat'}
                      >
                        <Mic className={`w-5 h-5 ${voice.isRecording ? 'text-cyan-400 animate-pulse' : 'text-[#00d4ff] opacity-45 group-hover:opacity-100'}`} />
                      </button>

                      <input
                        className="flex-1 bg-transparent border-none outline-none text-sm font-mono text-[#00d4ff] placeholder:text-gray-700"
                        placeholder="Komutunuzu girin efendim..."
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendAi()}
                      />

                      <Button
                        onClick={handleSendAi}
                        className="h-10 px-8 font-bold tracking-[0.1em] rounded-sm text-black hover:scale-[1.02] transition-all"
                        style={{ background: '#00d4ff' }}
                        disabled={isAiThinking || voice.isRecording || !chatInput.trim()}
                      >
                        {isAiThinking ? '...' : (voice.status === 'listening' ? 'LISTEN' : 'EXECUTE')}
                      </Button>
                    </div>
                  </div>

                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* SETTINGS MODAL */}
      <DeviceSelector
        open={showSettings}
        audioInputs={devices.audioInputs}
        audioOutputs={devices.audioOutputs}
        selectedMicId={devices.selectedMicId}
        selectedSpeakerId={devices.selectedSpeakerId}
        micLevel={devices.micLevel}
        onSelectMic={devices.selectMic}
        onSelectSpeaker={devices.selectSpeaker}
        startMicPreview={devices.startMicPreview}
        stopMicPreview={devices.stopMicPreview}
        testSpeaker={devices.testSpeaker}
        onConfirm={() => setShowSettings(false)}
        onClose={() => setShowSettings(false)}
      />
    </div>
  );
}


// ── Helpers ────────────────────────────────────────────────────────

function ModuleProgress({ label, progress, active, color }: { label: string, progress: number, active: boolean, color: string }) {
  return (
    <div>
      <div className="flex justify-between text-[10px] font-mono tracking-wider mb-1">
        <span style={{ color: active ? '#fff' : 'rgba(255,255,255,0.4)' }}>{label}</span>
        <span style={{ color: active ? color : 'rgba(255,255,255,0.4)' }}>{active ? `${progress}%` : 'BEKLİYOR'}</span>
      </div>
      <div className="h-1.5 w-full bg-black/50 rounded-full overflow-hidden border border-white/5">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color, boxShadow: `0 0 8px ${color}` }}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.2 }}
        />
      </div>
    </div>
  );
}

function Spinner({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="animate-spin" style={{ animationDuration: '3s' }}>
      <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(0,212,255,0.1)" strokeWidth="2" />
      <circle
        cx="50" cy="50" r="45"
        fill="none"
        stroke="#00d4ff"
        strokeWidth="4"
        strokeDasharray="70 200"
        strokeLinecap="round"
        style={{ filter: 'drop-shadow(0 0 4px rgba(0,212,255,0.6))' }}
      />
      <circle cx="50" cy="50" r="35" fill="none" stroke="rgba(0,212,255,0.05)" strokeWidth="1" strokeDasharray="4 4" className="animate-spin-reverse" style={{ animationDuration: '10s' }} />
    </svg>
  );
}
