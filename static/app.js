const state = {
  originalFile: null,
  resultDataUrl: null,
  histogramData: null,
  originalHistogramData: null,
  charts: { lum: null, r: null, g: null, b: null },
  exposure: { brightness: 0, contrast: 0, autoActive: false },
  wb: { temperature: 0, tint: 0, autoActive: false },
};

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function showSpinner() { document.getElementById('spinner-overlay').classList.remove('hidden'); }
function hideSpinner() { document.getElementById('spinner-overlay').classList.add('hidden'); }

function showError(msg) {
  const b = document.getElementById('error-banner');
  b.textContent = msg;
  b.classList.remove('hidden');
  setTimeout(() => b.classList.add('hidden'), 5000);
}

function lockControls() { document.querySelectorAll('.right-card').forEach(el => el.classList.add('locked')); }
function unlockControls() { document.querySelectorAll('.right-card').forEach(el => el.classList.remove('locked')); }

async function apiRequest(endpoint, formData, { silent = false } = {}) {
  if (!silent) showSpinner();
  try {
    const res = await fetch(endpoint, { method: 'POST', body: formData });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  } catch (err) {
    showError(err.message);
    return null;
  } finally {
    if (!silent) hideSpinner();
  }
}

const LABELS_256 = Array.from({ length: 256 }, (_, i) => i);

function destroyCharts() {
  for (const key of Object.keys(state.charts)) {
    if (state.charts[key]) { state.charts[key].destroy(); state.charts[key] = null; }
  }
}

function createMiniChart(canvasId, data, color, bgColor) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: LABELS_256,
      datasets: [{ data, borderColor: color, backgroundColor: bgColor, borderWidth: 1.2, fill: true }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { tooltip: { enabled: false }, legend: { display: false } },
      scales: { x: { display: false }, y: { display: false, beginAtZero: true } },
      elements: { point: { radius: 0 } },
    },
  });
}

function updateChartData(chart, data) {
  chart.data.datasets[0].data = data;
  chart.update('none');
}

function renderHistogram(data) {
  if (state.charts.lum) {
    updateChartData(state.charts.lum, data.luminance);
    updateChartData(state.charts.r, data.rgb.r);
    updateChartData(state.charts.g, data.rgb.g);
    updateChartData(state.charts.b, data.rgb.b);
  } else {
    state.charts.lum = createMiniChart('chart-lum', data.luminance, 'rgba(180,180,180,0.85)', 'rgba(180,180,180,0.15)');
    state.charts.r = createMiniChart('chart-r', data.rgb.r, 'rgba(220,70,70,0.85)', 'rgba(220,70,70,0.15)');
    state.charts.g = createMiniChart('chart-g', data.rgb.g, 'rgba(60,190,90,0.85)', 'rgba(60,190,90,0.15)');
    state.charts.b = createMiniChart('chart-b', data.rgb.b, 'rgba(70,130,240,0.85)', 'rgba(70,130,240,0.15)');
  }
}

async function applyAll() {
  if (!state.originalFile) return;

  const fd = new FormData();
  fd.append('image', state.originalFile);
  fd.append('operation', 'combined');
  fd.append('params', JSON.stringify({
    brightness: state.exposure.brightness,
    contrast: state.exposure.contrast,
    temperature: state.wb.temperature,
    tint: state.wb.tint,
  }));

  const data = await apiRequest('/api/process', fd, { silent: true });
  if (!data) return;

  state.resultDataUrl = data.result;
  state.histogramData = data.histogram;

  const img = document.getElementById('result-preview');
  img.src = data.result;
  img.classList.remove('hidden');

  renderHistogram(data.histogram);
}

const applyAllDebounced = debounce(applyAll, 350);

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) { showError('Пожалуйста, выберите изображение'); return; }
  state.originalFile = file;

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    document.getElementById('original-preview').src = dataUrl;
    document.getElementById('original-preview').classList.remove('hidden');
    document.getElementById('drop-zone').classList.add('hidden');
    document.getElementById('btn-clear').classList.remove('hidden');

    const resultImg = document.getElementById('result-preview');
    resultImg.src = dataUrl;
    resultImg.classList.remove('hidden');
    document.getElementById('btn-download').classList.remove('hidden');
    document.getElementById('btn-reset').classList.remove('hidden');

    state.resultDataUrl = dataUrl;
  };
  reader.readAsDataURL(file);

  const fd = new FormData();
  fd.append('image', file);
  const data = await apiRequest('/api/histogram', fd);
  if (!data) return;

  state.histogramData = data;
  state.originalHistogramData = data;
  renderHistogram(data);
  unlockControls();
  resetSliders();
}

function resetSliders() {
  state.exposure = { brightness: 0, contrast: 0, autoActive: false };
  state.wb = { temperature: 0, tint: 0, autoActive: false };

  setSlider('brightness', 0);
  setSlider('contrast', 0);
  setSlider('temperature', 0);
  setSlider('tint', 0);

  document.getElementById('btn-auto-exposure').classList.remove('active');
  document.getElementById('btn-auto-wb').classList.remove('active');
}

function setSlider(id, value) {
  document.getElementById(id).value = value;
  document.getElementById(id + '-val').textContent = value;
}

function clearImage() {
  state.originalFile = null;
  state.resultDataUrl = null;
  state.histogramData = null;
  state.originalHistogramData = null;

  document.getElementById('original-preview').classList.add('hidden');
  document.getElementById('original-preview').src = '';
  document.getElementById('result-preview').classList.add('hidden');
  document.getElementById('result-preview').src = '';
  document.getElementById('drop-zone').classList.remove('hidden');
  document.getElementById('btn-clear').classList.add('hidden');
  document.getElementById('btn-download').classList.add('hidden');
  document.getElementById('btn-reset').classList.add('hidden');
  document.getElementById('file-input').value = '';

  destroyCharts();
  resetSliders();
  lockControls();
}

function downloadResult() {
  const a = document.createElement('a');
  a.href = state.resultDataUrl;
  a.download = 'result.jpg';
  a.click();
}

async function runAutoExposure() {
  if (!state.originalFile) return;
  const fd = new FormData();
  fd.append('image', state.originalFile);
  fd.append('mode', 'exposure');
  const data = await apiRequest('/api/compute-auto', fd);
  if (!data || !data.params) return;

  state.exposure.brightness = data.params.brightness;
  state.exposure.contrast = data.params.contrast;
  state.exposure.autoActive = true;

  setSlider('brightness', data.params.brightness);
  setSlider('contrast', data.params.contrast);
  document.getElementById('btn-auto-exposure').classList.add('active');

  await applyAll();
}

async function runAutoWb() {
  if (!state.originalFile) return;
  const fd = new FormData();
  fd.append('image', state.originalFile);
  fd.append('mode', 'white_balance');
  const data = await apiRequest('/api/compute-auto', fd);
  if (!data || !data.params) return;

  state.wb.temperature = data.params.temperature;
  state.wb.tint = data.params.tint;
  state.wb.autoActive = true;

  setSlider('temperature', data.params.temperature);
  setSlider('tint', data.params.tint);
  document.getElementById('btn-auto-wb').classList.add('active');

  await applyAll();
}

function onExposureSlider() {
  state.exposure.brightness = parseInt(document.getElementById('brightness').value);
  state.exposure.contrast = parseInt(document.getElementById('contrast').value);
  if (state.exposure.autoActive) {
    state.exposure.autoActive = false;
    document.getElementById('btn-auto-exposure').classList.remove('active');
  }
  applyAllDebounced();
}

function onWbSlider() {
  state.wb.temperature = parseInt(document.getElementById('temperature').value);
  state.wb.tint = parseInt(document.getElementById('tint').value);
  if (state.wb.autoActive) {
    state.wb.autoActive = false;
    document.getElementById('btn-auto-wb').classList.remove('active');
  }
  applyAllDebounced();
}

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); handleFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

document.getElementById('btn-clear').addEventListener('click', clearImage);
document.getElementById('btn-auto-exposure').addEventListener('click', runAutoExposure);
document.getElementById('btn-auto-wb').addEventListener('click', runAutoWb);

document.getElementById('brightness').addEventListener('input', (e) => {
  document.getElementById('brightness-val').textContent = e.target.value;
  onExposureSlider();
});
document.getElementById('contrast').addEventListener('input', (e) => {
  document.getElementById('contrast-val').textContent = e.target.value;
  onExposureSlider();
});
document.getElementById('temperature').addEventListener('input', (e) => {
  document.getElementById('temperature-val').textContent = e.target.value;
  onWbSlider();
});
document.getElementById('tint').addEventListener('input', (e) => {
  document.getElementById('tint-val').textContent = e.target.value;
  onWbSlider();
});

document.getElementById('btn-reset').addEventListener('click', () => {
  resetSliders();
  applyAll();
});
document.getElementById('btn-download').addEventListener('click', downloadResult);
