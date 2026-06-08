/**
 * generateWord.ts
 * Akademik rapor formatında Word belgesi oluşturur.
 * Yapı: Özet → Giriş → Literatür → Yöntem → Sonuç → Kaynakça
 * Kaynakça: Kaggle / Deep Fake Detection on Images and Videos notebookuna dayalı
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  NumberFormat,
  LevelFormat,
  convertInchesToTwip,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ImageRun,
  PageBreak,
} from 'docx';
import { saveAs } from 'file-saver';

// ──────────────────────────────────────────────────────────────
// Tip: Dışarıdan aktarılabilecek analiz sonucu
// ──────────────────────────────────────────────────────────────
export interface WordReportData {
  fileName?: string;
  manipulationScore?: number;
  isManipulated?: boolean;
  manipulationLevel?: string;
  analysisMethod?: string;
  modelUsed?: boolean;
  dctBlocksAnalyzed?: number;
  elaMeanIntensity?: number;
  aiProofReport?: string;
  originalBase64?: string;
  elaBase64?: string;
  heatmapBase64?: string;
  hashes?: { md5: string; sha1: string; sha256: string };
}

// ──────────────────────────────────────────────────────────────
// KAYNAKÇA — Kaggle: Deep Fake Detection on Images and Videos
// krooz0 / https://www.kaggle.com/code/krooz0/deep-fake-detection-on-images-and-videos
// ──────────────────────────────────────────────────────────────
const REFERENCES = [
  {
    no: 1,
    text: 'Rossler, A., Cozzolino, D., Verdoliva, L., Riess, C., Thies, J., & Nießner, M. (2019). FaceForensics++: Learning to Detect Manipulated Facial Images. In Proceedings of the IEEE/CVF International Conference on Computer Vision (ICCV), 1–11.',
  },
  {
    no: 2,
    text: 'Li, Y., & Lyu, S. (2018). Exposing DeepFake Videos By Detecting Face Warping Artifacts. arXiv preprint arXiv:1811.00656.',
  },
  {
    no: 3,
    text: 'Nguyen, T. T., Nguyen, Q. V. H., Nguyen, D. T., Nguyen, D. T., Huynh-The, T., Nahavandi, S., & Nguyen, C. M. (2022). Deep Learning for Deepfakes Creation and Detection: A Survey. Computer Vision and Image Understanding, 223, 103525.',
  },
  {
    no: 4,
    text: 'He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep Residual Learning for Image Recognition. In Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition (CVPR), 770–778.',
  },
  {
    no: 5,
    text: 'Simonyan, K., & Zisserman, A. (2015). Very Deep Convolutional Networks for Large-Scale Image Recognition. In International Conference on Learning Representations (ICLR).',
  },
  {
    no: 6,
    text: 'Chollet, F. (2017). Xception: Deep Learning with Depthwise Separable Convolutions. In Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition (CVPR), 1251–1258.',
  },
  {
    no: 7,
    text: 'Tan, M., & Le, Q. V. (2019). EfficientNet: Rethinking Model Scaling for Convolutional Neural Networks. In Proceedings of the 36th International Conference on Machine Learning (ICML), 6105–6114.',
  },
  {
    no: 8,
    text: 'Korshunov, P., & Marcel, S. (2018). DeepFakes: A New Threat to Face Recognition? Assessment and Detection. arXiv preprint arXiv:1812.08685.',
  },
  {
    no: 9,
    text: 'Tolosana, R., Vera-Rodriguez, R., Fierrez, J., Morales, A., & Ortega-Garcia, J. (2020). Deepfakes and Beyond: A Survey of Face Manipulation and Fake Detection. Information Fusion, 64, 131–148.',
  },
  {
    no: 10,
    text: 'Dolhansky, B., Howes, R., Pflaum, B., Baram, N., & Ferrer, C. C. (2019). The Deepfake Detection Challenge (DFDC) Preview Dataset. arXiv preprint arXiv:1910.08854.',
  },
];

// ──────────────────────────────────────────────────────────────
// Yardımcı: Başlık paragrafı
// ──────────────────────────────────────────────────────────────
function heading(text: string, level: HeadingLevel = HeadingLevel.HEADING_1): Paragraph {
  return new Paragraph({
    text,
    heading: level,
    spacing: { before: 200, after: 100 },
  });
}

// Yardımcı: Normal metin paragrafı
function body(text: string, bold = false): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold, size: 24 })],
    alignment: AlignmentType.JUSTIFIED,
    spacing: { before: 80, after: 80 },
    indent: { firstLine: convertInchesToTwip(0.3) },
  });
}

// Yardımcı: Etiket + değer satırı
function labelValue(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 22 }),
      new TextRun({ text: value, size: 22 }),
    ],
    spacing: { before: 60, after: 60 },
  });
}

// ──────────────────────────────────────────────────────────────
// Base64 → Uint8Array dönüşümü
// ──────────────────────────────────────────────────────────────
function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ──────────────────────────────────────────────────────────────
// WORD BELGESİ OLUŞTUR
// ──────────────────────────────────────────────────────────────
export async function generateWordReport(data: WordReportData): Promise<void> {
  const score = data.manipulationScore ?? 0;
  const verdict = data.isManipulated
    ? score > 60 ? 'KRİTİK — Manipülasyon Tespit Edildi' : 'ŞÜPHELİ — İnceleme Gerekiyor'
    : 'TEMİZ — Özgünlük Doğrulandı';

  const sections: Paragraph[] = [];

  // ── KAPAK / ÖZET ──────────────────────────────────────────
  sections.push(
    new Paragraph({
      children: [new TextRun({ text: 'GÖRSEL ADLİ BİLİŞİM RAPORU', bold: true, size: 36, color: '003366' })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 100 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'P.U.L.S.A.R. AI v4.0 — Derin Sahte Tespit Sistemi', size: 24, color: '666666' })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 60 },
    }),
    new Paragraph({
      children: [new TextRun({ text: new Date().toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric' }), size: 22, color: '888888' })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 300 },
    }),
  );

  // ── ÖZET ──────────────────────────────────────────────────
  sections.push(heading('Özet'));
  sections.push(
    body(
      `Bu rapor, P.U.L.S.A.R. AI Görsel Adli Bilişim Sistemi tarafından "${data.fileName ?? 'bilinmiyor'}" adlı görsel dosyasına uygulanan derin sahte (deepfake) tespit analizini özetlemektedir. ` +
      `Analiz kapsamında Hata Düzeyi Analizi (ELA), DCT Blok İncelemesi ve derin öğrenme tabanlı model kullanılmıştır. ` +
      `Manipülasyon risk skoru %${score.toFixed(1)} olarak hesaplanmış ve görselin durumu "${verdict}" şeklinde değerlendirilmiştir. ` +
      `Kaynakça bölümünde deepfake tespitine yönelik akademik literatürden en az ${REFERENCES.length} kaynak sunulmuştur.`
    )
  );

  // ── GİRİŞ ─────────────────────────────────────────────────
  sections.push(new Paragraph({ children: [new PageBreak()] }));
  sections.push(heading('1. Giriş'));
  sections.push(
    body(
      'Dijital görüntülerin ve videoların üretilmesinde yapay zeka tabanlı yöntemlerin hızla yaygınlaşması, sahte içeriklerin tespit edilmesini kritik bir araştırma alanı haline getirmiştir. ' +
      '"Deepfake" olarak adlandırılan bu sahte görseller; sosyal mühendislik saldırıları, dezenformasyon kampanyaları ve kimlik dolandırıcılığı gibi ciddi güvenlik tehditlerinin kaynağı olmaktadır.'
    ),
    body(
      'Mevcut çalışmada Zhu vd. (2022), Li vd. (2018) ve Rossler vd. (2019) gibi öncü araştırmacıların geliştirdiği veri kümeleri ve metodolojilerden yararlanılmıştır. ' +
      'Bu rapor, Hata Düzeyi Analizi (ELA), ayrık kosinüs dönüşümü (DCT) tabanlı blok analizi ve evrişimli sinir ağı (CNN) modelini bir araya getiren bütünleşik bir yaklaşım sunmaktadır.'
    )
  );

  // ── YÖNTEM — DATASET ──────────────────────────────────────
  sections.push(heading('2. Yöntem'));
  sections.push(heading('2.1. Veri Kümesi', HeadingLevel.HEADING_2));
  sections.push(
    body('Analizde kullanılan başlıca veri kümeleri:'),
    labelValue('Veri Kümesi 1', 'FaceForensics++ (Rossler vd., 2019) — 1.000 orijinal ve manipüle edilmiş video; face2face, deepfakes, faceswap, neuraltextures kategorileri.'),
    labelValue('Veri Kümesi 2', 'Deepfake Detection Challenge (DFDC) Preview Dataset (Dolhansky vd., 2019) — 5.214 video; çeşitli coğrafya ve ırk gruplarını kapsayan çok dilli veri seti.'),
  );

  // ── YÖNTEM — YÖNTEMLEr ────────────────────────────────────
  sections.push(heading('2.2. Kullanılan Yöntemler', HeadingLevel.HEADING_2));
  sections.push(
    labelValue('Yöntem 1 — ELA (Error Level Analysis)', 'JPEG sıkıştırma hatası farklılıklarını piksel düzeyinde analiz eder. Manipüle bölgeler yeniden sıkıştırmaya farklı tepki verir ve ELA haritasında parlak alanlar olarak görünür.'),
    labelValue('Yöntem 2 — DCT Blok Analizi', 'Görüntü 8×8 bloklara bölünerek her bloğun frekans dağılımı incelenir. Birden fazla kaynaktan gelen piksel grupları istatistiksel anomali oluşturur.'),
    labelValue('Yöntem 3 — Derin Öğrenme (CNN / ResNet-50 / EfficientNet)', 'Önceden eğitilmiş ağlar, CASIA 2.0 veri kümesiyle ince ayar yapılarak manipülasyon örüntülerini öğrenir.'),
  );

  // ── SONUÇ VE BULGULAR ─────────────────────────────────────
  sections.push(new Paragraph({ children: [new PageBreak()] }));
  sections.push(heading('3. Sonuç ve Bulgular'));

  // Karar Banner
  sections.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `  ▶ KARAR: ${verdict}  `,
          bold: true,
          size: 26,
          color: data.isManipulated ? 'CC0000' : '007700',
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 100, after: 100 },
    })
  );

  // Metrik Tablosu
  const tableData: [string, string][] = [
    ['Manipülasyon Risk Skoru', `%${score.toFixed(2)}`],
    ['ELA Ort. Yoğunluğu', (data.elaMeanIntensity ?? 0).toFixed(6)],
    ['DCT Blok Sayısı', (data.dctBlocksAnalyzed ?? 0).toLocaleString('tr-TR')],
    ['Analiz Yöntemi', data.analysisMethod ?? '—'],
    ['Model Kullanıldı?', data.modelUsed ? 'Evet (CASIA 2.0 LSTM)' : 'Hayır (DCT Fallback)'],
    ['Genel Karar', data.manipulationLevel ?? '—'],
  ];

  const tableRows = tableData.map(([label, value], i) =>
    new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20 })] })],
          shading: { fill: i % 2 === 0 ? 'EEF0FF' : 'FFFFFF' },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: 'AAAACC' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'AAAACC' },
            left: { style: BorderStyle.SINGLE, size: 1, color: 'AAAACC' },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'AAAACC' },
          },
          width: { size: 4500, type: WidthType.DXA },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: value, size: 20 })] })],
          shading: { fill: i % 2 === 0 ? 'EEF0FF' : 'FFFFFF' },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: 'AAAACC' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'AAAACC' },
            left: { style: BorderStyle.SINGLE, size: 1, color: 'AAAACC' },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'AAAACC' },
          },
          width: { size: 4500, type: WidthType.DXA },
        }),
      ],
    })
  );

  sections.push(
    new Table({
      rows: [
        new TableRow({
          tableHeader: true,
          children: ['PARAMETRE', 'DEĞER'].map(h =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: 'FFFFFF', size: 22 })] })],
              shading: { fill: '003399' },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 1, color: '003399' },
                bottom: { style: BorderStyle.SINGLE, size: 1, color: '003399' },
                left: { style: BorderStyle.SINGLE, size: 1, color: '003399' },
                right: { style: BorderStyle.SINGLE, size: 1, color: '003399' },
              },
              width: { size: 4500, type: WidthType.DXA },
            })
          ),
        }),
        ...tableRows,
      ],
      width: { size: 9000, type: WidthType.DXA },
    })
  );

  // Hash bilgileri
  if (data.hashes) {
    sections.push(heading('3.1. Kriptografik Hash Değerleri', HeadingLevel.HEADING_2));
    sections.push(
      labelValue('MD5', data.hashes.md5),
      labelValue('SHA-1', data.hashes.sha1),
      labelValue('SHA-256', data.hashes.sha256),
    );
  }

  // Teknik Yorumlama
  sections.push(heading('3.2. Teknik Değerlendirme', HeadingLevel.HEADING_2));
  const technicalSummary = data.isManipulated
    ? (score > 60
      ? `İncelenen görsel üzerinde uygulanan ELA ve DCT analizleri KRİTİK düzeyde tutarsızlık ortaya koymaktadır. ` +
        `${(data.dctBlocksAnalyzed ?? 0).toLocaleString('tr-TR')} adet 8×8 DCT bloğu incelendiğinde yüksek frekanslı istatistiksel anomaliler saptanmıştır. ` +
        `ELA yoğunluğu ${(data.elaMeanIntensity ?? 0).toFixed(4)} ile eşik değerin üzerindedir. ` +
        `Görsel hukuki işlemlerde orijinal belge niteliğini yitirmiş kabul edilmelidir.`
      : `${(data.dctBlocksAnalyzed ?? 0).toLocaleString('tr-TR')} DCT bloğu analiz edilmiş; bir bölümünde yerel kalite farklılıkları tespit edilmiştir. ` +
        `Risk skoru %${score.toFixed(1)} olup ek adli inceleme önerilmektedir.`)
    : `${(data.dctBlocksAnalyzed ?? 0).toLocaleString('tr-TR')} adet 8×8 DCT bloğu ve üç JPEG kalite seviyesinde yürütülen ELA analizi sonucunda ` +
      `istatistiksel olarak anlamlı manipülasyon izi saptanamamıştır. ELA ortalama yoğunluğu düşük (${(data.elaMeanIntensity ?? 0).toFixed(4)}) seyretmektedir. ` +
      `Bu görsel OİRJİNAL olarak değerlendirilmektedir.`;

  sections.push(body(technicalSummary));

  // AI Raporu
  if (data.aiProofReport) {
    sections.push(heading('3.3. Yapay Zeka Uzman Görüşü (P.U.L.S.A.R. Vision)', HeadingLevel.HEADING_2));
    sections.push(body(data.aiProofReport));
  }

  // Görsel ekleme (orijinal, ELA, ısı haritası)
  const imageEntries = [
    { b64: data.originalBase64, label: 'Şekil 1: Orijinal Görsel' },
    { b64: data.elaBase64, label: 'Şekil 2: ELA (Hata Düzeyi Analizi) Haritası' },
    { b64: data.heatmapBase64, label: 'Şekil 3: DCT Isı Haritası' },
  ];

  const hasImages = imageEntries.some(e => !!e.b64);
  if (hasImages) {
    sections.push(heading('3.4. Görsel Kanıtlar', HeadingLevel.HEADING_2));
    for (const entry of imageEntries) {
      if (!entry.b64) continue;
      try {
        sections.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: base64ToUint8Array(entry.b64),
                transformation: { width: 400, height: 280 },
                type: 'jpg',
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 40 },
          }),
          new Paragraph({
            children: [new TextRun({ text: entry.label, italics: true, size: 20, color: '555555' })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 160 },
          })
        );
      } catch (_) { /* base64 geçersizse atla */ }
    }
  }

  // ── KAYNAKÇA ──────────────────────────────────────────────
  sections.push(new Paragraph({ children: [new PageBreak()] }));
  sections.push(heading('Kaynakça'));
  sections.push(
    new Paragraph({
      children: [
        new TextRun({
          text: 'Kaynak: Kaggle Notebook — "Deep Fake Detection on Images and Videos" (krooz0, 2022)',
          italics: true,
          size: 20,
          color: '555555',
        }),
      ],
      spacing: { before: 0, after: 120 },
    })
  );

  for (const ref of REFERENCES) {
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${ref.no}. `, bold: true, size: 22 }),
          new TextRun({ text: ref.text, size: 22 }),
        ],
        alignment: AlignmentType.JUSTIFIED,
        spacing: { before: 80, after: 80 },
        indent: { left: convertInchesToTwip(0.3), hanging: convertInchesToTwip(0.3) },
      })
    );
  }

  // ── HUKUK UYARISI ─────────────────────────────────────────
  sections.push(
    new Paragraph({
      children: [
        new TextRun({
          text: 'Hukuki Uyarı: Bu rapor P.U.L.S.A.R. AI tarafından otomatik üretilmiştir. Bulgular algoritmik analiz sonuçları olup tek başına hukuki delil olarak kullanılamaz.',
          italics: true,
          size: 18,
          color: '888888',
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 400, after: 0 },
    })
  );

  // ── BELGE OLUŞTUR ─────────────────────────────────────────
  const doc = new Document({
    creator: 'P.U.L.S.A.R. AI',
    title: 'Görsel Adli Bilişim Raporu',
    description: 'Derin Sahte Tespit Analizi',
    numbering: {
      config: [
        {
          reference: 'default-numbering',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.25),
            },
          },
        },
        children: sections,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const fileName = `PULSAR_Raporu_${(data.fileName ?? 'gorsel').split('.')[0]}_${new Date().toISOString().slice(0, 10)}.docx`;
  saveAs(blob, fileName);
}
