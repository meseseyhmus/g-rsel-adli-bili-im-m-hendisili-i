// Geliştirilmiş ekran görüntüsü scripti
// hidden input'u direkt handle eder, analiz butonunu doğru yakalar

import { chromium } from 'playwright';
import { mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'docs', 'screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const BASE = 'http://localhost:5173';
const TEST_IMG = join(__dirname, 'backend', 'test.jpg');

async function shot(page, name, opts = {}) {
  await page.waitForTimeout(opts.wait || 1500);
  const p = join(OUT_DIR, name);
  if (opts.fullPage) {
    await page.screenshot({ path: p, fullPage: true });
  } else {
    await page.screenshot({ path: p, fullPage: false });
  }
  const size = Math.round(statSync(p).size / 1024);
  console.log(`  ✓ ${name} (${size} KB)`);
  return size;
}

(async () => {
  console.log('Ekran goruntusu aliniyor...\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const page = await ctx.newPage();

  // 1. Ana sayfa
  console.log('1. Ana sayfa yukleniyor...');
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000); // React render bekle
  await shot(page, '01_ana_sayfa.png');

  // 2. Dosya yükle (hidden input'a direkt)
  console.log('2. Test gorseli yukleniyor...');
  try {
    // Hidden input'u expose et ve dosyayı yükle
    await page.evaluate(() => {
      const input = document.querySelector('input[type="file"]');
      if (input) input.removeAttribute('hidden');
    });

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(TEST_IMG, { timeout: 15000 });
    await page.waitForTimeout(2000);
    await shot(page, '02_dosya_yuklendi.png');

    // 3. Analiz butonu — "ADLİ ANALİZİ BAŞLAT"
    console.log('3. Analiz baslatiliyor...');
    const btn = page.locator('button').filter({ hasText: /ADL|BAŞLAT|ANALİZ/i }).first();
    const btnCount = await btn.count();
    console.log(`   Buton bulundu: ${btnCount}`);

    if (btnCount > 0) {
      await btn.click();
      console.log('   Analiz butonu tiklandi, sonuc bekleniyor (max 120s)...');

      // Sonucu bekle — manipülasyon skoru veya karar metni
      await page.waitForFunction(() => {
        const t = document.body.innerText;
        return t.includes('%') && (
          t.includes('MANIP') || t.includes('CLEAN') ||
          t.includes('TEMIZ') || t.includes('Manipülasyon') ||
          t.includes('ŞÜPHELİ') || t.includes('KRİTİK') || t.includes('skor')
        );
      }, { timeout: 120000 });

      await page.waitForTimeout(2500);
      await shot(page, '03_analiz_sonucu.png');

      // Sayfayı aşağı kaydır
      await page.evaluate(() => window.scrollTo(0, 300));
      await shot(page, '04_detay_1.png', { wait: 1000 });

      await page.evaluate(() => window.scrollTo(0, 700));
      await shot(page, '05_detay_2.png', { wait: 1000 });

      await page.evaluate(() => window.scrollTo(0, 1200));
      await shot(page, '06_detay_3.png', { wait: 1000 });

      // Tab'lara tıkla
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(800);

      const tabMap = [
        ['SİNYAL', '07_sinyal_tab.png'],
        ['JPEG', '08_jpeg_ghost_tab.png'],
        ['BİT', '09_bit_plane_tab.png'],
        ['STEG', '10_steganografi_tab.png'],
      ];

      for (const [text, fname] of tabMap) {
        try {
          const tab = page.locator(`button, [role="tab"]`).filter({ hasText: new RegExp(text, 'i') }).first();
          if (await tab.count() > 0) {
            await tab.click();
            await shot(page, fname, { wait: 2000 });
          }
        } catch (e) {
          console.log(`  ! ${text} sekmesi atilandi: ${e.message}`);
        }
      }

    } else {
      console.log('  ! Analiz butonu bulunamadi');
    }

  } catch (e) {
    console.log(`  ! Hata: ${e.message}`);
    await shot(page, '03_fallback.png');
  }

  // Tam sayfa
  console.log('\nTam sayfa...');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
  await shot(page, '00_tam_sayfa.png', { fullPage: true });

  await browser.close();

  console.log(`\nKaydedilen gorseller: ${OUT_DIR}`);
  const files = readdirSync(OUT_DIR).filter(f => f.endsWith('.png')).sort();
  files.forEach(f => {
    const s = Math.round(statSync(join(OUT_DIR, f)).size / 1024);
    console.log(`  ${f} - ${s} KB`);
  });
})();
