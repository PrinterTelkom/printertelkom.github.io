// Backend Cloudflare Tunnel URL (Auto-Updated)
const SERVER_URL = 'https://zshops-peninsula-broader-neighbors.trycloudflare.com';

// Inisialisasi PDF.js Worker untuk hitung halaman di Client
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// State Aplikasi
let selectedFile = null;
let pageCount = 0;
let copies = 1;
const PRICE_PER_PAGE = 1000;
let currentOrderId = null;
let currentTotalCost = 0;
let statusPollingInterval = null;

const ADMIN_WA = '6281536852418';

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

// Status Printer Badge & Offline Modal
const printerBadge = document.getElementById('printerBadge');
const printerNameText = document.getElementById('printerNameText');
const printerOfflineModal = document.getElementById('printerOfflineModal');
const printerOfflineReason = document.getElementById('printerOfflineReason');
const btnCloseOfflineModal = document.getElementById('btnCloseOfflineModal');

// Modal Elements
const qrisModal = document.getElementById('qrisModal');
const btnCloseModal = document.getElementById('btnCloseModal');
const modalAmount = document.getElementById('modalAmount');
const modalOrderId = document.getElementById('modalOrderId');
const qrisQrcodeDiv = document.getElementById('qrisQrcode');
const btnWhatsAppAdmin = document.getElementById('btnWhatsAppAdmin');

// Success Modal
const successModal = document.getElementById('successModal');
const btnFinishOrder = document.getElementById('btnFinishOrder');

// Format Rupiah & Ukuran
function formatRupiah(amount) {
  return 'Rp ' + amount.toLocaleString('id-ID');
}
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Kalkulasi UI
function updateCalculation() {
  currentTotalCost = pageCount * PRICE_PER_PAGE * copies;
  formulaText.textContent = pageCount + ' hal x Rp 1.000 x ' + copies + ' copy';
  totalCostDisplay.textContent = formatRupiah(currentTotalCost);
}

// Proses File
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
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    pageCount = pdf.numPages;
    pageCountDisplay.textContent = pageCount + ' Halaman';
    updateCalculation();
    dropZone.classList.add('hidden');
    fileDetailPanel.classList.remove('hidden');
  } catch (err) {
    alert('Gagal membaca PDF.');
  }
}

function resetFile() {
  selectedFile = null;
  pageCount = 0;
  copies = 1;
  copiesInput.value = 1;
  fileInput.value = '';
  dropZone.classList.remove('hidden');
  fileDetailPanel.classList.add('hidden');
}

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('border-red-600', 'bg-red-50/50'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-red-600', 'bg-red-50/50'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('border-red-600', 'bg-red-50/50');
  if (e.dataTransfer.files[0]) processPdfFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => { if (e.target.files[0]) processPdfFile(e.target.files[0]); });
btnRemoveFile.addEventListener('click', resetFile);

btnMinusCopy.addEventListener('click', () => { if (copies > 1) { copies--; copiesInput.value = copies; updateCalculation(); } });
btnPlusCopy.addEventListener('click', () => { if (copies < 50) { copies++; copiesInput.value = copies; updateCalculation(); } });
copiesInput.addEventListener('input', () => {
  let val = parseInt(copiesInput.value) || 1;
  if (val < 1) val = 1; if (val > 50) val = 50;
  copies = val; updateCalculation();
});

// Cek Kesiapan Printer dari Server
async function checkPrinterStatus() {
  try {
    const res = await fetch(SERVER_URL + '/api/info');
    if (res.ok) {
      const data = await res.json();
      return { online: true, name: data.selectedPrinter || 'EPSON Ready' };
    }
  } catch(e) {}
  return { online: false, reason: 'Koneksi ke Server Lab Terputus. Pastikan server nyala.' };
}

async function updatePrinterBadge() {
  if (!printerBadge) return;
  const status = await checkPrinterStatus();
  if (status.online) {
    printerBadge.className = "flex items-center space-x-2 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full text-xs font-semibold text-emerald-700";
    printerBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span id="printerNameText">' + status.name + '</span>';
  } else {
    printerBadge.className = "flex items-center space-x-2 bg-red-50 border border-red-200 px-3 py-1.5 rounded-full text-xs font-semibold text-red-700";
    printerBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-500"></span><span id="printerNameText">Server Offline</span>';
  }
}
updatePrinterBadge();
if (btnCloseOfflineModal) btnCloseOfflineModal.addEventListener('click', () => printerOfflineModal.classList.add('hidden'));

// Polling Status Order
function pollOrderStatus(orderId) {
  if (statusPollingInterval) clearInterval(statusPollingInterval);
  statusPollingInterval = setInterval(async () => {
    try {
      const res = await fetch(SERVER_URL + '/api/order-status/' + orderId);
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'COMPLETED' || data.status === 'PRINTING') {
          clearInterval(statusPollingInterval);
          qrisModal.classList.add('hidden');
          successModal.classList.remove('hidden');
          setTimeout(() => { resetFile(); }, 2000);
        } else if (data.status === 'REJECTED') {
          clearInterval(statusPollingInterval);
          qrisModal.classList.add('hidden');
          alert('? PESANAN DITOLAK\n\nMaaf, pesanan Anda ditolak admin (kemungkinan mesin sibuk/penuh). Hubungi WhatsApp.');
          resetFile();
        }
      }
    } catch(e) {}
  }, 2000);
}

// Upload & Tampilkan QRIS
btnProcessPayment.addEventListener('click', async () => {
  if (!selectedFile || pageCount <= 0) return;

  const originalBtnHtml = btnProcessPayment.innerHTML;
  btnProcessPayment.disabled = true;
  btnProcessPayment.innerHTML = '<span>Mengunggah Dokumen...</span><span class="animate-pulse">?</span>';

  const printerStatus = await checkPrinterStatus();
  if (!printerStatus.online) {
    btnProcessPayment.disabled = false;
    btnProcessPayment.innerHTML = originalBtnHtml;
    if (printerOfflineReason) printerOfflineReason.innerHTML = printerStatus.reason;
    if (printerOfflineModal) printerOfflineModal.classList.remove('hidden');
    updatePrinterBadge();
    return;
  }

  const formData = new FormData();
  formData.append('document', selectedFile);
  formData.append('copies', copies);

  try {
    const res = await fetch(SERVER_URL + '/api/upload', {
      method: 'POST',
      body: formData
    });
    
    if (!res.ok) throw new Error('Upload gagal');
    
    const data = await res.json();
    currentOrderId = data.order.orderId;
    
    modalAmount.textContent = formatRupiah(data.order.totalCost);
    modalOrderId.textContent = 'ID ORDER: #' + currentOrderId;

    const waMessage = 'Halo Admin,\nSaya bayar ' + formatRupiah(data.order.totalCost) + ' (QRIS LAB UB) utk file "' + selectedFile.name + '".\n\nID Pesanan: #' + currentOrderId + '\n\nMohon validasi agar otomatis tercetak! ??';
    btnWhatsAppAdmin.href = 'https://wa.me/' + ADMIN_WA + '?text=' + encodeURIComponent(waMessage);

    qrisQrcodeDiv.innerHTML = '<img src="' + data.order.qrisImage + '" class="w-48 h-48 mx-auto">';
    
    qrisModal.classList.remove('hidden');
    pollOrderStatus(currentOrderId);

  } catch(e) {
    alert('Terjadi kesalahan saat menghubungi server. Pastikan Server Lab aktif.');
  }

  btnProcessPayment.disabled = false;
  btnProcessPayment.innerHTML = originalBtnHtml;
});

btnCloseModal.addEventListener('click', () => {
  qrisModal.classList.add('hidden');
  if (statusPollingInterval) clearInterval(statusPollingInterval);
});

btnFinishOrder.addEventListener('click', () => {
  successModal.classList.add('hidden');
  resetFile();
});
