import json
import numpy as np
import cv2
from flask import Flask, request, jsonify, send_from_directory
import base64

app = Flask(__name__, static_folder='static', static_url_path='')


def decode_image(file_storage):
    file_bytes = np.frombuffer(file_storage.read(), dtype=np.uint8)
    img = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Не удалось декодировать изображение")
    return img


def encode_image(img_bgr):
    success, buffer = cv2.imencode('.jpg', img_bgr, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not success:
        raise ValueError("Не удалось закодировать изображение")
    b64 = base64.b64encode(buffer).decode('utf-8')
    return f"data:image/jpeg;base64,{b64}"


def calc_histogram(img):
    r_hist = cv2.calcHist([img], [2], None, [256], [0, 256]).flatten().astype(int).tolist()
    g_hist = cv2.calcHist([img], [1], None, [256], [0, 256]).flatten().astype(int).tolist()
    b_hist = cv2.calcHist([img], [0], None, [256], [0, 256]).flatten().astype(int).tolist()
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    l_hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).flatten().astype(int).tolist()
    return {
        "rgb": {"r": r_hist, "g": g_hist, "b": b_hist},
        "luminance": l_hist,
    }


@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


@app.route('/api/histogram', methods=['POST'])
def histogram():
    if 'image' not in request.files:
        return jsonify({"error": "Поле 'image' не найдено"}), 400
    try:
        img = decode_image(request.files['image'])
        return jsonify(calc_histogram(img))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/compute-auto', methods=['POST'])
def compute_auto():
    if 'image' not in request.files:
        return jsonify({"error": "Поле 'image' не найдено"}), 400
    mode = request.form.get('mode', '')
    try:
        img = decode_image(request.files['image'])
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    try:
        if mode == 'exposure':
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            p_low = float(np.percentile(gray, 2))
            p_high = float(np.percentile(gray, 98))
            if p_high > p_low:
                alpha = 255.0 / (p_high - p_low)
                beta = -p_low * alpha
            else:
                alpha, beta = 1.0, 0.0
            brightness = int(np.clip(round(beta), -100, 100))
            contrast = int(np.clip(round((alpha - 1.0) * 100), -100, 100))
            return jsonify({"params": {"brightness": brightness, "contrast": contrast}})

        elif mode == 'white_balance':
            img_f = img.astype(np.float32)
            mean_total = np.mean(img_f)
            mults = []
            for i in range(3):
                ch = np.mean(img_f[:, :, i])
                mults.append(mean_total / ch if ch > 0 else 1.0)
            b_m, g_m, r_m = mults
            temperature = int(np.clip(round((r_m - b_m) * 60), -100, 100))
            tint = int(np.clip(round((1.0 - g_m) * 70), -100, 100))
            return jsonify({"params": {"temperature": temperature, "tint": tint}})

        else:
            return jsonify({"error": f"Неизвестный режим: {mode}"}), 400

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/process', methods=['POST'])
def process():
    if 'image' not in request.files:
        return jsonify({"error": "Поле 'image' не найдено"}), 400

    params_str = request.form.get('params', '{}')
    try:
        params = json.loads(params_str)
    except json.JSONDecodeError:
        return jsonify({"error": "Некорректный JSON в поле 'params'"}), 400

    try:
        img = decode_image(request.files['image'])
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    try:
        brightness = float(params.get('brightness', 0))
        contrast = float(params.get('contrast', 0))
        temperature = float(params.get('temperature', 0))
        tint = float(params.get('tint', 0))

        result = img.copy()

        alpha = 1.0 + contrast / 100.0
        beta = brightness
        if alpha != 1.0 or beta != 0.0:
            result = cv2.convertScaleAbs(result, alpha=alpha, beta=beta)

        if temperature != 0.0 or tint != 0.0:
            rf = result.astype(np.float32)
            rf[:, :, 2] = np.clip(rf[:, :, 2] + temperature * 0.8, 0, 255)
            rf[:, :, 0] = np.clip(rf[:, :, 0] - temperature * 0.8, 0, 255)
            rf[:, :, 1] = np.clip(rf[:, :, 1] - tint * 0.8, 0, 255)
            result = rf.astype(np.uint8)

    except Exception as e:
        return jsonify({"error": f"Ошибка при обработке: {str(e)}"}), 500

    try:
        result_data_url = encode_image(result)
        histogram_data = calc_histogram(result)
    except Exception as e:
        return jsonify({"error": f"Ошибка при кодировании: {str(e)}"}), 500

    return jsonify({"result": result_data_url, "histogram": histogram_data})


if __name__ == '__main__':
    app.run(debug=True)
