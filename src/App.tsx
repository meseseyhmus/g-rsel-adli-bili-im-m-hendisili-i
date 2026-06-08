import React, { useState, useRef, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileImage, Upload, Search, Activity, Image as ImageIcon,
  ShieldAlert, Mic, Bot, Fingerprint, Download, Square,
  Disc, Database, FileDigit, HardDrive, AlertTriangle, CheckCircle2,
  FileCode, FileText, Lock, Layers
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import EvaViewer from './components/EvaViewer';
import { askPulsarAI } from '@/lib/gemini';
import { useVoiceCommands } from './hooks/useVoiceCommands';
import { jsPDF } from 'jspdf';
import { generateWordReport } from '@/lib/generateWord';
import './App.css';

const API_BASE = import.meta.env.PROD ? "" : "http://localhost:8001";

type AnalysisStatus = 'IDLE' | 'ANALYZING' | 'COMPLETE';

interface FileItem {
  id: string;
  name: string;
  size: string;
  file?: File;
}

interface ExtractedFile {
  name: string;
  size_bytes: number;
  extension: string;
  status: string;
  md5_hash: string;
}

interface OpticalMediaResult {
  file_name: string;
  file_size_mb: number;
  sha256: string;
  format: string;
  total_sectors: number;
  bad_sectors: number;
  threat_score: number;
  is_manipulated: boolean;
  manipulation_level: string;
  extracted_files: ExtractedFile[];
  hidden_count: number;
  deleted_count: number;
  note: string;
}

interface AnalysisResult {
  manipulation_score: number;
  is_manipulated: boolean;
  manipulation_level: string;
  original_base64: string;
  ela_image_base64: string;
  heatmap_base64: string;
  cm_base64?: string;
  cm_score?: number;
  hashes?: { md5: string; sha1: string; sha256: string };
  exif_data?: Record<string, any>;
  model_used: boolean;
  analysis_method: string;
  dct_blocks_analyzed: number;
  ela_mean_intensity: number;
  note: string;
}

interface SherloqResult {
  signal?: {
    high_frequency_base64: string;
    gradient_base64: string;
    median_noise_base64: string;
  };
  ghost?: {
    ghost_maps: Record<string, string>;
  };
  illuminant?: {
    illuminant_map_base64: string;
  };
  bitplane?: {
    bit_plane_base64: string;
    plane: number;
  };
  stegano?: {
    hidden_text: string | null;
    has_hidden_message: boolean;
    detected_method?: string;
    stegano_score: number;
    is_suspicious: boolean;
    entropy: { r: number; g: number; b: number; avg: number };
    chi_square: number;
    lsb_map_base64: string;
    lsb_stats: { zeros: number; ones: number; balance_pct: number };
    message_length: number;
    all_attempts?: { method: string; text_preview: string; length: number; printable_ratio: number; score: number }[];
    note: string;
  };
}

export default function App() {
  const [status, setStatus] = useState<AnalysisStatus>('IDLE');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [results, setResults] = useState<AnalysisResult | null>(null);
  const [aiProofReport, setAiProofReport] = useState<string | null>(null);

  const [cdStatus, _setCdStatus] = useState<AnalysisStatus>('IDLE');
  const [cdResults, _setCdResults] = useState<OpticalMediaResult | null>(null);
  // const [cdFiles, setCdFiles] = useState<FileItem[]>([]);

  // Dashboard Tabs
  const [activeTab, setActiveTab] = useState<'analysis' | 'ai' | 'cd_dvd' | 'sherloq'>('analysis');
  const [viewMode, setViewMode] = useState<'original' | 'ela' | 'heatmap' | 'cm'>('original');

  // Sherloq State
  const [sherloqStatus, setSherloqStatus] = useState<AnalysisStatus>('IDLE');
  const [sherloqData, setSherloqData] = useState<SherloqResult>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  // const cdInputRef = useRef<HTMLInputElement>(null);

  // AI Chat States
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'pulsar', text: string }[]>([
    { role: 'pulsar', text: 'P.U.L.S.A.R. AI aktif. Adli bilişim görsellerini incelememde size nasıl yardımcı olabilirim?' }
  ]);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Voice & AI Hook
  const voice = useVoiceCommands({
    getTrustScore: () => 96,
    getSystemStatus: () => `Sistem normal çalışıyor.`,
    onEventHandled: (event) => {
      setChatMessages(prev => [...prev, { role: 'user', text: event.transcript }, { role: 'pulsar', text: event.response }]);
    },
    onTriggerJammingTest: () => { }
  });

  const handleStopAi = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const handleSendAi = async () => {
    if (!chatInput.trim() || isAiThinking) return;
    const userText = chatInput.trim();
    setChatMessages(prev => [...prev, { role: 'user', text: userText }]);
    setChatInput('');
    setIsAiThinking(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // If an image is uploaded, provide context to AI
    const imgContext = results?.original_base64 || undefined;

    try {
      const response = await askPulsarAI(userText, "Pulsar-X Görsel Adli Bilişim Sistemi.", imgContext, controller.signal);
      if (response === '__ABORTED__') {
        setChatMessages(prev => [...prev, { role: 'pulsar', text: '⛔ Yanıt durduruldu.' }]);
        return;
      }
      setChatMessages(prev => [...prev, { role: 'pulsar', text: response }]);
      if (!voice.isSilentMode) {
        voice.speak(response);
      }
    } catch (e) {
      console.error("AI Hatası:", e);
      setChatMessages(prev => [...prev, { role: 'pulsar', text: "Bağlantı hatası oluştu." }]);
    } finally {
      setIsAiThinking(false);
      abortControllerRef.current = null;
    }
  };

  const startAnalysis = async () => {
    if (files.length === 0) return;
    setStatus('ANALYZING');
    setResults(null);
    setAiProofReport(null);
    setViewMode('original');

    voice.speak("Görsel adli bilişim analizi başlatılıyor.");

    const formData = new FormData();
    formData.append("file", files[0].file!);

    try {
      const res = await fetch(`${API_BASE}/api/analyze/full`, { method: "POST", body: formData });
      if (!res.ok) throw new Error(`Sunucu Hatası: ${res.status}`);
      const data = await res.json();

      if (data && data.ela) {
        setResults(data.ela);
        setStatus('COMPLETE');
        voice.speak("Algoritmik analiz tamamlandı. Yapay zeka vizyon modeli görüntü detaylarını inceliyor.");

        // Auto-generate Deep AI vision report passing base64 pixels!
        try {
          setAiProofReport("Yapay zeka pikselleri inceliyor, kanıtlar toplanıyor...");
          const visionPrompt = `Sen bir adli bilişim uzmanısın. Ekteki görsel piksellerini detaylıca incele. İstatistiksel manipülasyon skoru %${data.ela.manipulation_score.toFixed(1)} çıktı. Bu görsel YAPAY ZEKA (Midjourney, DALL-E, Stable Diffusion) yapımı mı, yoksa orijinal bir fotoğraf mı? Eğer yapay zeka ise LÜTFEN KANITLARINI SIRALA (örnek: "Sol elde 6 parmak var", "Arka plandaki yazı anlamsız", "Doku çok pürüzsüz"). Lütfen sonucu "Uzman Görüşü:" şeklinde başlayarak kısaca rapora yaz.`;

          const aiSummary = await askPulsarAI(visionPrompt, "Kanıtlı Raporlama Sistemi", data.ela.original_base64);
          setAiProofReport(aiSummary);
          setChatMessages(prev => [...prev, { role: 'pulsar', text: "Görsel tespit edildi. Uzman Raporu:\n" + aiSummary }]);
        } catch (e) {
          setAiProofReport("AI kanıt modülüne ulaşılamadı. (API Anahtarı eksik veya geçersiz).");
        }
      } else {
        throw new Error("Geçersiz API yanıtı.");
      }
    } catch (err) {
      console.error(err);
      setStatus('IDLE');
      alert("Hata oluştu: Sunucuya ulaşılamadı. Python backendin çalıştığından emin olun.");
    }
  };

  // const handleCdUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  //   const uploadedFiles = e.target.files;
  //   if (!uploadedFiles || uploadedFiles.length === 0) return;
  // 
  //   const file = uploadedFiles[0];
  //   const newFile: FileItem = {
  //     id: Date.now().toString(),
  //     name: file.name,
  //     size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
  //     file
  //   };
  // 
  //   // setCdFiles([newFile]);
  //   setActiveTab('cd_dvd'); // Switch to the new tab
  //   setCdStatus('ANALYZING');
  //   setCdResults(null);
  // 
  //   voice.speak("Optik medya imajı yükleniyor. Derin sektör analizi başlatıldı.");
  // 
  //   const formData = new FormData();
  //   formData.append("file", file);
  // 
  //   try {
  //     const res = await fetch(`${API_BASE}/api/analyze/optical_media`, { method: "POST", body: formData });
  //     if (!res.ok) throw new Error(`Sunucu Hatası: ${res.status}`);
  //     const data = await res.json();
  // 
  //     if (data && data.media) {
  //       setCdResults(data.media);
  //       setCdStatus('COMPLETE');
  //       voice.speak("Sektör analizi tamamlandı. Gizli dosyalar ve hash logları incelenebilir.");
  //     } else {
  //       throw new Error("Geçersiz API yanıtı.");
  //     }
  //   } catch (err) {
  //     console.error(err);
  //     setCdStatus('IDLE');
  //     alert("Hata oluştu: Sunucuya ulaşılamadı veya imaj okunamadı.");
  //   }
  // };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles) return;

    // Sadece ilk resmi alıyoruz (Sadece Resim İnceleme)
    const file = uploadedFiles[0];
    const newFile: FileItem = {
      id: Date.now().toString(),
      name: file.name,
      size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
      file
    };

    setFiles([newFile]);
    setStatus('IDLE');
    setResults(null);
    setSherloqStatus('IDLE');
    setSherloqData({});
  };

  const runSherloqAnalysis = async () => {
    if (files.length === 0) return;
    setSherloqStatus('ANALYZING');
    
    const formData = new FormData();
    formData.append("file", files[0].file!);
    
    try {
      const [signalRes, ghostRes, illRes, bitRes, stegRes] = await Promise.all([
        fetch(`${API_BASE}/api/analyze/signal`, { method: "POST", body: formData }).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/api/analyze/jpeg_ghost`, { method: "POST", body: formData }).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/api/analyze/illuminant`, { method: "POST", body: formData }).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/api/analyze/bitplane?plane=0`, { method: "POST", body: formData }).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/api/analyze/stegano`, { method: "POST", body: formData }).then(r => r.ok ? r.json() : null)
      ]);
      
      setSherloqData({
        signal: signalRes,
        ghost: ghostRes,
        illuminant: illRes,
        bitplane: bitRes,
        stegano: stegRes
      });
      setSherloqStatus('COMPLETE');
    } catch (e) {
      console.error(e);
      setSherloqStatus('IDLE');
    }
  };

  const generateWord = async () => {
    if (!results) return;
    await generateWordReport({
      fileName: files.length > 0 ? files[0].name : 'gorsel',
      manipulationScore: results.manipulation_score,
      isManipulated: results.is_manipulated,
      manipulationLevel: results.manipulation_level,
      analysisMethod: results.analysis_method,
      modelUsed: results.model_used,
      dctBlocksAnalyzed: results.dct_blocks_analyzed,
      elaMeanIntensity: results.ela_mean_intensity,
      aiProofReport: aiProofReport ?? undefined,
      originalBase64: results.original_base64,
      elaBase64: results.ela_image_base64,
      heatmapBase64: results.heatmap_base64,
      hashes: results.hashes,
    });
  };

  const generatePDF = () => {
    if (!results) return;

    const doc = new jsPDF('p', 'mm', 'a4');
    const W = 210;
    const M = 15;
    const CW = W - M * 2;

    const tr = (s: string) => s
      .replace(/İ/g, 'I').replace(/ı/g, 'i').replace(/Ş/g, 'S').replace(/ş/g, 's')
      .replace(/Ğ/g, 'G').replace(/ğ/g, 'g').replace(/Ü/g, 'U').replace(/ü/g, 'u')
      .replace(/Ö/g, 'O').replace(/ö/g, 'o').replace(/Ç/g, 'C').replace(/ç/g, 'c');

    const footer = (n: number) => {
      doc.setFontSize(7.5); doc.setTextColor(140, 140, 140);
      doc.setLineWidth(0.2); doc.setDrawColor(140, 140, 140);
      doc.line(M, 288, W - M, 288);
      doc.text('P.U.L.S.A.R. AI  |  Gorsel Adli Bilisim Lab', M, 292);
      doc.text(`Sayfa ${n}`, W - M, 292, { align: 'right' });
    };

    const secHeader = (lbl: string, y: number, r = 20, g = 50, b = 100) => {
      doc.setFillColor(r, g, b); doc.rect(M, y, CW, 7, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
      doc.text(lbl, M + 3, y + 5); return y + 10;
    };

    // ── SAYFA 1: KAPAK ──
    doc.setFillColor(0, 20, 60); doc.rect(0, 0, W, 45, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(0, 210, 255);
    doc.text('GORSEL ADLI BILISIM', W / 2, 18, { align: 'center' });
    doc.setFontSize(13); doc.setTextColor(160, 210, 255);
    doc.text('UZMAN ANALIZ RAPORU  P.U.L.S.A.R. AI v4.0', W / 2, 28, { align: 'center' });
    doc.setFontSize(8); doc.setTextColor(90, 150, 210);
    doc.text('Uretim Tarihi: ' + new Date().toLocaleString('tr-TR'), W / 2, 38, { align: 'center' });

    const bc = results.is_manipulated ? (results.manipulation_score > 60 ? [160, 0, 0] : [140, 70, 0]) : [0, 90, 40];
    doc.setFillColor(bc[0], bc[1], bc[2]); doc.roundedRect(M, 50, CW, 24, 3, 3, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(255, 255, 255);
    const verdict = results.is_manipulated ? (results.manipulation_score > 60 ? 'KRITIK  MANIPULASYON TESPIT EDILDI' : 'SUPHELI  INCELEME GEREKIYOR') : 'TEMIZ  ORJINALLIK DOGRULANDI';
    doc.text(verdict, W / 2, 62, { align: 'center' });
    doc.setFontSize(10); doc.setTextColor(220, 220, 220);
    doc.text('Risk Skoru: %' + results.manipulation_score.toFixed(1) + '   |   Seviye: ' + tr(results.manipulation_level), W / 2, 71, { align: 'center' });

    let cy = 82;
    cy = secHeader('DOSYA VE RAPOR BILGILERI', cy, 30, 30, 80);
    const meta: [string, string][] = [
      ['Analiz Edilen Dosya', files.length > 0 ? files[0].name : 'Bilinmiyor'],
      ['Dosya Boyutu', files.length > 0 ? files[0].size : '--'],
      ['Analiz Yontemi', tr(results.analysis_method)],
      ['Model Kullanildi?', results.model_used ? 'Evet (CASIA 2.0 LSTM)' : 'Hayir (DCT Fallback)'],
      ['DCT Blok Sayisi', results.dct_blocks_analyzed.toLocaleString()],
      ['ELA Ort. Yogunlugu', results.ela_mean_intensity.toFixed(6)],
    ];
    meta.forEach(([lbl, val], i) => {
      const ry = cy + i * 8;
      doc.setFillColor(i % 2 === 0 ? 242 : 252, i % 2 === 0 ? 244 : 252, i % 2 === 0 ? 255 : 255);
      doc.rect(M, ry, CW, 8, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(50, 50, 80);
      doc.text(lbl + ':', M + 3, ry + 5.5);
      doc.setFont('helvetica', 'normal'); doc.text(val, M + 72, ry + 5.5);
    });
    cy += meta.length * 8 + 8;

    cy = secHeader('KARSILASTIRMALI METRIK ANALIZI', cy, 20, 55, 100);
    const metrics = [
      { lbl: 'Manipulasyon Risk Skoru (%)', v: results.manipulation_score, danger: true },
      { lbl: 'ELA Yogunluk Indeksi (norm.)', v: Math.min(results.ela_mean_intensity * 4, 100), danger: true },
      { lbl: 'DCT Kapsam Orani (%)', v: Math.min((results.dct_blocks_analyzed / 8000) * 100, 100), danger: false },
      { lbl: 'Guvenilirlik Skoru (%)', v: Math.max(0, 100 - results.manipulation_score * 0.9), danger: false },
    ];
    metrics.forEach((m, i) => {
      const by = cy + i * 13; const bw = CW - 78; const fw = (Math.min(m.v, 100) / 100) * bw;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(40, 40, 60);
      doc.text(m.lbl, M + 3, by + 5);
      doc.setFillColor(210, 215, 225); doc.roundedRect(M + 70, by, bw, 6, 1, 1, 'F');
      if (fw > 0) {
        const p = Math.min(m.v, 100) / 100;
        const r2 = m.danger ? Math.round(220 * p) : 30, g2 = m.danger ? Math.round(160 * (1 - p)) : Math.round(160 * p);
        doc.setFillColor(r2, g2, 40); doc.roundedRect(M + 70, by, fw, 6, 1, 1, 'F');
      }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(30, 30, 30);
      doc.text('%' + m.v.toFixed(1), M + 70 + bw + 3, by + 5);
    });
    cy += metrics.length * 13 + 8;

    cy = secHeader('TEKNIK DEGERLENDIRME VE SONUC', cy, 40, 40, 80);
    const summary = results.is_manipulated
      ? (results.manipulation_score > 60
        ? 'Incelenen gorsel uzerinde uygulanan ELA ve DCT analizleri KRITIK duzey tutarsizlik ortaya koymaktadir. ' + results.dct_blocks_analyzed.toLocaleString() + ' adet 8x8 DCT blogu incelendiginde yuksek frekansi istatistiksel anomaliler saptanmistir. ELA yogunlugu ' + results.ela_mean_intensity.toFixed(4) + ' ile esik degerin uzerindedir. Gorsel hukuki islemlerde orjinal belge niteligini yitirmis kabul edilmelidir.'
        : results.dct_blocks_analyzed.toLocaleString() + ' DCT blogu analiz edilmis; bir bolumunde yerel kalite farkliliklari tespit edilmistir. ELA yogunlugu (' + results.ela_mean_intensity.toFixed(4) + ') supheli degerlere yakindir. Risk skoru %' + results.manipulation_score.toFixed(1) + ' olup ek adli inceleme onerilmektedir.')
      : results.dct_blocks_analyzed.toLocaleString() + ' adet 8x8 DCT blogu ve uc JPEG kalite seviyesinde (75/85/95) yurutulen ELA analizi sonucunda istatistiksel olarak anlamli manipulasyon izi saptanamamistir. ELA ortalama yogunlugu dusuk (' + results.ela_mean_intensity.toFixed(4) + ') seyrederek beklenen sinirlar icinde kalmaktadir. DCT frekans dagilimi homojen ve tutarlidir. Bu gorsel ORJINAL olarak degerlendirilmektedir.';

    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(25, 25, 50);
    const ss = doc.splitTextToSize(summary, CW - 4);
    doc.text(ss, M + 2, cy);
    cy += ss.length * 4.8 + 6;
    footer(1);

    // ── SAYFA 2: GORSEL + TABLO + AI ──
    doc.addPage();
    doc.setFillColor(0, 20, 60); doc.rect(0, 0, W, 14, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0, 210, 255);
    doc.text('GORSEL ADLI BILISIM RAPORU  -  GORSEL KARSILASTIRMA & TEKNIK TABLO', W / 2, 9, { align: 'center' });
    cy = 20;

    cy = secHeader('3 KANAL GORSEL KARSILASTIRMASI: ORJINAL / ELA / DCT ISI HARITASI', cy, 0, 60, 100);
    const iW = 57, iH = 64, igap = (CW - iW * 3) / 2;
    const x1 = M, x2 = M + iW + igap, x3 = M + (iW + igap) * 2;
    const iy = cy + 3;
    try {
      doc.addImage('data:image/jpeg;base64,' + results.original_base64, 'JPEG', x1, iy, iW, iH);
      doc.addImage('data:image/jpeg;base64,' + results.ela_image_base64, 'JPEG', x2, iy, iW, iH);
      doc.addImage('data:image/jpeg;base64,' + results.heatmap_base64, 'JPEG', x3, iy, iW, iH);
    } catch (e) { console.error(e); }
    doc.setDrawColor(80, 100, 160); doc.setLineWidth(0.4);
    [x1, x2, x3].forEach((x: number) => doc.rect(x, iy, iW, iH));

    const ly = iy + iH + 5;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(20, 40, 100);
    doc.text('[1] ORJINAL GORSEL', x1 + iW / 2, ly, { align: 'center' });
    doc.text('[2] ERROR LEVEL ANALYSIS', x2 + iW / 2, ly, { align: 'center' });
    doc.text('[3] DCT ISI HARITASI', x3 + iW / 2, ly, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2); doc.setTextColor(55, 55, 75);
    const caps = ['Ham gorsel, referans piksel verisi.', 'JPEG fark haritasi. Parlak = mudahale.', 'DCT anomali. Kirmizi/sari = yuksek enerji.'];
    ([x1, x2, x3] as number[]).forEach((x, i) => { const ln = doc.splitTextToSize(caps[i], iW + 4); doc.text(ln, x, ly + 5); });
    cy = ly + 20;

    cy = secHeader('TEKNIK PARAMETRELER VE ESIK KARSILASTIRMASI', cy, 20, 55, 100);
    const trows: [string, string, string, string][] = [
      ['PARAMETRE', 'OLCULEN DEGER', 'GUVENLI ESIK', 'DURUM'],
      ['Risk Skoru', '%' + results.manipulation_score.toFixed(2), '< %40', results.manipulation_score < 40 ? 'GUVENLI' : 'RISKLI'],
      ['ELA Yogunlugu', results.ela_mean_intensity.toFixed(6), '< 5.0000', results.ela_mean_intensity < 5 ? 'NORMAL' : 'ANORMAL'],
      ['Analiz Yontemi', tr(results.analysis_method), 'CASIA 2.0', results.model_used ? 'IDEAL' : 'FALLBACK'],
      ['DCT Bloklari', results.dct_blocks_analyzed.toLocaleString(), '> 1.000', results.dct_blocks_analyzed > 1000 ? 'YETERLI' : 'SINIRLI'],
      ['Genel Karar', tr(results.manipulation_level), 'TEMIZ', results.is_manipulated ? 'UYARI' : 'TEMIZ'],
    ];
    trows.forEach((row, i) => {
      const ry = cy + i * 9; const hdr = i === 0;
      doc.setFillColor(hdr ? 20 : i % 2 === 0 ? 238 : 250, hdr ? 50 : i % 2 === 0 ? 242 : 252, hdr ? 100 : 255);
      doc.rect(M, ry, CW, 9, 'F');
      const cols = [M + 2, M + 55, M + 105, M + 148];
      row.forEach((cell: string, j: number) => {
        doc.setFont('helvetica', hdr || j === 3 ? 'bold' : 'normal'); doc.setFontSize(hdr ? 8 : 8.5);
        if (hdr) { doc.setTextColor(255, 255, 255); }
        else if (j === 3) { const bad = ['RISKLI', 'ANORMAL', 'UYARI', 'FALLBACK'].includes(cell); doc.setTextColor(bad ? 160 : 0, bad ? 0 : 110, 0); }
        else { doc.setTextColor(30, 30, 50); }
        doc.text(cell, cols[j], ry + 6);
      });
    });
    cy += trows.length * 9 + 8;

    if (aiProofReport) {
      if (cy > 215) { footer(2); doc.addPage(); cy = 20; }
      cy = secHeader('YAPAY ZEKA UZMAN GORUSU  (P.U.L.S.A.R. Vision Model)', cy, 60, 0, 80);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(30, 20, 50);
      const aiL = doc.splitTextToSize(tr(aiProofReport), CW - 4);
      doc.text(aiL, M + 2, cy);
      cy += aiL.length * 4.5 + 8;
    }

    if (cy > 245) { footer(doc.getNumberOfPages()); doc.addPage(); cy = 20; }
    cy = secHeader('HUKUKI UYARI VE SORUMLULUK BEYANI', cy, 80, 20, 20);
    const disc = tr('Bu rapor P.U.L.S.A.R. AI tarafindan otomatik uretilmistir. Bulgular algoritmik analiz sonuclari olup tek basina hukuki delil olarak kullanilamaz. Sonuclarin yorumlanmasinda %100 kesinlik garantisi verilmemektedir.');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(80, 40, 40);
    const dl = doc.splitTextToSize(disc, CW - 4);
    doc.text(dl, M + 2, cy);
    cy += dl.length * 4.5 + 10;

    doc.setLineWidth(0.3); doc.setDrawColor(80, 80, 100);
    ([{ lbl: 'Analisti / Operator', x: M }, { lbl: 'Teknik Denetci', x: M + 60 }, { lbl: 'Yetkili Amiri', x: M + 120 }] as { lbl: string, x: number }[])
      .forEach(({ lbl, x }) => { doc.rect(x, cy, 50, 18); doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(60, 60, 80); doc.text(lbl, x + 25, cy + 22, { align: 'center' }); });

    footer(doc.getNumberOfPages());

    // ── SAYFA 3: SHERLOQ İLERİ DÜZEY ADLİ ANALİZ ──
    const hasSherloq = sherloqStatus === 'COMPLETE' && (
      sherloqData.signal || sherloqData.ghost || sherloqData.illuminant || sherloqData.bitplane
    );
    const hasHashOrExif = results.hashes || (results.exif_data && Object.keys(results.exif_data).length > 0);

    if (hasSherloq || hasHashOrExif) {
      doc.addPage();
      doc.setFillColor(0, 40, 20); doc.rect(0, 0, W, 18, 'F');
      doc.setFillColor(0, 100, 50); doc.rect(0, 0, W, 3, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0, 230, 120);
      doc.text('SHERLOQ  ILERI DUZEY ADLI ANALIZ RAPORU', W / 2, 10, { align: 'center' });
      doc.setFontSize(7.5); doc.setTextColor(0, 160, 80);
      doc.text('Sinyal Analizi  |  JPEG Ghost Maps  |  Illuminant Haritasi  |  LSB Bit-Plane  |  Dosya Kimligi', W / 2, 15, { align: 'center' });
      cy = 24;

      // Hash + EXIF
      if (hasHashOrExif) {
        cy = secHeader('DOSYA KIMLIGI  (Kriptografik Hash & EXIF Meta Veri)', cy, 0, 80, 40);
        if (results.hashes) {
          const hashRows: [string, string][] = [
            ['MD5 Hash', results.hashes.md5],
            ['SHA-1 Hash', results.hashes.sha1],
            ['SHA-256 Hash', results.hashes.sha256],
          ];
          hashRows.forEach(([lbl, val], i) => {
            const ry = cy + i * 9;
            doc.setFillColor(i % 2 === 0 ? 235 : 248, i % 2 === 0 ? 245 : 252, i % 2 === 0 ? 238 : 248);
            doc.rect(M, ry, CW, 9, 'F');
            doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(0, 80, 40);
            doc.text(lbl + ':', M + 3, ry + 6);
            doc.setFont('courier', 'normal'); doc.setFontSize(7); doc.setTextColor(20, 20, 20);
            doc.text(val, M + 38, ry + 6);
          });
          cy += hashRows.length * 9 + 4;
        }
        if (results.exif_data && Object.keys(results.exif_data).length > 0) {
          const exifEntries = Object.entries(results.exif_data).slice(0, 12);
          cy += 2;
          doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(0, 80, 40);
          doc.text('EXIF / Meta Veri:', M + 3, cy + 4);
          cy += 7;
          exifEntries.forEach(([key, value], i) => {
            const ry = cy + i * 7;
            doc.setFillColor(i % 2 === 0 ? 240 : 250, i % 2 === 0 ? 248 : 252, i % 2 === 0 ? 242 : 250);
            doc.rect(M, ry, CW, 7, 'F');
            doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(0, 100, 50);
            doc.text(String(key) + ':', M + 3, ry + 5);
            doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 30);
            const valStr = doc.splitTextToSize(String(value), CW - 60);
            doc.text(valStr[0] || '', M + 58, ry + 5);
          });
          cy += exifEntries.length * 7 + 6;
        }
      }

      // Sinyal Analizi
      if (sherloqData.signal) {
        if (cy > 210) { footer(doc.getNumberOfPages()); doc.addPage(); cy = 20; }
        cy = secHeader('SINYAL ANALIZI  (Luminance Gradient / Noise Residual / High-Pass)', cy, 10, 60, 30);
        const sW2 = (CW - 8) / 3;
        const sH2 = 45;
        const sy2 = cy + 2;
        const signalImages = [
          { key: 'gradient_base64', lbl: 'Luminance Gradient', desc: 'Renk gecis egimi. Keskin hatlar = mudahale?' },
          { key: 'median_noise_base64', lbl: 'Median Noise Residual', desc: 'Gurultu kalinti haritasi. Duzensizlik = anormal.' },
          { key: 'high_frequency_base64', lbl: 'High-Pass Filter', desc: 'Yuksek frekans detaylari. Eklenme izleri gorunur.' },
        ];
        signalImages.forEach((img, i) => {
          const sx = M + i * (sW2 + 4);
          const b64 = (sherloqData.signal as any)[img.key];
          try { if (b64) doc.addImage('data:image/png;base64,' + b64, 'PNG', sx, sy2, sW2, sH2); } catch (_) { /* skip */ }
          doc.setDrawColor(0, 100, 50); doc.setLineWidth(0.3); doc.rect(sx, sy2, sW2, sH2);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(0, 120, 60);
          doc.text(img.lbl, sx + sW2 / 2, sy2 + sH2 + 4, { align: 'center' });
          doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(80, 80, 80);
          doc.text(doc.splitTextToSize(img.desc, sW2 + 2), sx, sy2 + sH2 + 8);
        });
        cy = sy2 + sH2 + 22;
      }

      // Illuminant Haritası
      if (sherloqData.illuminant) {
        if (cy > 210) { footer(doc.getNumberOfPages()); doc.addPage(); cy = 20; }
        cy = secHeader('AYDINLATMA (ILLUMINANT) HARITASI  -  Isik Kaynagi Tutarsizlik Analizi', cy, 80, 60, 0);
        const illW = 80, illH = 55;
        try { doc.addImage('data:image/png;base64,' + sherloqData.illuminant.illuminant_map_base64, 'PNG', M, cy + 2, illW, illH); } catch (_) { /* skip */ }
        doc.setDrawColor(150, 100, 0); doc.setLineWidth(0.3); doc.rect(M, cy + 2, illW, illH);
        const illTxtX = M + illW + 6;
        const illTxtW = CW - illW - 6;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(120, 80, 0);
        doc.text('Illuminant Analizi Hakkinda:', illTxtX, cy + 8);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(40, 30, 0);
        const illDesc = tr('Aydinlatma haritasi gorseldeki her bolgede tahmini isik kaynaginin renk sicakligini gosterir. Splicing yapilmis gorsellerde farkli isik kosullarinda cekilen parcalar bu haritada belirgin renk farkliliklari olusturur.');
        doc.text(doc.splitTextToSize(illDesc, illTxtW), illTxtX, cy + 16);
        cy = cy + illH + 12;
      }

      // Bit-Plane
      if (sherloqData.bitplane) {
        if (cy > 210) { footer(doc.getNumberOfPages()); doc.addPage(); cy = 20; }
        cy = secHeader('LSB BIT-PLANE ANALIZI  -  Steganografi & Dijital Anomali Tespiti', cy, 0, 40, 80);
        const bpW = 80, bpH = 55;
        try { doc.addImage('data:image/png;base64,' + sherloqData.bitplane.bit_plane_base64, 'PNG', M, cy + 2, bpW, bpH); } catch (_) { /* skip */ }
        doc.setDrawColor(0, 60, 120); doc.setLineWidth(0.3); doc.rect(M, cy + 2, bpW, bpH);
        const bpTxtX = M + bpW + 6;
        const bpTxtW = CW - bpW - 6;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(0, 60, 120);
        doc.text('Bit-Plane (LSB) Analizi Hakkinda:', bpTxtX, cy + 8);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(10, 20, 50);
        const bpDesc = tr('En Az Onemli Bit (LSB) katmani gorselin en hassas piksel bilgisini icerir. Dogal fotograflarda rastgele gurultu deseni gorulur. Steganografi veya manipulasyon durumunda bu katmanda duzensiz tekrarlayan desenler olusur.');
        doc.text(doc.splitTextToSize(bpDesc, bpTxtW), bpTxtX, cy + 16);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(0, 80, 140);
        doc.text('Analiz Edilen Katman: ' + (sherloqData.bitplane.plane !== undefined ? sherloqData.bitplane.plane : 0), bpTxtX, cy + 48);
        cy = cy + bpH + 12;
      }

      // Steganografi Analizi
      if (sherloqData.stegano) {
        if (cy > 210) { footer(doc.getNumberOfPages()); doc.addPage(); cy = 20; }
        cy = secHeader('STEGANOGRAFI VE GIZLI MESAJ ANALIZI', cy, 140, 20, 40);
        
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(0, 100, 50);
        doc.text(tr(sherloqData.stegano.has_hidden_message ? '⚠ GIZLI VERI TESPIT EDILDI!' : '✓ Normal (Gizli veri tespit edilemedi)'), M + 3, cy + 3);
        cy += 7;
        
        if (sherloqData.stegano.has_hidden_message) {
          doc.setFillColor(255, 235, 235); doc.rect(M, cy, CW, 20, 'F');
          doc.setDrawColor(220, 50, 50); doc.setLineWidth(0.4); doc.rect(M, cy, CW, 20);
          
          doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(180, 20, 20);
          doc.text('Cikarilan Gizli Mesaj (' + sherloqData.stegano.message_length + ' karakter):', M + 3, cy + 5);
          
          doc.setFont('courier', 'bold'); doc.setFontSize(7.5); doc.setTextColor(0, 0, 0);
          const lines = doc.splitTextToSize(tr(sherloqData.stegano.hidden_text || ''), CW - 8);
          doc.text(lines.slice(0, 2), M + 3, cy + 11); // show first two lines of text
          
          cy += 24;
          
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(30, 30, 30);
          doc.text('Tespit Yontemi: ' + tr(sherloqData.stegano.detected_method || ''), M + 3, cy);
          doc.text('Stegano Skoru: %' + sherloqData.stegano.stegano_score, M + 100, cy);
          cy += 6;
        } else {
          doc.setFillColor(240, 252, 240); doc.rect(M, cy, CW, 10, 'F');
          doc.setDrawColor(50, 180, 50); doc.setLineWidth(0.4); doc.rect(M, cy, CW, 10);
          
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(20, 120, 20);
          doc.text('LSB bit katmanlarinda ve alpha kanallarinda yapilan derin zsteg taramasinda anlamli bir gizli ASCII mesaji saptanamamistir.', M + 3, cy + 6);
          cy += 14;
        }
        
        // Add LSB stats
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(0, 80, 40);
        doc.text('LSB Veri Dagilim Istatistikleri:', M + 3, cy);
        cy += 5;
        
        const stRows = [
          ['LSB Entropisi (Ortalama)', sherloqData.stegano.entropy.avg.toFixed(4), 'Chi-Square Degeri', sherloqData.stegano.chi_square.toFixed(4)],
          ['Sifir (0) Bit Sayisi', sherloqData.stegano.lsb_stats.zeros.toLocaleString(), 'Bir (1) Bit Sayisi', sherloqData.stegano.lsb_stats.ones.toLocaleString()]
        ];
        
        stRows.forEach((row, i) => {
          const ry = cy + i * 7;
          doc.setFillColor(i % 2 === 0 ? 245 : 252, 255, 255);
          doc.rect(M, ry, CW, 7, 'F');
          
          doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(60, 60, 60);
          doc.text(tr(row[0]) + ':', M + 3, ry + 5);
          doc.setFont('helvetica', 'normal'); doc.setTextColor(0, 0, 0);
          doc.text(row[1], M + 45, ry + 5);
          
          doc.setFont('helvetica', 'bold'); doc.setTextColor(60, 60, 60);
          doc.text(tr(row[2]) + ':', M + 100, ry + 5);
          doc.setFont('helvetica', 'normal'); doc.setTextColor(0, 0, 0);
          doc.text(row[3], M + 140, ry + 5);
        });
        cy += stRows.length * 7 + 6;
      }

      // Ghost Maps
      if (sherloqData.ghost && sherloqData.ghost.ghost_maps && Object.keys(sherloqData.ghost.ghost_maps).length > 0) {
        if (cy > 185) { footer(doc.getNumberOfPages()); doc.addPage(); cy = 20; }
        cy = secHeader('JPEG GHOST MAP ANALIZI  -  Sikistirma Izi Tespiti', cy, 60, 0, 80);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(50, 20, 60);
        const ghostDesc = tr('Farkli JPEG kalitelerinde kaydedilmis gorsel parcalari birlestirildigi zaman sikistirma izleri olusur. Haritalarda belirgin sekilde siyah/beyaz ayrisan bolgeler farkli kaynaktan alinmis olabilir.');
        doc.text(doc.splitTextToSize(ghostDesc, CW - 4), M + 2, cy);
        cy += 12;
        const ghostEntries = Object.entries(sherloqData.ghost.ghost_maps);
        const colCount = Math.min(ghostEntries.length, 4);
        const gmW = (CW - (colCount - 1) * 4) / colCount;
        const gmH = Math.min(gmW * 0.8, 45);
        ghostEntries.slice(0, 4).forEach(([quality, base64], i) => {
          const gx = M + i * (gmW + 4);
          try { doc.addImage('data:image/png;base64,' + base64, 'PNG', gx, cy, gmW, gmH); } catch (_) { /* skip */ }
          doc.setDrawColor(100, 0, 120); doc.setLineWidth(0.3); doc.rect(gx, cy, gmW, gmH);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(80, 0, 100);
          doc.text('Q=' + quality, gx + gmW / 2, cy + gmH + 4, { align: 'center' });
        });
        cy += gmH + 14;
        if (ghostEntries.length > 4) {
          ghostEntries.slice(4, 8).forEach(([quality, base64], i) => {
            const gx = M + i * (gmW + 4);
            try { doc.addImage('data:image/png;base64,' + base64, 'PNG', gx, cy, gmW, gmH); } catch (_) { /* skip */ }
            doc.setDrawColor(100, 0, 120); doc.setLineWidth(0.3); doc.rect(gx, cy, gmW, gmH);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(80, 0, 100);
            doc.text('Q=' + quality, gx + gmW / 2, cy + gmH + 4, { align: 'center' });
          });
          cy += gmH + 14;
        }
      }

      // Sherloq Özet Tablosu
      if (cy < 245) {
        if (cy > 220) { footer(doc.getNumberOfPages()); doc.addPage(); cy = 20; }
        cy += 4;
        cy = secHeader('SHERLOQ MODUL CALISMA OZETI', cy, 20, 70, 40);
        const sherloqModules: [string, string, string][] = [
          ['Sinyal Analizi', sherloqData.signal ? 'TAMAMLANDI' : 'CALISTIRILMADI', sherloqData.signal ? 'Gradient, Noise Residual, High-Pass goruntuleri uretildi.' : 'Sherloq analizini calistirin.'],
          ['JPEG Ghost Map', sherloqData.ghost ? 'TAMAMLANDI' : 'CALISTIRILMADI', sherloqData.ghost ? Object.keys(sherloqData.ghost.ghost_maps || {}).length + ' kalite duzeyinde ghost haritasi olusturuldu.' : 'Analiz bekleniyor.'],
          ['Illuminant Haritasi', sherloqData.illuminant ? 'TAMAMLANDI' : 'CALISTIRILMADI', sherloqData.illuminant ? 'Isik kaynagi renk sicakligi haritasi cikarildi.' : 'Analiz bekleniyor.'],
          ['LSB Bit-Plane', sherloqData.bitplane ? 'TAMAMLANDI' : 'CALISTIRILMADI', sherloqData.bitplane ? 'Bit katmani ' + (sherloqData.bitplane.plane || 0) + ' analiz edildi.' : 'Analiz bekleniyor.'],
          ['Steganografi Analizi', sherloqData.stegano ? 'TAMAMLANDI' : 'CALISTIRILMADI', sherloqData.stegano ? (sherloqData.stegano.has_hidden_message ? 'Gizli veri tespit edildi: ' + tr(sherloqData.stegano.detected_method || '') : 'Temiz. Gizli veri saptanmadi.') : 'Analiz bekleniyor.'],
          ['Kriptografik Hash', results?.hashes ? 'DOGRULANDI' : 'YOK', results?.hashes ? 'MD5 / SHA-1 / SHA-256 degerleri hesaplandi.' : 'Hash verisi bulunamadi.'],
          ['EXIF Meta Veri', (results.exif_data && Object.keys(results.exif_data).length > 0) ? 'MEVCUT' : 'YOK', (results.exif_data && Object.keys(results.exif_data).length > 0) ? Object.keys(results.exif_data).length + ' adet meta veri alani tespit edildi.' : 'EXIF verisi bulunamadi.'],
        ];
        [['MODUL', 'DURUM', 'ACIKLAMA'] as [string, string, string], ...sherloqModules].forEach((row, i) => {
          const ry = cy + i * 9; const hdr = i === 0;
          doc.setFillColor(hdr ? 10 : i % 2 === 0 ? 235 : 248, hdr ? 70 : i % 2 === 0 ? 248 : 252, hdr ? 35 : i % 2 === 0 ? 238 : 248);
          doc.rect(M, ry, CW, 9, 'F');
          const cols2 = [M + 2, M + 52, M + 90];
          row.forEach((cell, j) => {
            if (hdr) { doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(255, 255, 255); }
            else if (j === 1) {
              const ok = ['TAMAMLANDI', 'DOGRULANDI', 'MEVCUT'].includes(cell);
              doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(ok ? 0 : 150, ok ? 120 : 50, 0);
            } else { doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(30, 30, 30); }
            doc.text(cell, cols2[j], ry + 6);
          });
        });
      }

      footer(doc.getNumberOfPages());
    }

    doc.save('PULSAR_Raporu_' + (files.length > 0 ? files[0].name.split('.')[0] : 'gorsel') + '_' + new Date().toISOString().slice(0, 10) + '.pdf');
  };

  // const threatColor = results?.is_manipulated ? '#ef4444' : '#4ade80';

  return (
    <div className="flex flex-col min-h-screen scanlines" style={{ background: 'radial-gradient(circle at 50% 30%, #0a1628 0%, #020817 60%, #000 100%)', color: '#e2e8f0', fontFamily: "'Inter', sans-serif" }}>
      {/* HEADER */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-cyan-500/20 bg-black/50 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Search className="w-6 h-6 text-cyan-400" />
          <h1 className="text-xl font-bold tracking-[0.2em] text-cyan-400 shadow-cyan-400/50">GÖRSEL ADLİ BİLİŞİM LABORATUVARI</h1>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 p-6 flex gap-6 overflow-hidden">

        {/* SOL PANEL: YÜKLEME VE ÖZET */}
        <div className="w-[320px] flex flex-col gap-6 flex-shrink-0">

          <div className="rounded-xl border border-cyan-500/20 bg-black/40 p-5 backdrop-blur-md">
            <h2 className="text-sm font-bold tracking-wider mb-4 flex items-center gap-2 text-cyan-400"><Upload className="w-4 h-4" /> DOSYA YÜKLE</h2>

            <div className="border border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all hover:bg-cyan-400/10" style={{ borderColor: 'rgba(0, 212, 255, 0.3)' }} onClick={() => fileInputRef.current?.click()}>
              <FileImage className="w-10 h-10 mb-3 opacity-80 text-cyan-400" />
              <p className="text-sm text-gray-200 font-medium mb-1">Görsel Seçin veya Sürükleyin</p>
              <p className="text-[10px] text-cyan-600 font-mono tracking-widest uppercase">Desteklenen: .png, .jpg</p>
              <input type="file" hidden ref={fileInputRef} onChange={handleFileUpload} accept="image/*" />
            </div>

            <div className="mt-4">
              <AnimatePresence>
                {files.map(file => (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} key={file.id} className="flex items-center justify-between p-3 rounded-lg border border-cyan-500/30 bg-black/60 shadow-[0_0_10px_rgba(0,212,255,0.1)]">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <ImageIcon className="w-5 h-5 text-cyan-400 flex-shrink-0" />
                      <div className="flex flex-col truncate">
                        <span className="text-xs font-bold truncate text-white">{file.name}</span>
                        <span className="text-[10px] text-cyan-400 font-mono mt-0.5">{file.size}</span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <Button
              className="w-full mt-6 font-bold tracking-[0.15em] text-black text-xs py-6 transition-all hover:scale-[1.02]"
              style={{ background: status === 'ANALYZING' ? '#fbbf24' : '#00d4ff', boxShadow: status === 'ANALYZING' ? '0 0 15px rgba(251,191,36,0.4)' : '0 0 15px rgba(0,212,255,0.4)' }}
              onClick={startAnalysis}
              disabled={files.length === 0 || status === 'ANALYZING'}
            >
              {status === 'ANALYZING' ? 'AĞLAR İŞLİYOR...' : 'ADLİ ANALİZİ BAŞLAT'}
            </Button>
          </div>



          {aiProofReport && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-purple-500/30 bg-black/40 p-5 backdrop-blur-md overflow-y-auto max-h-[350px] custom-scrollbar">
              <h2 className="text-xs font-bold tracking-wider mb-3 flex items-center gap-2 text-purple-400">
                <Bot className="w-4 h-4" /> YAPAY ZEKA GÖRSEL KANITLARI
              </h2>
              <p className="text-[10px] text-purple-200/80 leading-relaxed whitespace-pre-wrap font-mono">
                {aiProofReport}
              </p>
            </motion.div>
          )}

          {results && results.hashes && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-cyan-500/30 bg-black/40 p-5 backdrop-blur-md overflow-y-auto max-h-[250px] custom-scrollbar">
              <h2 className="text-xs font-bold tracking-wider mb-3 flex items-center gap-2 text-cyan-400">
                <Database className="w-4 h-4" /> SHERLOQ: DOSYA KİMLİĞİ
              </h2>
              <div className="flex flex-col gap-2">
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-500 font-bold uppercase tracking-widest">MD5 Hash</span>
                  <span className="text-[10px] text-cyan-300 font-mono break-all">{results.hashes.md5}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-500 font-bold uppercase tracking-widest">SHA-256 Hash</span>
                  <span className="text-[10px] text-cyan-300 font-mono break-all">{results.hashes.sha256}</span>
                </div>
                {results.exif_data && Object.keys(results.exif_data).length > 0 && (
                  <div className="mt-2 border-t border-cyan-500/20 pt-2">
                    <span className="text-[9px] text-gray-500 font-bold uppercase tracking-widest mb-1 block">EXIF / Meta Veri</span>
                    {Object.entries(results.exif_data).slice(0, 5).map(([key, value]) => (
                      <div key={key} className="text-[9px] font-mono text-gray-300 flex justify-between border-b border-white/5 py-1">
                        <span className="text-cyan-500 mr-2">{key}:</span>
                        <span className="truncate">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </div>

        {/* SAĞ PANEL: GÖRSEL DETAY ALANI & YAPAY ZEKA */}
        <div className="flex-1 rounded-xl border border-cyan-500/20 bg-black/40 backdrop-blur-md flex flex-col overflow-hidden relative">

          <div className="flex border-b border-white/5 bg-black/20">
            <button onClick={() => setActiveTab('analysis')} className={`flex-1 py-3 text-xs uppercase font-bold tracking-widest transition-all ${activeTab === 'analysis' ? 'text-cyan-400 bg-cyan-400/10 border-b-2 border-cyan-400' : 'text-gray-500 hover:text-gray-300 border-b-2 border-transparent'}`}>
              <Search className="w-4 h-4 inline-block mr-2 mt-[-2px]" /> Görüntü Analizi
            </button>

            <button onClick={() => setActiveTab('sherloq')} className={`flex-1 py-3 text-xs uppercase font-bold tracking-widest transition-all ${activeTab === 'sherloq' ? 'text-green-400 bg-green-400/10 border-b-2 border-green-400' : 'text-gray-500 hover:text-gray-300 border-b-2 border-transparent'}`}>
              <Database className="w-4 h-4 inline-block mr-2 mt-[-2px]" /> Sherloq Araçları
            </button>

            <button onClick={() => setActiveTab('ai')} className={`flex-1 py-3 text-xs uppercase font-bold tracking-widest transition-all ${activeTab === 'ai' ? 'text-purple-400 bg-purple-400/10 border-b-2 border-purple-400' : 'text-gray-500 hover:text-gray-300 border-b-2 border-transparent'}`}>
              <Bot className="w-4 h-4 inline-block mr-2 mt-[-2px]" /> YAPAY ZEKA (PULSAR AI)
            </button>
          </div>

          <div className="flex-1 relative overflow-hidden bg-[#02050a]">
            <AnimatePresence mode="wait">

              {activeTab === 'analysis' && (
                <motion.div key="analysis-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col">
                  {status === 'IDLE' && (
                    <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center opacity-30">
                      <Search className="w-20 h-20 mb-6 text-cyan-400" />
                      <p className="text-xl font-mono tracking-[0.3em] text-cyan-400">ANALİZ İÇİN BEKLENİYOR</p>
                      <p className="text-xs font-mono text-cyan-600 mt-2 tracking-widest">SİSTEM STANDBY DURUMUNDA</p>
                    </motion.div>
                  )}

                  {status === 'ANALYZING' && (
                    <motion.div key="analyzing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center">
                      <Activity className="w-16 h-16 mb-6 text-cyan-400 animate-pulse" />
                      <p className="text-sm font-mono tracking-[0.2em] text-cyan-400 animate-pulse">PİKSELLER ÇÖZÜMLENİYOR...</p>
                    </motion.div>
                  )}

                  {status === 'COMPLETE' && results && (
                    <motion.div key="complete" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col">
                      <div className="p-4 bg-black/60 border-b border-white/5 flex justify-between items-center z-10">
                        <div className="flex items-center gap-2 text-red-400 font-bold tracking-widest text-sm">
                          <Fingerprint className="w-5 h-5" /> UZMAN ONAYLI RAPOR
                        </div>
                        <div className="flex gap-2">
                          <Button onClick={generatePDF} className="bg-green-600 hover:bg-green-500 text-white font-bold tracking-wide shadow-[0_0_10px_rgba(74,222,128,0.3)] text-xs h-8">
                            <Download className="w-3 h-3 mr-2" /> PDF RAPORU İNDİR
                          </Button>
                          <Button onClick={generateWord} className="bg-blue-600 hover:bg-blue-500 text-white font-bold tracking-wide shadow-[0_0_10px_rgba(59,130,246,0.3)] text-xs h-8">
                            <FileText className="w-3 h-3 mr-2" /> WORD RAPORU İNDİR
                          </Button>
                        </div>
                      </div>

                      {/* Sekmeler: Görüntüleme Modları */}
                      <div className="flex border-b border-white/10 bg-[#050b14] overflow-x-auto custom-scrollbar">
                        <button onClick={() => setViewMode('original')} className={`whitespace-nowrap px-4 py-3 text-[10px] uppercase font-bold tracking-widest transition-all ${viewMode === 'original' ? 'text-cyan-400 bg-cyan-400/10 border-b-2 border-cyan-400' : 'text-gray-500 hover:text-gray-300 border-b-2 border-transparent'}`}>
                          Orijinal Görsel
                        </button>
                        <button onClick={() => setViewMode('ela')} className={`whitespace-nowrap px-4 py-3 text-[10px] uppercase font-bold tracking-widest transition-all ${viewMode === 'ela' ? 'text-purple-400 bg-purple-400/10 border-b-2 border-purple-400' : 'text-gray-500 hover:text-gray-300 border-b-2 border-transparent'}`}>
                          Error Level Analysis
                        </button>
                        <button onClick={() => setViewMode('heatmap')} className={`whitespace-nowrap px-4 py-3 text-[10px] uppercase font-bold tracking-widest transition-all ${viewMode === 'heatmap' ? 'text-orange-400 bg-orange-400/10 border-b-2 border-orange-400' : 'text-gray-500 hover:text-gray-300 border-b-2 border-transparent'}`}>
                          DCT Isı Haritası
                        </button>
                        {results.cm_base64 && (
                          <button onClick={() => setViewMode('cm')} className={`whitespace-nowrap px-4 py-3 text-[10px] uppercase font-bold tracking-widest transition-all ${viewMode === 'cm' ? 'text-green-400 bg-green-400/10 border-b-2 border-green-400' : 'text-gray-500 hover:text-gray-300 border-b-2 border-transparent'}`}>
                            Kopyala-Taşı (ORB)
                          </button>
                        )}
                      </div>

                      {/* Gösterim Alanı */}
                      <div className="flex-1 p-8 flex flex-col items-center justify-center relative overflow-hidden group">
                        <img
                          src={`data:image/png;base64,${viewMode === 'original' ? results.original_base64 : viewMode === 'ela' ? results.ela_image_base64 : viewMode === 'cm' ? results.cm_base64 : results.heatmap_base64}`}
                          className="max-w-full max-h-full object-contain rounded-md shadow-[0_0_20px_rgba(0,0,0,0.8)] transition-all duration-300"
                          alt="Analiz Sonucu"
                        />

                        {/* Bilgi Kutusu */}
                        <div className="absolute bottom-6 bg-black/80 px-6 py-3 rounded border border-white/10 text-[11px] font-mono tracking-wider backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center">
                          {viewMode === 'original' && <span className="text-cyan-400">Sisteme yüklenen kaynak görsel.</span>}
                          {viewMode === 'ela' && <><span className="text-purple-400 font-bold mb-1">ELA Katmanı</span><span className="text-gray-300">Resimdeki sıkıştırma farklarını ön plana çıkarır. Parlak noktalar sonradan eklenmiş olabilir.</span></>}
                          {viewMode === 'heatmap' && <><span className="text-orange-400 font-bold mb-1">DCT Enerji Haritası</span><span className="text-gray-300">Kırmızı/Sarı bölgeler algoritmaların manipülasyon olarak işaretlediği piksellerdir.</span></>}
                          {viewMode === 'cm' && <><span className="text-green-400 font-bold mb-1">Sherloq: Kopyala-Taşı Tespiti</span><span className="text-gray-300">ORB algoritması ile benzer pikseller eşleştirilir. Kırmızı noktalar klonlanmış bölgeler olabilir.</span></>}
                        </div>

                        {results.is_manipulated && (
                          <div className="absolute top-6 right-6 bg-red-500/20 text-red-400 px-3 py-1.5 rounded text-[10px] uppercase font-bold border border-red-500/50 flex items-center gap-2 animate-pulse">
                            <ShieldAlert className="w-3 h-3" /> SAHTECİLİK TESPİT EDİLDİ
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              )}

              {activeTab === 'cd_dvd' && (
                <motion.div key="cd-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col">
                  {cdStatus === 'IDLE' && (
                    <motion.div key="idle-cd" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center opacity-30">
                      <HardDrive className="w-20 h-20 mb-6 text-blue-400" />
                      <p className="text-xl font-mono tracking-[0.3em] text-blue-400">MEDYA İMAJI BEKLENİYOR</p>
                      <p className="text-xs font-mono text-blue-600 mt-2 tracking-widest">SİSTEM STANDBY DURUMUNDA</p>
                    </motion.div>
                  )}

                  {cdStatus === 'ANALYZING' && (
                    <motion.div key="analyzing-cd" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center">
                      <FileDigit className="w-16 h-16 mb-6 text-blue-400 animate-pulse" />
                      <p className="text-sm font-mono tracking-[0.2em] text-blue-400 animate-pulse">SEKTÖRLER TARANIYOR VE VERİ ÇIKARILIYOR...</p>
                    </motion.div>
                  )}

                  {cdStatus === 'COMPLETE' && cdResults && (
                    <motion.div key="complete-cd" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col p-6 overflow-y-auto custom-scrollbar">
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <h2 className="text-xl font-bold tracking-widest text-blue-400 flex items-center gap-3">
                            <Disc className="w-6 h-6" /> {cdResults.file_name}
                          </h2>
                          <div className="flex gap-4 mt-2 text-xs font-mono text-gray-400">
                            <span>Format: <strong className="text-white">{cdResults.format}</strong></span>
                            <span>Boyut: <strong className="text-white">{cdResults.file_size_mb} MB</strong></span>
                            <span>SHA256: <strong className="text-white">{cdResults.sha256.substring(0, 16)}...</strong></span>
                          </div>
                        </div>
                        <div className={`px-4 py-2 rounded border flex flex-col items-center ${cdResults.is_manipulated ? 'bg-red-500/20 border-red-500/50 text-red-400' : 'bg-green-500/20 border-green-500/50 text-green-400'}`}>
                          <span className="text-[10px] uppercase font-bold tracking-widest mb-1">Risk Skoru</span>
                          <span className="text-2xl font-black">{cdResults.threat_score}%</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4 mb-8">
                        <div className="bg-black/40 border border-blue-500/20 rounded-lg p-4">
                          <div className="text-gray-400 text-xs font-bold mb-1">Toplam Sektör</div>
                          <div className="text-xl font-mono text-white">{cdResults.total_sectors.toLocaleString()}</div>
                        </div>
                        <div className="bg-black/40 border border-red-500/20 rounded-lg p-4">
                          <div className="text-gray-400 text-xs font-bold mb-1">Bozuk/Anormal Sektör</div>
                          <div className="text-xl font-mono text-red-400">{cdResults.bad_sectors.toLocaleString()}</div>
                        </div>
                        <div className="bg-black/40 border border-purple-500/20 rounded-lg p-4">
                          <div className="text-gray-400 text-xs font-bold mb-1">Gizli / Silinmiş Dosya</div>
                          <div className="text-xl font-mono text-purple-400">{cdResults.hidden_count} / {cdResults.deleted_count}</div>
                        </div>
                      </div>

                      <h3 className="text-sm font-bold tracking-widest text-gray-300 mb-4 border-b border-white/10 pb-2">ÇIKARILAN DOSYALAR</h3>
                      <div className="bg-black/50 border border-white/10 rounded-lg overflow-hidden flex-shrink-0 mb-6">
                        <table className="w-full text-left text-xs font-mono">
                          <thead className="bg-white/5 text-gray-400">
                            <tr>
                              <th className="px-4 py-3">Dosya Adı</th>
                              <th className="px-4 py-3">Boyut</th>
                              <th className="px-4 py-3">Durum</th>
                              <th className="px-4 py-3">MD5 Hash</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {cdResults.extracted_files.map((file, idx) => (
                              <tr key={idx} className="hover:bg-white/5 transition-colors">
                                <td className="px-4 py-3 flex items-center gap-2">
                                  {file.extension === '.exe' || file.extension === '.dll' ? <FileCode className="w-4 h-4 text-orange-400" /> :
                                    file.extension === '.jpg' || file.extension === '.png' ? <ImageIcon className="w-4 h-4 text-blue-400" /> :
                                      <FileText className="w-4 h-4 text-gray-400" />}
                                  <span className="text-gray-200">{file.name}</span>
                                </td>
                                <td className="px-4 py-3 text-gray-400">{(file.size_bytes / 1024).toFixed(1)} KB</td>
                                <td className="px-4 py-3">
                                  {file.status === 'NORMAL' && <span className="text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> NORMAL</span>}
                                  {file.status === 'HIDDEN' && <span className="text-purple-400 flex items-center gap-1"><Lock className="w-3 h-3" /> GİZLİ</span>}
                                  {file.status === 'DELETED' && <span className="text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> SİLİNMİŞ</span>}
                                  {file.status === 'CORRUPTED' && <span className="text-orange-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> BOZUK</span>}
                                </td>
                                <td className="px-4 py-3 text-gray-500 text-[10px]">{file.md5_hash}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                    </motion.div>
                  )}
                </motion.div>
              )}

              {activeTab === 'sherloq' && (
                <motion.div key="sherloq-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col p-6 overflow-y-auto custom-scrollbar">
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <h2 className="text-xl font-bold tracking-widest text-green-400 flex items-center gap-3">
                        <Database className="w-6 h-6" /> SHERLOQ İLERİ DÜZEY ADLİ ARAÇLAR
                      </h2>
                      <p className="text-xs text-green-600/80 mt-1 font-mono uppercase tracking-[0.2em]">
                        RGB/HSV Histogramları, Luminance Gradient, JPEG Ghost Maps, Illuminant Haritası
                      </p>
                    </div>
                    {sherloqStatus === 'IDLE' && files.length > 0 && (
                      <Button onClick={runSherloqAnalysis} className="bg-green-600/20 hover:bg-green-500/30 text-green-400 border border-green-500/50 font-bold tracking-wide text-xs h-10 px-6 uppercase">
                        <Activity className="w-4 h-4 mr-2" /> Gelişmiş Analizi Başlat
                      </Button>
                    )}
                  </div>

                  {files.length === 0 && (
                     <div className="flex-1 flex flex-col items-center justify-center min-h-[300px] opacity-40">
                       <ImageIcon className="w-16 h-16 mb-4 text-green-400" />
                       <p className="text-sm font-mono tracking-[0.2em] text-green-400">GÖRSEL BEKLENİYOR</p>
                       <p className="text-xs font-mono text-green-600 mt-2 tracking-widest text-center mt-4">Sherloq ileri düzey adli analizi başlatabilmek için <br/> sol menüden incelenecek bir görsel yükleyin.</p>
                     </div>
                  )}

                  {sherloqStatus === 'ANALYZING' && (
                     <div className="flex-1 flex flex-col items-center justify-center min-h-[300px]">
                       <Activity className="w-16 h-16 mb-6 text-green-400 animate-pulse" />
                       <p className="text-sm font-mono tracking-[0.2em] text-green-400 animate-pulse">SHERLOQ MODÜLLERİ ÇALIŞTIRILIYOR...</p>
                       <p className="text-xs font-mono text-green-600 mt-2 tracking-widest text-center mt-4">Bu işlem ağır sinyal filtreleme (Sobel, Median) ve JPEG <br/> Sıkıştırma varyans hesaplaması içerdiği için 1-2 dakika sürebilir.</p>
                     </div>
                  )}

                  {sherloqStatus === 'COMPLETE' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-20">
                      
                      {/* Sinyal Analizi Kartı */}
                      {sherloqData.signal && (
                        <div className="bg-black/40 border border-green-500/20 rounded-xl p-5 backdrop-blur-md">
                           <h3 className="text-sm font-bold tracking-wider mb-4 flex items-center gap-2 text-green-400 uppercase">
                             <Activity className="w-4 h-4" /> Sinyal ve Gürültü Filtreleri
                           </h3>
                           <div className="grid grid-cols-2 gap-4">
                             <div>
                               <p className="text-[10px] text-gray-500 font-bold mb-2 uppercase tracking-widest">Luminance Gradient (Sobel)</p>
                               <img src={`data:image/png;base64,${sherloqData.signal.gradient_base64}`} alt="Gradient" className="w-full rounded border border-white/10" />
                             </div>
                             <div>
                               <p className="text-[10px] text-gray-500 font-bold mb-2 uppercase tracking-widest">Median Noise Residual</p>
                               <img src={`data:image/png;base64,${sherloqData.signal.median_noise_base64}`} alt="Median Noise" className="w-full rounded border border-white/10" />
                             </div>
                             <div className="col-span-2">
                               <p className="text-[10px] text-gray-500 font-bold mb-2 uppercase tracking-widest">Yüksek Frekans (High-Pass)</p>
                               <img src={`data:image/png;base64,${sherloqData.signal.high_frequency_base64}`} alt="High Freq" className="w-full rounded border border-white/10 max-h-[150px] object-cover" />
                             </div>
                           </div>
                        </div>
                      )}

                      <div className="flex flex-col gap-6">
                        {/* Illuminant Kartı */}
                        {sherloqData.illuminant && (
                          <div className="bg-black/40 border border-yellow-500/20 rounded-xl p-5 backdrop-blur-md flex flex-col flex-1">
                             <h3 className="text-sm font-bold tracking-wider mb-4 flex items-center gap-2 text-yellow-400 uppercase">
                               <Search className="w-4 h-4" /> Aydınlatma (Illuminant) Haritası
                             </h3>
                             <p className="text-[10px] text-gray-400 mb-4 leading-relaxed">
                               Aydınlatma haritası, görüntüdeki ışık kaynaklarının renk sıcaklığını tahmin eder. Kırpma/Yapıştırma (splicing) yapılmış görsellerde, farklı ışık altında çekilmiş parçalar farklı renkte gözükecektir.
                             </p>
                             <div className="flex-1 flex items-center justify-center bg-black/50 rounded border border-white/5 p-2">
                               <img src={`data:image/png;base64,${sherloqData.illuminant.illuminant_map_base64}`} alt="Illuminant Map" className="max-w-full max-h-[200px] object-contain rounded" />
                             </div>
                          </div>
                        )}

                        {/* Bit-Plane Kartı */}
                        {sherloqData.bitplane && (
                          <div className="bg-black/40 border border-blue-500/20 rounded-xl p-5 backdrop-blur-md flex flex-col flex-1">
                             <h3 className="text-sm font-bold tracking-wider mb-4 flex items-center gap-2 text-blue-400 uppercase">
                               <Layers className="w-4 h-4" /> LSB Bit-Plane Analizi
                             </h3>
                             <p className="text-[10px] text-gray-400 mb-4 leading-relaxed">
                               En Az Önemli Bit (Least Significant Bit) katmanı. Steganografi ile gizlenmiş mesajlar veya yapay olarak eklenmiş dijital anomaliler genellikle bu katmanda bir gürültü deseni olarak kendini belli eder.
                             </p>
                             <div className="flex-1 flex items-center justify-center bg-black/50 rounded border border-white/5 p-2">
                               <img src={`data:image/png;base64,${sherloqData.bitplane.bit_plane_base64}`} alt="Bit Plane 0" className="max-w-full max-h-[200px] object-contain rounded" />
                             </div>
                          </div>
                        )}
                      </div>

                      {/* Ghost Maps Kartı */}
                      {sherloqData.ghost && sherloqData.ghost.ghost_maps && (
                        <div className="bg-black/40 border border-purple-500/20 rounded-xl p-5 backdrop-blur-md col-span-1 lg:col-span-2">
                           <h3 className="text-sm font-bold tracking-wider mb-4 flex items-center gap-2 text-purple-400 uppercase">
                             <ShieldAlert className="w-4 h-4" /> JPEG Ghost Map Analizi
                           </h3>
                           <p className="text-[10px] text-gray-400 mb-4 leading-relaxed">
                             Farklı JPEG kalitelerinde kaydedilmiş görseller birleştirildiğinde, sıkıştırma izleri (ghosting) oluşur. Aşağıdaki haritalarda belirli bölgeler siyah veya beyaz olarak ayrışıyorsa, o bölge muhtemelen farklı bir kaynaktan alınmıştır.
                           </p>
                           <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                             {Object.entries(sherloqData.ghost.ghost_maps).map(([quality, base64]) => (
                               <div key={quality} className="flex flex-col items-center">
                                 <span className="text-[10px] font-bold text-gray-500 mb-2">Kalite: {quality}</span>
                                 <img src={`data:image/png;base64,${base64}`} alt={`Ghost map ${quality}`} className="w-full rounded border border-white/10 hover:scale-110 transition-transform cursor-pointer" />
                               </div>
                             ))}
                           </div>
                        </div>
                      )}

                      {/* STEGANOGRAFİ KARTI */}
                      {sherloqData.stegano && (
                        <div className="col-span-1 lg:col-span-2 rounded-xl p-5 backdrop-blur-md border"
                          style={{
                            background: sherloqData.stegano.has_hidden_message
                              ? 'linear-gradient(135deg,rgba(220,38,38,0.12),rgba(0,0,0,0.5))'
                              : 'rgba(0,0,0,0.4)',
                            borderColor: sherloqData.stegano.has_hidden_message
                              ? 'rgba(239,68,68,0.5)' : 'rgba(34,197,94,0.2)'
                          }}
                        >
                          {/* Başlık */}
                          <h3 className="text-sm font-bold tracking-wider mb-1 flex items-center gap-2 uppercase"
                            style={{ color: sherloqData.stegano.has_hidden_message ? '#f87171' : '#4ade80' }}>
                            <ShieldAlert className="w-4 h-4" />
                            STEGANOGRAFİ ANALİZİ — GİZLİ YAZI TESPİTİ
                            <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-mono"
                              style={{
                                background: sherloqData.stegano.has_hidden_message ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.15)',
                                color: sherloqData.stegano.has_hidden_message ? '#fca5a5' : '#86efac'
                              }}>
                              {sherloqData.stegano.has_hidden_message ? '⚠ GİZLİ VERİ TESPİT EDİLDİ' : '✓ NORMAL'}
                            </span>
                          </h3>
                          {sherloqData.stegano.detected_method && (
                            <p className="text-[10px] font-mono mb-2" style={{ color: sherloqData.stegano.has_hidden_message ? '#fca5a5' : '#86efac' }}>
                              🔍 Tespit Yöntemi: <strong>{sherloqData.stegano.detected_method}</strong>
                            </p>
                          )}
                          <p className="text-[10px] text-gray-400 mb-4 leading-relaxed">
                            LSB (En Az Önemli Bit) steganografisi: Görselin her pikselinin en düşük bit katmanına kısa metin gizlenebilir. Sistem RGB kanallarını sırayla okuyarak gizli ASCII mesajları ve entropi anomalilerini tespit eder.
                          </p>

                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {/* Sol: Gizli mesaj kutusu */}
                            <div className="flex flex-col gap-3">
                              <div className="rounded-lg p-4 border"
                                style={{
                                  background: sherloqData.stegano.has_hidden_message
                                    ? 'rgba(239,68,68,0.08)' : 'rgba(0,255,100,0.04)',
                                  borderColor: sherloqData.stegano.has_hidden_message
                                    ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.15)'
                                }}>
                                <p className="text-[10px] font-bold uppercase tracking-widest mb-2"
                                  style={{ color: sherloqData.stegano.has_hidden_message ? '#fca5a5' : '#86efac' }}>
                                  {sherloqData.stegano.has_hidden_message ? '🔓 Çıkarılan Gizli Mesaj:' : '🔒 Gizli Mesaj Bulunamadı'}
                                </p>
                                {sherloqData.stegano.has_hidden_message && sherloqData.stegano.hidden_text ? (
                                  <div className="relative">
                                    <pre className="text-sm font-mono text-red-200 bg-black/60 rounded p-3 border border-red-500/20 whitespace-pre-wrap break-all max-h-[120px] overflow-y-auto custom-scrollbar">
                                      {sherloqData.stegano.hidden_text}
                                    </pre>
                                    <span className="absolute top-1 right-2 text-[9px] text-red-400/60 font-mono">
                                      {sherloqData.stegano.message_length} karakter
                                    </span>
                                  </div>
                                ) : (
                                  <p className="text-xs text-gray-500 font-mono italic">
                                    LSB bit katmanında anlamlı ASCII verisi bulunamadı.
                                  </p>
                                )}
                              </div>

                              {/* İstatistik tablosu */}
                              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                                {[
                                  { lbl: 'Stegano Skoru', val: `${sherloqData.stegano.stegano_score}%`,
                                    color: sherloqData.stegano.stegano_score > 60 ? '#f87171' : '#4ade80' },
                                  { lbl: 'Chi-Square', val: sherloqData.stegano.chi_square.toFixed(4),
                                    color: sherloqData.stegano.chi_square < 5 ? '#fbbf24' : '#4ade80' },
                                  { lbl: 'LSB Entropi (Ort)', val: sherloqData.stegano.entropy.avg.toFixed(4),
                                    color: sherloqData.stegano.entropy.avg > 0.9 ? '#f87171' : '#4ade80' },
                                  { lbl: 'LSB Denge (%1)', val: `${sherloqData.stegano.lsb_stats.balance_pct}%`,
                                    color: Math.abs(sherloqData.stegano.lsb_stats.balance_pct - 50) < 3 ? '#fbbf24' : '#4ade80' },
                                  { lbl: 'R Kanalı Entropi', val: sherloqData.stegano.entropy.r.toFixed(4), color: '#94a3b8' },
                                  { lbl: 'G Kanalı Entropi', val: sherloqData.stegano.entropy.g.toFixed(4), color: '#94a3b8' },
                                ].map(({ lbl, val, color }) => (
                                  <div key={lbl} className="bg-black/40 rounded p-2 border border-white/5">
                                    <p className="text-gray-500 uppercase tracking-wider text-[9px]">{lbl}</p>
                                    <p className="font-bold text-sm mt-0.5" style={{ color }}>{val}</p>
                                  </div>
                                ))}
                              </div>

                              {/* Şüphe uyarısı */}
                              {sherloqData.stegano.is_suspicious && (
                                <div className="rounded-lg p-3 border border-yellow-500/30 bg-yellow-500/10 text-yellow-300 text-[11px] font-mono leading-relaxed">
                                  ⚠️ <strong>CHI-SQUARE UYARISI:</strong> LSB dağılımı uniform (χ²&lt;5 ve entropi&gt;0.9). Bu görselde steganografi aracı kullanılmış olabilir.
                                </div>
                              )}

                              {/* Tüm denemeler tablosu */}
                              {sherloqData.stegano.all_attempts && sherloqData.stegano.all_attempts.length > 0 && (
                                <div className="mt-2">
                                  <p className="text-[9px] font-bold uppercase tracking-widest text-gray-500 mb-1">En İyi 5 Denenen Yöntem:</p>
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-[9px] font-mono border-collapse">
                                      <thead>
                                        <tr className="border-b border-white/10">
                                          <th className="text-left py-1 px-1 text-gray-500">Yöntem</th>
                                          <th className="text-right py-1 px-1 text-gray-500">Uzun.</th>
                                          <th className="text-right py-1 px-1 text-gray-500">Skor</th>
                                          <th className="text-left py-1 px-1 text-gray-500">Önizleme</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {sherloqData.stegano.all_attempts.map((a, i) => (
                                          <tr key={i} className="border-b border-white/5" style={{ background: i === 0 ? 'rgba(34,197,94,0.08)' : 'transparent' }}>
                                            <td className="py-1 px-1" style={{ color: i === 0 ? '#4ade80' : '#6b7280' }}>{a.method}</td>
                                            <td className="py-1 px-1 text-right text-gray-400">{a.length}</td>
                                            <td className="py-1 px-1 text-right" style={{ color: i === 0 ? '#4ade80' : '#6b7280' }}>{a.score}</td>
                                            <td className="py-1 px-1 text-gray-400 max-w-[120px] truncate">{a.text_preview || '—'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Sağ: LSB haritası */}
                            <div className="flex flex-col gap-2">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                                LSB Görsel Haritası (R·G·B Katmanları)
                              </p>
                              <div className="flex-1 bg-black/50 rounded border border-white/5 p-2 flex items-center justify-center">
                                <img
                                  src={`data:image/png;base64,${sherloqData.stegano.lsb_map_base64}`}
                                  alt="LSB Map"
                                  className="max-w-full max-h-[220px] object-contain rounded"
                                  style={{ imageRendering: 'pixelated' }}
                                />
                              </div>
                              <p className="text-[9px] text-gray-600 font-mono leading-relaxed">
                                Her piksel RGB kanalının en düşük biti görselleştirilmiştir. Desen görülüyorsa veri gizlenmiş olabilir.
                              </p>
                              <div className="flex gap-3 text-[10px] font-mono text-gray-400">
                                <span>0-bit: <strong className="text-white">{sherloqData.stegano.lsb_stats.zeros.toLocaleString()}</strong></span>
                                <span>1-bit: <strong className="text-white">{sherloqData.stegano.lsb_stats.ones.toLocaleString()}</strong></span>
                              </div>
                            </div>
                          </div>

                          {/* Alt not */}
                          <div className="mt-3 pt-3 border-t border-white/5">
                            <p className="text-[10px] text-gray-500 font-mono">{sherloqData.stegano.note}</p>
                          </div>
                        </div>
                      )}

                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'ai' && (
                /* AI CHAT TAB (PULSAR CORE) */
                <motion.div key="ai-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-between p-8 bg-[#02050a]">
                  <div className="absolute top-8 left-6 w-64 max-h-[350px] overflow-y-auto pr-2 flex flex-col gap-2 pointer-events-auto opacity-70 hover:opacity-100 transition-opacity custom-scrollbar z-20">
                    {chatMessages.map((msg, i) => (
                      <div key={i} className="flex flex-col gap-0.5">
                        <span className={`text-[8px] font-mono tracking-widest uppercase ${msg.role === 'user' ? 'text-cyan-500' : 'text-purple-400'}`}>
                          {msg.role === 'user' ? 'Araştırmacı' : 'Pulsar Adli AI'}
                        </span>
                        <span className={`${msg.role === 'user' ? 'text-cyan-200' : 'text-gray-300'} text-[11px] font-mono bg-black/60 p-2.5 rounded border border-white/5 whitespace-pre-line leading-relaxed`}>
                          {msg.text}
                        </span>
                      </div>
                    ))}
                    {isAiThinking && (
                      <div className="flex gap-1 items-center px-2 py-1">
                        <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce [animation-duration:0.6s]"></div>
                        <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce [animation-duration:0.6s] [animation-delay:0.2s]"></div>
                        <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce [animation-duration:0.6s] [animation-delay:0.4s]"></div>
                      </div>
                    )}
                  </div>

                  {/* 3D AVATAR */}
                  <div className="flex-1 flex items-center justify-center relative w-full h-[60%]">
                    <Suspense fallback={<div className="animate-pulse text-purple-400 font-mono text-sm tracking-widest">AĞ BİLEŞENLERİ YÜKLENİYOR...</div>}>
                      <EvaViewer
                        size="100%"
                        voiceState={voice.status === 'speaking' ? 'speaking' : voice.status === 'listening' ? 'listening' : isAiThinking ? 'processing' : 'idle'}
                        status={(isAiThinking || voice.status === 'error') ? 'WARNING' : 'SECURE'}
                      />
                    </Suspense>
                  </div>

                  {/* COMMAND BAR */}
                  <div className="w-full max-w-2xl mt-4 z-20">
                    <div className="flex items-center gap-3 bg-black/60 p-2 pl-3 pr-2 rounded border backdrop-blur-xl" style={{ borderColor: 'rgba(168, 85, 247, 0.4)' }}>
                      <button onClick={voice.toggleListening} className={`p-2 rounded-full transition-colors group ${voice.isRecording ? 'bg-red-500/20' : 'hover:bg-purple-400/10'}`}>
                        <Mic className={`w-5 h-5 ${voice.isRecording ? 'text-red-400 animate-pulse' : 'text-purple-400 opacity-60 group-hover:opacity-100'}`} />
                      </button>

                      <input
                        className="flex-1 bg-transparent border-none outline-none text-sm font-mono text-purple-300 placeholder:text-purple-800"
                        placeholder="Yapay zeka asistanına sor veya sesli komut ver..."
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendAi()}
                      />

                      <button
                        onClick={handleStopAi}
                        title="Yanıtı Durdur"
                        disabled={!isAiThinking}
                        className={`h-10 px-4 font-bold tracking-[0.1em] rounded-md text-white flex items-center gap-2 transition-all
                            ${isAiThinking
                            ? 'animate-pulse hover:scale-105 shadow-[0_0_12px_rgba(239,68,68,0.6)] cursor-pointer'
                            : 'opacity-30 cursor-not-allowed'
                          }`}
                        style={{ background: isAiThinking ? '#ef4444' : '#6b1a1a' }}
                      >
                        <Square className={`w-4 h-4 ${isAiThinking ? 'fill-white' : 'fill-gray-400'}`} /> DURDUR
                      </button>

                      <Button
                        onClick={handleSendAi}
                        className="h-10 px-8 font-bold tracking-[0.1em] rounded-md text-white transition-all hover:scale-105 shadow-[0_0_10px_rgba(168,85,247,0.4)]"
                        style={{ background: '#a855f7' }}
                        disabled={isAiThinking || voice.isRecording || !chatInput.trim()}
                      >
                        {isAiThinking ? 'DÜŞÜNÜYOR...' : 'İLET'}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}
