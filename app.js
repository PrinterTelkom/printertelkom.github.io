// Inisialisasi PDF.js Worker
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Konfigurasi API Endpoint
let API_BASE_URL = localStorage.getItem('kiosk_api_url') || '';
if (!API_BASE_URL) {
  // Jika dibuka di localhost atau IP lokal
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.port === '3000') {
    API_BASE_URL = window.location.origin;
  } else {
    // Default fallback saat dibuka di GitHub Pages
    API_BASE_URL = 'https://bookstore-considerations-underwear-traveler.trycloudflare.com';
  }
}

// State
let selectedFile = null;
let pageCount = 0;
let copies = 1;
const PRICE_PER_PAGE = 1000;
let currentOrderId = null;
let statusPollingInterval = null;

// DOM Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileDetailPanel = document.getElementById('fileDetailPanel');
const fileNameDisplay = document.getElementById('fileNameDisplay');
const fileSizeDisplay = document.getElementById('fileSizeDisplay');
const pageCountDisplay = document.getElementById('pageCountDisplay');
const copiesInput = document.getElementById('copiesInput');
const btnMinusCopy = document.getElementById('btnMinusCopy');
const btnPlusCopy = document.getElementById('btnPlusCopy');
const formulaText = document.getElementById('formulaText');
const totalCostDisplay = document.getElementById('totalCostDisplay');
const btnProcessPayment = document.getElementById('btnProcessPayment');
const btnRemoveFile = document.getElementById('btnRemoveFile');

// Modal Elements
const qrisModal = document.getElementById('qrisModal');
const btnCloseModal = document.getElementById('btnCloseModal');
const modalAmount = document.getElementById('modalAmount');
const modalOrderId = document.getElementById('modalOrderId');
const qrisImg = document.getElementById('qrisImg');
const paymentStatusBox = document.getElementById('paymentStatusBox');
const paymentStatusText = document.getElementById('paymentStatusText');
const btnSimulatePay = document.getElementById('btnSimulatePay');

// Success Modal
const successModal = document.getElementById('successModal');
const btnFinishOrder = document.getElementById('btnFinishOrder');

// Footer & Printer info
const apiEndpointInput = document.getElementById('apiEndpointInput');
const btnSaveApi = document.getElementById('btnSaveApi');
const printerNameText = document.getElementById('printerNameText');

// Format Rupiah
function formatRupiah(amount) {
  return 'Rp ' + amount.toLocaleString('id-ID');
}

// Format Ukuran File
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Update Kalkulasi Harga
function updateCalculation() {
  const totalCost = pageCount * PRICE_PER_PAGE * copies;
  formulaText.textContent = `${pageCount} hal x Rp 1.000 x ${copies} copy`;
  totalCostDisplay.textContent = formatRupiah(totalCost);
}

// Hitung Jumlah Halaman Menggunakan PDF.js langsung di Browser
async function processPdfFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
    alert('Harap pilih file berformat PDF.');
    return;
  }

  selectedFile = file;
  fileNameDisplay.textContent = file.name;
  fileSizeDisplay.textContent = formatFileSize(file.size);
  pageCountDisplay.textContent = 'Menghitung...';

  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    pageCount = pdf.numPages;

    pageCountDisplay.textContent = `${pageCount} Halaman`;
    updateCalculation();

    dropZone.classList.add('hidden');
    fileDetailPanel.classList.remove('hidden');
  } catch (err) {
    console.error('Error membaca PDF:', err);
    alert('Gagal membaca dokumen PDF. Pastikan file tidak rusak atau terkunci password.');
  }
}

// Reset File
function resetFile() {
  selectedFile = null;
  pageCount = 0;
  copies = 1;
  copiesInput.value = 1;
  fileInput.value = '';
  dropZone.classList.remove('hidden');
  fileDetailPanel.classList.add('hidden');
}

// Fetch Info Printer dari Server
async function checkServerInfo() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/info`);
    if (res.ok) {
      const data = await res.json();
      printerNameText.textContent = data.selectedPrinter || 'EPSON Ready';
    }
  } catch (e) {
    console.warn('Backend API belum terhubung atau offline:', e.message);
    printerNameText.textContent = 'EPSON Standby';
  }
}

// Event Listeners Drag & Drop
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('border-blue-600', 'bg-blue-50/50');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('border-blue-600', 'bg-blue-50/50');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('border-blue-600', 'bg-blue-50/50');
  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
    processPdfFile(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files[0]) {
    processPdfFile(e.target.files[0]);
  }
});

btnRemoveFile.addEventListener('click', resetFile);

// Tombol Copy (+ / -)
btnMinusCopy.addEventListener('click', () => {
  if (copies > 1) {
    copies--;
    copiesInput.value = copies;
    updateCalculation();
  }
});

btnPlusCopy.addEventListener('click', () => {
  if (copies < 50) {
    copies++;
    copiesInput.value = copies;
    updateCalculation();
  }
});

copiesInput.addEventListener('input', () => {
  let val = parseInt(copiesInput.value) || 1;
  if (val < 1) val = 1;
  if (val > 50) val = 50;
  copies = val;
  updateCalculation();
});

// Proses Pembayaran & Tampilkan QRIS
btnProcessPayment.addEventListener('click', async () => {
  if (!selectedFile) return;

  btnProcessPayment.disabled = true;
  btnProcessPayment.innerHTML = `
    <svg class="animate-spin h-5 w-5 text-white inline-block mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
    </svg>
    Membuat Kode QRIS...
  `;

  try {
    const formData = new FormData();
    formData.append('document', selectedFile);
    formData.append('copies', copies);

    const res = await fetch(`${API_BASE_URL}/api/upload`, {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Gagal membuat transaksi.');
    }

    const data = await res.json();
    currentOrderId = data.order.orderId;

    // Tampilkan data di Modal QRIS
    modalAmount.textContent = data.order.totalCostFormatted;
    modalOrderId.textContent = `ID ORDER: ${currentOrderId}`;
    qrisImg.src = data.order.qrisImage;

    // Reset status box modal
    paymentStatusBox.className = 'flex items-center justify-center space-x-2 py-2 px-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold';
    paymentStatusText.textContent = 'Menunggu pembayaran Anda...';

    // Buka Modal
    qrisModal.classList.remove('hidden');

    // Mulai polling cek status pembayaran
    startStatusPolling(currentOrderId);

  } catch (err) {
    console.error(err);
    alert('Terjadi kesalahan: ' + err.message + '\n\nPastikan Server Backend aktif di: ' + API_BASE_URL);
  } finally {
    btnProcessPayment.disabled = false;
    btnProcessPayment.innerHTML = `<span>Lanjut Bayar dengan QRIS</span><span>💳</span>`;
  }
});

// Polling Status Pembayaran
function startStatusPolling(orderId) {
  if (statusPollingInterval) clearInterval(statusPollingInterval);

  statusPollingInterval = setInterval(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/order-status/${orderId}`);
      if (!res.ok) return;

      const data = await res.json();
      console.log('[POLL STATUS]:', data.status);

      if (data.status === 'PAID' || data.status === 'PRINTING') {
        paymentStatusBox.className = 'flex items-center justify-center space-x-2 py-2 px-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold';
        paymentStatusText.innerHTML = `<span>⚡ Pembayaran Lunas! Sedang mencetak ke printer...</span>`;
      } else if (data.status === 'COMPLETED') {
        clearInterval(statusPollingInterval);
        qrisModal.classList.add('hidden');
        successModal.classList.remove('hidden');
      } else if (data.status === 'FAILED_TO_PRINT') {
        clearInterval(statusPollingInterval);
        alert('Pembayaran lunas, namun printer mengalami kendala saat mencetak. Silakan hubungi kasir.');
      }
    } catch (e) {
      console.warn('Gagal polling status:', e.message);
    }
  }, 2000);
}

// Tutup Modal QRIS
btnCloseModal.addEventListener('click', () => {
  if (statusPollingInterval) clearInterval(statusPollingInterval);
  qrisModal.classList.add('hidden');
});

// Tombol Simulasi Bayar Lunas (Untuk Testing Kiosk)
btnSimulatePay.addEventListener('click', async () => {
  if (!currentOrderId) return;
  try {
    btnSimulatePay.disabled = true;
    btnSimulatePay.textContent = 'Memproses konfirmasi...';

    const res = await fetch(`${API_BASE_URL}/api/simulate-pay/${currentOrderId}`, {
      method: 'POST'
    });
    const data = await res.json();
    console.log('[SIMULATE PAY RESULT]:', data);
  } catch (err) {
    alert('Gagal simulasi bayar: ' + err.message);
  } finally {
    btnSimulatePay.disabled = false;
    btnSimulatePay.textContent = '⚡ [UJI COBA] Simulasi Bayar Lunas';
  }
});

// Tombol Selesai di Modal Sukses
btnFinishOrder.addEventListener('click', () => {
  successModal.classList.add('hidden');
  resetFile();
});

// Pengaturan API Endpoint di Footer
apiEndpointInput.value = API_BASE_URL;
btnSaveApi.addEventListener('click', () => {
  const newUrl = apiEndpointInput.value.trim().replace(/\/+$/, '');
  if (newUrl) {
    API_BASE_URL = newUrl;
    localStorage.setItem('kiosk_api_url', newUrl);
    alert('Alamat API Backend berhasil disimpan: ' + newUrl);
    checkServerInfo();
  }
});

// Initial Check
checkServerInfo();
