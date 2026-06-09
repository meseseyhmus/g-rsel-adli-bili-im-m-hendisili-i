"""
Gerçek ekran görüntüleri — Playwright ile localhost:5173'ten çeker
"""
import asyncio
import os
import sys

# Test görseli yolu (analiz için gönderilecek)
TEST_IMAGE = os.path.join(os.path.dirname(__file__), "backend", "test.jpg")
OUT_DIR = os.path.join(os.path.dirname(__file__), "docs", "screenshots")
os.makedirs(OUT_DIR, exist_ok=True)

async def take_screenshots():
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = await browser.new_page(viewport={"width": 1400, "height": 860})

        print("1. Ana sayfa yükleniyor...")
        await page.goto("http://localhost:5173", wait_until="networkidle")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(OUT_DIR, "01_ana_sayfa.png"), full_page=False)
        print("   ✓ 01_ana_sayfa.png")

        print("2. Dosya yükleme arayüzü...")
        await page.screenshot(path=os.path.join(OUT_DIR, "02_yukleme_ekrani.png"), full_page=False)
        print("   ✓ 02_yukleme_ekrani.png")

        # Dosya yükle
        print("3. Test görseli yükleniyor ve analiz başlatılıyor...")
        try:
            # Dosya input elementini bul
            file_input = page.locator('input[type="file"]').first
            await file_input.set_input_files(TEST_IMAGE)
            await page.wait_for_timeout(1500)

            # Analiz butonuna tıkla
            analyze_btn = page.locator('button:has-text("ADLİ ANALİZİ BAŞLAT")').first
            if await analyze_btn.count() > 0:
                await analyze_btn.click()
            else:
                print("   ⚠ Başlat butonu bulunamadı!")

            print("   Analiz bekleniyor (max 60s)...")
            # Sonuç görünene kadar bekle
            await page.wait_for_selector(
                'text=UZMAN ONAYLI RAPOR',
                timeout=60000
            )
            await page.wait_for_timeout(2000)

            await page.screenshot(path=os.path.join(OUT_DIR, "03_analiz_sonucu.png"), full_page=False)
            print("   ✓ 03_analiz_sonucu.png")

            # ELA sekmesine tıkla
            try:
                ela_tab = page.locator('button:has-text("Error Level Analysis")').first
                if await ela_tab.count() > 0:
                    await ela_tab.click()
                    await page.wait_for_timeout(1000)
                    await page.screenshot(path=os.path.join(OUT_DIR, "04_view_ela.png"), full_page=False)
                    print("   ✓ 04_view_ela.png")
            except Exception as e:
                print(f"   ⚠ ELA tab screenshot hatası: {e}")

            # Heatmap sekmesine tıkla
            try:
                heatmap_tab = page.locator('button:has-text("DCT Isı Haritası")').first
                if await heatmap_tab.count() > 0:
                    await heatmap_tab.click()
                    await page.wait_for_timeout(1000)
                    await page.screenshot(path=os.path.join(OUT_DIR, "05_view_heatmap.png"), full_page=False)
                    print("   ✓ 05_view_heatmap.png")
            except Exception as e:
                print(f"   ⚠ Heatmap tab screenshot hatası: {e}")

            # Sherloq araçları ana sekmesine geçiş
            try:
                print("4. Sherloq Araçları sekmesine geçiliyor...")
                sherloq_tab = page.locator('button:has-text("Sherloq Araçları")').first
                await sherloq_tab.click()
                await page.wait_for_timeout(1000)

                # Gelişmiş Analizi Başlat butonuna tıkla
                run_btn = page.locator('button:has-text("Gelişmiş Analizi Başlat")').first
                if await run_btn.count() > 0:
                    await run_btn.click()
                    print("   Sherloq analizi bekleniyor...")
                    await page.wait_for_selector('text=Sinyal ve Gürültü Filtreleri', timeout=30000)
                    await page.wait_for_timeout(2000)

                await page.screenshot(path=os.path.join(OUT_DIR, "06_sherloq_araclari.png"), full_page=False)
                print("   ✓ 06_sherloq_araclari.png")
            except Exception as e:
                print(f"   ⚠ Sherloq screenshot hatası: {e}")

            # Yapay Zeka sekmesine geçiş
            try:
                print("5. Yapay Zeka sekmesine geçiliyor...")
                ai_tab = page.locator('button:has-text("YAPAY ZEKA")').first
                await ai_tab.click()
                await page.wait_for_timeout(2000)
                await page.screenshot(path=os.path.join(OUT_DIR, "07_pulsar_ai.png"), full_page=False)
                print("   ✓ 07_pulsar_ai.png")
            except Exception as e:
                print(f"   ⚠ AI screenshot hatası: {e}")

        except Exception as e:
            print(f"   ⚠ Analiz akışı hatası: {e}")
            # En azından mevcut sayfayı yakala
            await page.screenshot(path=os.path.join(OUT_DIR, "03_mevcut_durum.png"), full_page=False)
            print("   ✓ 03_mevcut_durum.png (fallback)")

        # Tam sayfa görüntü
        await page.evaluate("window.scrollTo(0, 0)")
        await page.wait_for_timeout(500)
        await page.screenshot(path=os.path.join(OUT_DIR, "00_tam_sayfa.png"), full_page=True)
        print("   ✓ 00_tam_sayfa.png")

        await browser.close()
        print(f"\nTüm ekran görüntüleri: {OUT_DIR}")
        
        # Dosyaları listele
        files = sorted(os.listdir(OUT_DIR))
        for f in files:
            size = os.path.getsize(os.path.join(OUT_DIR, f))
            print(f"  {f} ({size // 1024} KB)")

if __name__ == "__main__":
    asyncio.run(take_screenshots())
