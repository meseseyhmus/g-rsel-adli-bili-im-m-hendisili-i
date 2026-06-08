"""
PULSAR-X Backend v4.1 — Pillow + NumPy Only (opencv bağımlılığı yok)
Tüm görüntü işleme fonksiyonları Pillow ve NumPy ile yeniden yazılmıştır.
"""

import os
import io
import re
import hashlib
import base64
import math
from pathlib import Path
from collections import Counter

import numpy as np
from PIL import Image, ImageFilter, ImageChops
from PIL.ExifTags import TAGS

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="PULSAR-X Resim Kontrol API", version="4.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# ── MODEL ──────────────────────────────────────────────────────
MODEL_PATH = os.path.join(os.path.dirname(__file__), "image_forensics_rnn.h5")
try:
    import tensorflow as tf
    model = tf.keras.models.load_model(MODEL_PATH)
    print("✅ LSTM Modeli Yüklendi (CASIA 2.0).")
    HAS_MODEL = True
except Exception as e:
    model = None
    HAS_MODEL = False
    print(f"[UYARI] Model bulunamadi -> DCT Fallback devrede. ({e})")

# ═══════════════════════════════════════════════════════════════
#  YARDIMCI FONKSİYONLAR
# ═══════════════════════════════════════════════════════════════

def get_file_hashes(content: bytes) -> dict:
    return {
        "md5":    hashlib.md5(content).hexdigest(),
        "sha1":   hashlib.sha1(content).hexdigest(),
        "sha256": hashlib.sha256(content).hexdigest(),
    }

def get_exif_data(content: bytes) -> dict:
    exif_dict = {}
    try:
        img = Image.open(io.BytesIO(content))
        exif = img.getexif()
        if exif:
            for tag_id, value in exif.items():
                tag = TAGS.get(tag_id, tag_id)
                if isinstance(value, bytes):
                    continue
                exif_dict[str(tag)] = str(value)
        gps_info = exif.get_ifd(34853) if hasattr(exif, "get_ifd") else {}
        if gps_info:
            from PIL.ExifTags import GPSTAGS
            gps_dict = {}
            for tag_id, value in gps_info.items():
                tag = GPSTAGS.get(tag_id, tag_id)
                if not isinstance(value, bytes):
                    gps_dict[str(tag)] = str(value)
            exif_dict["GPSInfo"] = str(gps_dict)
    except Exception as e:
        print(f"EXIF hatası: {e}")
    return exif_dict

def pil_to_numpy_rgb(img: Image.Image) -> np.ndarray:
    """PIL → numpy uint8 RGB"""
    return np.array(img.convert("RGB"), dtype=np.uint8)

def numpy_to_base64_png(arr: np.ndarray) -> str:
    """numpy (H,W,3) uint8 → base64 PNG string"""
    img = Image.fromarray(arr.astype(np.uint8))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")

def numpy_to_base64_jpg(arr: np.ndarray, quality: int = 70) -> str:
    """numpy (H,W,3) uint8 → base64 JPEG string"""
    img = Image.fromarray(arr.astype(np.uint8))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return base64.b64encode(buf.getvalue()).decode("utf-8")

def normalize_u8(arr: np.ndarray) -> np.ndarray:
    """0-255 normalize et, uint8 döndür"""
    a_min, a_max = arr.min(), arr.max()
    if a_max - a_min == 0:
        return np.zeros_like(arr, dtype=np.uint8)
    return ((arr - a_min) / (a_max - a_min) * 255).astype(np.uint8)

def apply_colormap_hot(gray: np.ndarray) -> np.ndarray:
    """HOT benzeri colormap: 0→siyah, 128→kırmızı, 200→turuncu, 255→sarı"""
    r = np.clip(gray * 2.0, 0, 255).astype(np.uint8)
    g = np.clip((gray.astype(np.float32) - 128) * 2.0, 0, 255).astype(np.uint8)
    b = np.zeros_like(gray, dtype=np.uint8)
    return np.stack([r, g, b], axis=2)

def apply_colormap_jet(gray: np.ndarray) -> np.ndarray:
    """Jet colormap approximation"""
    t = gray.astype(np.float32) / 255.0
    r = np.clip(1.5 - np.abs(4 * t - 3), 0, 1)
    g = np.clip(1.5 - np.abs(4 * t - 2), 0, 1)
    b = np.clip(1.5 - np.abs(4 * t - 1), 0, 1)
    result = np.stack([r, g, b], axis=2)
    return (result * 255).astype(np.uint8)

def apply_colormap_parula(gray: np.ndarray) -> np.ndarray:
    """Parula-benzeri colormap (mavi→yeşil→sarı)"""
    t = gray.astype(np.float32) / 255.0
    r = np.clip(0.5 + t * 1.5 - (1 - t) * 0.5, 0, 1)
    g = np.clip(t * 0.8 + (1 - t) * 0.3, 0, 1)
    b = np.clip(1.0 - t * 1.2, 0, 1)
    return (np.stack([r, g, b], axis=2) * 255).astype(np.uint8)

def gaussian_blur_numpy(arr: np.ndarray, radius: int = 7) -> np.ndarray:
    """2D Gauss bulanıklaştırma - Pillow üzerinden"""
    if arr.ndim == 2:
        img = Image.fromarray(arr.astype(np.uint8))
        blurred = img.filter(ImageFilter.GaussianBlur(radius=radius))
        return np.array(blurred)
    else:
        channels = [gaussian_blur_numpy(arr[:, :, c], radius) for c in range(arr.shape[2])]
        return np.stack(channels, axis=2)

def resize_numpy(arr: np.ndarray, w: int, h: int) -> np.ndarray:
    """numpy array'i yeniden boyutlandır"""
    img = Image.fromarray(arr.astype(np.uint8))
    resized = img.resize((w, h), Image.LANCZOS)
    return np.array(resized)

# ═══════════════════════════════════════════════════════════════
#  ANALİZ FONKSİYONLARI
# ═══════════════════════════════════════════════════════════════

def perform_ela(pil_img: Image.Image, quality: int = 90) -> tuple:
    """Error Level Analysis — Pillow ile"""
    buf = io.BytesIO()
    rgb_img = pil_img.convert("RGB")
    rgb_img.save(buf, format="JPEG", quality=quality)
    buf.seek(0)
    compressed = Image.open(buf).convert("RGB")
    diff = ImageChops.difference(rgb_img, compressed)
    diff_np = np.array(diff, dtype=np.float32)
    gray = diff_np.mean(axis=2)
    amplified = normalize_u8(gray)
    mean_val = float(gray.mean())
    return diff_np, gray, amplified, mean_val

def multi_quality_ela(pil_img: Image.Image) -> np.ndarray:
    """Çoklu kalite ELA — max-combine"""
    combined = None
    for q in [95, 85, 75]:
        _, gray, _, _ = perform_ela(pil_img, quality=q)
        if combined is None:
            combined = gray.astype(np.float32)
        else:
            combined = np.maximum(combined, gray.astype(np.float32))
    return normalize_u8(combined) if combined is not None else np.zeros((100, 100), dtype=np.uint8)

def extract_dct_coefficients(img_np: np.ndarray, block_size: int = 8):
    """DCT katsayı çıkarımı — Y (luminance) kanalı"""
    try:
        # RGB → YCbCr
        r, g, b = img_np[:, :, 0].astype(np.float32), img_np[:, :, 1].astype(np.float32), img_np[:, :, 2].astype(np.float32)
        y = 0.299 * r + 0.587 * g + 0.114 * b
        h, w = y.shape
        y = y[:h - h % block_size, :w - w % block_size]
        h_adj, w_adj = y.shape
        rows, cols = h_adj // block_size, w_adj // block_size

        # 2D DCT hesaplama
        N = block_size
        dct_matrix = np.zeros((N, N), dtype=np.float32)
        for i in range(N):
            for j in range(N):
                if i == 0:
                    dct_matrix[i, j] = math.cos(math.pi * j / (2 * N)) / math.sqrt(N)
                else:
                    dct_matrix[i, j] = math.cos(math.pi * i * (2 * j + 1) / (2 * N)) * math.sqrt(2 / N)

        dct_blocks = []
        for i in range(0, h_adj, block_size):
            for j in range(0, w_adj, block_size):
                block = y[i:i + block_size, j:j + block_size] - 128.0
                dct_block = dct_matrix @ block @ dct_matrix.T
                dct_blocks.append(dct_block.flatten())

        return np.array(dct_blocks, dtype=np.float32), rows, cols
    except Exception as e:
        print(f"DCT hatası: {e}")
        return None, 0, 0

def dct_fallback_analysis(dct_array, rows, cols):
    """İstatistiksel DCT anomali tespiti"""
    if dct_array is None or len(dct_array) == 0:
        return np.zeros((max(rows, 1), max(cols, 1)), dtype=np.float32), 0.0

    ac_coeffs = dct_array[:, 1:]
    block_energy = np.sum(ac_coeffs ** 2, axis=1)
    block_variance = np.var(ac_coeffs, axis=1)
    high_freq_energy = np.sum(dct_array[:, 44:64] ** 2, axis=1)

    mean_e, std_e = np.mean(block_energy), np.std(block_energy)
    z_scores = np.abs((block_energy - mean_e) / std_e) if std_e > 0 else np.zeros_like(block_energy)

    def safe_norm(arr):
        mn, mx = arr.min(), arr.max()
        return (arr - mn) / (mx - mn) if mx - mn > 0 else np.zeros_like(arr)

    combined = (0.30 * safe_norm(block_energy) + 0.25 * safe_norm(block_variance) +
                0.25 * safe_norm(high_freq_energy) + 0.20 * safe_norm(z_scores))

    mean_c, std_c = combined.mean(), combined.std()
    threshold = mean_c + 2.5 * std_c if std_c > 0 else 0.99
    suspicious_ratio = np.mean(combined > threshold) * 100
    score = float(np.clip(suspicious_ratio * 15.0, 0, 95))

    return combined.reshape((rows, cols)).astype(np.float32), score

def build_heatmap(heatmap_grid, img_np, multi_ela_arr) -> np.ndarray:
    """DCT + ELA kombinasyonu → HOT colormap heatmap"""
    h, w = img_np.shape[:2]
    if heatmap_grid is None or heatmap_grid.size == 0:
        return img_np.copy()

    dct_map = resize_numpy(normalize_u8(heatmap_grid), w, h).astype(np.float32)
    dct_map = gaussian_blur_numpy(dct_map.astype(np.uint8), 7).astype(np.float32)
    d_min, d_max = dct_map.min(), dct_map.max()
    if d_max - d_min > 0:
        dct_map = (dct_map - d_min) / (d_max - d_min)

    if multi_ela_arr is not None and multi_ela_arr.ndim == 2:
        ela_map = resize_numpy(multi_ela_arr, w, h).astype(np.float32) / 255.0
        ela_map_blurred = gaussian_blur_numpy(ela_map.astype(np.uint8), 5).astype(np.float32) / 255.0
    else:
        ela_map_blurred = np.zeros((h, w), dtype=np.float32)

    combined = 0.55 * dct_map + 0.45 * ela_map_blurred
    combined = np.power(combined, 0.6)
    combined_u8 = normalize_u8(combined)

    hot = apply_colormap_hot(combined_u8)
    blended = (0.18 * img_np.astype(np.float32) + 0.82 * hot.astype(np.float32))
    return blended.astype(np.uint8)

def detect_copy_move(img_np: np.ndarray) -> tuple:
    """Basitleştirilmiş copy-move tespiti — blok hash tabanlı"""
    try:
        h, w = img_np.shape[:2]
        gray = (0.299 * img_np[:, :, 0] + 0.587 * img_np[:, :, 1] + 0.114 * img_np[:, :, 2]).astype(np.uint8)
        block_size = 16
        hashes = {}
        duplicates = []

        for i in range(0, h - block_size, block_size // 2):
            for j in range(0, w - block_size, block_size // 2):
                block = gray[i:i + block_size, j:j + block_size]
                key = block.tobytes()
                if key in hashes:
                    duplicates.append(((hashes[key][0], hashes[key][1]), (i, j)))
                else:
                    hashes[key] = (i, j)

        heatmap = np.zeros((h, w, 3), dtype=np.uint8)
        for (r1, c1), (r2, c2) in duplicates[:200]:
            heatmap[r1:r1 + block_size, c1:c1 + block_size] = [255, 0, 0]
            heatmap[r2:r2 + block_size, c2:c2 + block_size] = [255, 0, 0]

        score = min(len(duplicates) * 3.0, 95.0) if len(duplicates) > 5 else 0.0
        return heatmap, score
    except Exception as e:
        print(f"Copy-move hatası: {e}")
        return np.zeros_like(img_np), 0.0

def frequency_separation(img_np: np.ndarray, radius: int = 21):
    """Düşük / yüksek frekans ayrıştırma"""
    low = gaussian_blur_numpy(img_np, radius=radius)
    high = np.clip(img_np.astype(np.int16) - low.astype(np.int16) + 128, 0, 255).astype(np.uint8)
    return low, high

def luminance_gradient(img_np: np.ndarray) -> np.ndarray:
    """Sobel gradyan — Pillow FIND_EDGES ile"""
    gray_pil = Image.fromarray(img_np).convert("L")
    edges = gray_pil.filter(ImageFilter.FIND_EDGES)
    return normalize_u8(np.array(edges))

def median_filter_detection(img_np: np.ndarray) -> np.ndarray:
    """Medyan filtre izi tespiti"""
    pil_img = Image.fromarray(img_np)
    median = pil_img.filter(ImageFilter.MedianFilter(size=3))
    diff = np.abs(img_np.astype(np.int16) - np.array(median).astype(np.int16)).mean(axis=2)
    return normalize_u8(diff)

def jpeg_ghost_maps(img_np: np.ndarray, quality_steps=None) -> dict:
    """JPEG ghost haritaları"""
    if quality_steps is None:
        quality_steps = [60, 75, 90]
    ghost_maps = {}
    pil_img = Image.fromarray(img_np)
    for q in quality_steps:
        buf = io.BytesIO()
        pil_img.convert("RGB").save(buf, format="JPEG", quality=q)
        buf.seek(0)
        compressed = np.array(Image.open(buf).convert("RGB"))
        diff = np.abs(img_np.astype(np.int16) - compressed.astype(np.int16)).mean(axis=2).astype(np.float32)
        diff_sq = diff ** 2
        diff_norm = normalize_u8(diff_sq)
        jet = apply_colormap_jet(diff_norm)
        ghost_maps[f"quality_{q}"] = numpy_to_base64_png(jet)
    return ghost_maps

def illuminant_map(img_np: np.ndarray) -> np.ndarray:
    """Işık yönü haritası"""
    gray = (0.299 * img_np[:, :, 0] + 0.587 * img_np[:, :, 1] + 0.114 * img_np[:, :, 2]).astype(np.uint8)
    blurred = gaussian_blur_numpy(gray, radius=25)
    return apply_colormap_parula(blurred)

def model_based_analysis(dct_array, rows, cols):
    if model is None:
        return dct_fallback_analysis(dct_array, rows, cols)
    dct_data_reshaped = dct_array.reshape(len(dct_array), 64, 1)
    predictions = model.predict(dct_data_reshaped, verbose=0).flatten()
    heatmap_grid = predictions.reshape((rows, cols))
    median_pred = np.median(predictions)
    adaptive_threshold = max(0.55, min(median_pred + 0.1, 0.85))
    fake_ratio = np.mean(predictions > adaptive_threshold) * 100
    mean_prob = np.mean(predictions) * 100
    score = float(0.6 * mean_prob + 0.4 * fake_ratio)
    return heatmap_grid, score

# ═══════════════════════════════════════════════════════════════
#  API ENDPOINTLER
# ═══════════════════════════════════════════════════════════════

@app.get("/api/health")
async def health():
    return {"status": "online", "engine": "PULSAR-X v4.1 (Pillow+NumPy)", "model_loaded": HAS_MODEL, "version": "4.1.0"}


@app.post("/api/analyze/full")
async def analyze_full(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "Dosya adı eksik")
    ext = file.filename.rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "bmp", "webp"):
        raise HTTPException(400, f"Desteklenmeyen format: .{ext}")

    try:
        content = await file.read()
        file_hashes = get_file_hashes(content)
        exif_data = get_exif_data(content)

        pil_img = Image.open(io.BytesIO(content)).convert("RGB")
        img_np = pil_to_numpy_rgb(pil_img)
        h, w = img_np.shape[:2]

        # Orijinal (küçültülmüş)
        scale = min(512 / w, 512 / h)
        small_np = resize_numpy(img_np, int(w * scale), int(h * scale)) if scale < 1 else img_np
        orig_base64 = numpy_to_base64_jpg(small_np, quality=60)

        # ELA
        _, ela_gray, ela_amplified, ela_mean = perform_ela(pil_img, quality=90)
        multi_ela = multi_quality_ela(pil_img)
        ela_color = apply_colormap_jet(ela_amplified)
        ela_base64 = numpy_to_base64_png(ela_color)

        # DCT
        dct_array, rows, cols = extract_dct_coefficients(img_np)

        # Tahmin
        if HAS_MODEL and dct_array is not None and len(dct_array) > 0:
            heatmap_grid, manipulation_score = model_based_analysis(dct_array, rows, cols)
            analysis_method = "CASIA 2.0 LSTM"
        else:
            heatmap_grid, manipulation_score = dct_fallback_analysis(dct_array, rows, cols)
            analysis_method = "DCT Enerji Analizi"

        # Copy-Move
        cm_heatmap, cm_score = detect_copy_move(img_np)
        if cm_score > 0:
            cm_blended = (0.4 * img_np.astype(np.float32) + 0.6 * cm_heatmap.astype(np.float32)).astype(np.uint8)
        else:
            cm_blended = img_np.copy()
        cm_base64 = numpy_to_base64_png(cm_blended)

        # Skor
        ela_contribution = min(ela_mean / 2.55, 30)
        cm_contribution = cm_score * 0.35
        final_score = float(np.clip(manipulation_score * 0.5 + ela_contribution * 0.3 + cm_contribution, 0, 99.8))

        is_manipulated = final_score > 40
        level = "KRİTİK" if final_score > 60 else ("ŞÜPHELİ" if final_score > 30 else "TEMİZ")

        # Heatmap
        heatmap_blended = build_heatmap(heatmap_grid, img_np, multi_ela)
        heatmap_base64 = numpy_to_base64_png(heatmap_blended)

        return {
            "type": "image",
            "ela": {
                "manipulation_score": round(final_score, 2),
                "is_manipulated": is_manipulated,
                "manipulation_level": level,
                "original_base64": orig_base64,
                "ela_image_base64": ela_base64,
                "heatmap_base64": heatmap_base64,
                "cm_base64": cm_base64,
                "model_used": HAS_MODEL,
                "analysis_method": analysis_method,
                "dct_blocks_analyzed": int(rows * cols) if rows and cols else 0,
                "ela_mean_intensity": round(ela_mean, 6),
                "cm_score": round(cm_score, 2),
                "hashes": file_hashes,
                "exif_data": exif_data,
                "note": f"PULSAR-X v4.1 analiz tamamlandı. Yöntem: {analysis_method}"
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Analiz hatası: {str(e)}")


@app.post("/api/analyze/signal")
async def analyze_signal(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "Dosya adı eksik")
    try:
        content = await file.read()
        pil_img = Image.open(io.BytesIO(content)).convert("RGB")
        img_np = pil_to_numpy_rgb(pil_img)

        _, high_freq = frequency_separation(img_np)
        gradient = luminance_gradient(img_np)
        median_noise = median_filter_detection(img_np)

        gradient_rgb = np.stack([gradient, gradient, gradient], axis=2)
        median_jet = apply_colormap_jet(median_noise)

        return {
            "high_frequency_base64": numpy_to_base64_png(high_freq),
            "gradient_base64": numpy_to_base64_png(gradient_rgb),
            "median_noise_base64": numpy_to_base64_png(median_jet),
        }
    except Exception as e:
        raise HTTPException(500, f"Sinyal analizi hatası: {str(e)}")


@app.post("/api/analyze/jpeg_ghost")
async def analyze_jpeg_ghost(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "Dosya adı eksik")
    try:
        content = await file.read()
        pil_img = Image.open(io.BytesIO(content)).convert("RGB")
        img_np = pil_to_numpy_rgb(pil_img)
        ghost_maps = jpeg_ghost_maps(img_np, [60, 75, 90])
        return {"ghost_maps": ghost_maps}
    except Exception as e:
        raise HTTPException(500, f"JPEG Ghost hatası: {str(e)}")


@app.post("/api/analyze/illuminant")
async def analyze_illuminant(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "Dosya adı eksik")
    try:
        content = await file.read()
        pil_img = Image.open(io.BytesIO(content)).convert("RGB")
        img_np = pil_to_numpy_rgb(pil_img)
        ill_map = illuminant_map(img_np)
        return {"illuminant_map_base64": numpy_to_base64_png(ill_map)}
    except Exception as e:
        raise HTTPException(500, f"Illuminant hatası: {str(e)}")


@app.post("/api/analyze/bitplane")
async def analyze_bitplane(file: UploadFile = File(...), plane: int = 0):
    if not file.filename:
        raise HTTPException(400, "Dosya adı eksik")
    if not (0 <= plane <= 7):
        raise HTTPException(400, "Bit plane 0-7 arasında olmalı")
    try:
        content = await file.read()
        pil_img = Image.open(io.BytesIO(content)).convert("L")
        gray = np.array(pil_img)
        bit_plane = ((gray >> plane) & 1) * 255
        bp_rgb = np.stack([bit_plane, bit_plane, bit_plane], axis=2).astype(np.uint8)
        return {"bit_plane_base64": numpy_to_base64_png(bp_rgb), "plane": plane}
    except Exception as e:
        raise HTTPException(500, f"Bit-plane hatası: {str(e)}")


@app.post("/api/analyze/stegano")
async def analyze_stegano(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "Dosya adı eksik")
    try:
        content = await file.read()
        pil_img = Image.open(io.BytesIO(content))
        has_alpha = pil_img.mode == "RGBA"
        img_np = np.array(pil_img if has_alpha else pil_img.convert("RGB"))
        h, w = img_np.shape[:2]

        # ── steganography.js portu (alpha kanal)
        steg_js_msg, steg_js_detected = "", False
        if has_alpha:
            rgba = img_np
            flat_rgba = rgba.flatten()
            t_param, codeUnitSize, prime = 3, 16, 11
            alpha_indices = list(range(3, len(flat_rgba), 4))
            message_completed_idx = len(alpha_indices)
            for idx_a, data_idx in enumerate(alpha_indices):
                done = all(
                    flat_rgba[data_idx + j * 4] == 255
                    for j in range(16)
                    if data_idx + j * 4 < len(flat_rgba)
                )
                if done:
                    message_completed_idx = idx_a
                    break
            if message_completed_idx > 0:
                modMessage = [int(flat_rgba[alpha_indices[i]]) - (255 - prime + 1)
                              for i in range(message_completed_idx)]
                charCode, bitCount, chars = 0, 0, []
                mask = (1 << codeUnitSize) - 1
                for i, v in enumerate(modMessage):
                    charCode += v << bitCount
                    bitCount += t_param
                    if bitCount >= codeUnitSize:
                        cv = charCode & mask
                        if 0 < cv <= 0x10FFFF:
                            chars.append(chr(cv))
                        bitCount %= codeUnitSize
                        shift = t_param - bitCount
                        charCode = v >> shift if shift >= 0 else 0
                steg_js_msg = "".join(chars).strip()
                if len(steg_js_msg) >= 1:
                    printable = sum(1 for c in steg_js_msg if 32 <= ord(c) <= 126 or c in "\n\r\t")
                    steg_js_detected = len(steg_js_msg) > 0 and (printable / len(steg_js_msg)) > 0.8

        # ── zsteg portu (LSB)
        img_rgb = img_np[:, :, :3] if has_alpha else img_np
        R = img_rgb[:, :, 0].flatten()
        G = img_rgb[:, :, 1].flatten()
        B = img_rgb[:, :, 2].flatten()
        channels_lsb = {"r": R, "g": G, "b": B}

        rgb_flat = np.empty(R.size * 3, dtype=np.uint8)
        rgb_flat[0::3], rgb_flat[1::3], rgb_flat[2::3] = R, G, B
        channels_lsb["rgb"] = rgb_flat

        pattern_uni = re.compile(r'[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]{8,}')

        def extract_text(byte_data):
            best = ""
            for enc in ["utf-8", "cp1254", "latin-1"]:
                try:
                    decoded = byte_data.decode(enc, errors="ignore")
                    for m in pattern_uni.findall(decoded):
                        m = m.strip()
                        if len(m) < 8:
                            continue
                        counts = Counter(m)
                        mc_ratio = counts.most_common(1)[0][1] / len(m)
                        if len(m) > 20 and mc_ratio > 0.3:
                            continue
                        readable = sum(1 for c in m if 32 <= ord(c) <= 126 or c in "\n\r\t")
                        if readable / len(m) > 0.85 and len(m) > len(best):
                            best = m
                except Exception:
                    pass
            return best

        zsteg_results = []
        for cname, data in channels_lsb.items():
            bits_1 = (data & 1).astype(np.uint8)
            pad = (8 - len(bits_1) % 8) % 8
            if pad:
                bits_1 = np.pad(bits_1, (0, pad))
            mat = bits_1.reshape(-1, 8)
            lsb_w = np.array([1, 2, 4, 8, 16, 32, 64, 128], dtype=np.uint8)
            msb_w = np.array([128, 64, 32, 16, 8, 4, 2, 1], dtype=np.uint8)
            for vname, bdata in [(f"{cname},1bpp,lsb", mat @ lsb_w), (f"{cname},1bpp,msb", mat @ msb_w)]:
                text = extract_text(bdata.tobytes()[:30000])
                if text:
                    zsteg_results.append({"method": f"zsteg:{vname}", "text": text, "length": len(text), "score": len(text)})

        zsteg_results.sort(key=lambda x: x["score"], reverse=True)

        has_message, hidden_text, detected_method = False, "", "—"
        all_attempts = []
        if steg_js_detected:
            has_message, hidden_text = True, steg_js_msg
            detected_method = "steganography.js (Alpha, t=3, 16-bit)"
            all_attempts.append({"method": detected_method, "text_preview": steg_js_msg[:80],
                                  "length": len(steg_js_msg), "score": len(steg_js_msg), "printable_ratio": 1.0})
        if not has_message and zsteg_results:
            has_message, hidden_text, detected_method = True, zsteg_results[0]["text"], zsteg_results[0]["method"]
        for r in zsteg_results[:5]:
            all_attempts.append({"method": r["method"], "text_preview": r["text"][:80],
                                  "length": r["length"], "score": r["score"], "printable_ratio": 0.9})

        # Entropi
        def shannon_entropy(ch):
            lsb = (ch & 1).flatten()
            hist = np.bincount(lsb, minlength=2)
            total = hist.sum()
            if total == 0:
                return 0.0
            probs = hist[hist > 0] / total
            return float(-np.sum(probs * np.log2(probs)))

        er = round(shannon_entropy(img_rgb[:, :, 0]), 4)
        eg = round(shannon_entropy(img_rgb[:, :, 1]), 4)
        eb = round(shannon_entropy(img_rgb[:, :, 2]), 4)
        avg_ent = round((er + eg + eb) / 3, 4)
        stegano_score = round(avg_ent * 80, 1)
        if has_message:
            stegano_score = min(stegano_score + 25, 99.9)

        # LSB haritası
        lsb_b = ((img_rgb[:, :, 2] & 1) * 255).astype(np.uint8)
        lsb_g = ((img_rgb[:, :, 1] & 1) * 255).astype(np.uint8)
        lsb_r = ((img_rgb[:, :, 0] & 1) * 255).astype(np.uint8)
        lsb_visual = np.stack([lsb_r, lsb_g, lsb_b], axis=2)
        sc = min(512 / max(h, w), 1.0)
        if sc < 1:
            lsb_visual = resize_numpy(lsb_visual, int(w * sc), int(h * sc))

        flat_v = (img_rgb[:, :, :3] & 1).flatten()
        hist_a = np.bincount(flat_v, minlength=2)
        expected = hist_a.sum() / 2.0
        chi_sq = round(float(np.sum((hist_a - expected) ** 2 / expected)) if expected > 0 else 0.0, 4)
        zeros_a, ones_a = int((flat_v == 0).sum()), int((flat_v == 1).sum())

        return {
            "hidden_text": hidden_text if has_message else None,
            "has_hidden_message": has_message,
            "detected_method": detected_method,
            "stegano_score": stegano_score,
            "is_suspicious": chi_sq < 3.0 and avg_ent > 0.85,
            "entropy": {"r": er, "g": eg, "b": eb, "avg": avg_ent},
            "chi_square": chi_sq,
            "lsb_map_base64": numpy_to_base64_png(lsb_visual),
            "lsb_stats": {"zeros": zeros_a, "ones": ones_a,
                          "balance_pct": round(ones_a / (zeros_a + ones_a) * 100, 2) if (zeros_a + ones_a) > 0 else 0},
            "message_length": len(hidden_text),
            "all_attempts": sorted(all_attempts, key=lambda x: x["score"], reverse=True)[:5],
            "note": (f"{detected_method} ile gizli mesaj bulundu ({len(hidden_text)} karakter)"
                     if has_message else f"Gizli veri bulunamadı. Chi-sq={chi_sq:.4f}")
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Steganografi hatası: {str(e)}")


@app.post("/api/analyze/histogram")
async def analyze_histogram(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "Dosya adı eksik")
    try:
        content = await file.read()
        pil_img = Image.open(io.BytesIO(content)).convert("RGB")
        img_np = np.array(pil_img)

        def hist(arr, channel):
            counts = np.bincount(arr[:, :, channel].flatten(), minlength=256)
            return counts.tolist()

        img_hsv = np.array(pil_img.convert("HSV")) if hasattr(Image, "HSV") else img_np
        return {
            "rgb": {"r": hist(img_np, 0), "g": hist(img_np, 1), "b": hist(img_np, 2)},
            "hsv": {"h": hist(img_np, 0), "s": hist(img_np, 1), "v": hist(img_np, 2)},
        }
    except Exception as e:
        raise HTTPException(500, f"Histogram hatası: {str(e)}")
