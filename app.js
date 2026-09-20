// Inisialisasi PDF.js Worker
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Konfigurasi Hub Server Lab Telkom (Jarak Jauh 24 Jam)
const HUB_TOPIC = 'printer-lab-telkom-server-hub-2026';
let cachedServerUrl = null;
let lastServerCheckTime = 0;

// Temukan Alamat Server Komputer Lab secara otomatis (0 delay)
async function getLiveServerUrl() {
  const now = Date.now();
  if (cachedServerUrl && (now - lastServerCheckTime < 30000)) {
    return cachedServerUrl;
  }

  // 1. Jika diakses langsung via localhost atau link Cloudflare Tunnel
  if (!window.location.hostname.includes('github.io')) {
    cachedServerUrl = window.location.origin;
    lastServerCheckTime = now;
    return cachedServerUrl;
  }

  // 2. Jika diakses via GitHub Pages, temukan tunnel aktif dari ntfy Hub
  try {
    const res = await fetch(`https://ntfy.sh/${HUB_TOPIC}/json?poll=1`);
    if (res.ok) {
      const text = await res.text();
      const lines = text.trim().split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const item = JSON.parse(lines[i]);
          let msg = item.message;
          if (typeof msg === 'string') msg = JSON.parse(msg);
          if (msg && msg.serverUrl && msg.status === 'ONLINE') {
            cachedServerUrl = msg.serverUrl;
            lastServerCheckTime = now;
            return cachedServerUrl;
          }
        } catch(e) {}
      }
    }
  } catch(e) {
    console.warn('Gagal menghubungi Hub server:', e);
  }

  return null;
}

// State Aplikasi
let selectedFile = null;
let pageCount = 0;
let copies = 1;
const PRICE_PER_PAGE = 1000;
let currentOrderId = null;
let currentTotalCost = 0;
let statusPollingInterval = null;

// Konfigurasi Admin WhatsApp & Master PIN
const ADMIN_WA = '6281536852418'; // 081536852418
const MASTER_PIN = '2423';

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
const tokenInput = document.getElementById('tokenInput');
const btnValidateToken = document.getElementById('btnValidateToken');
const tokenErrorMsg = document.getElementById('tokenErrorMsg');

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

function updateCalculation() {
  currentTotalCost = pageCount * PRICE_PER_PAGE * copies;
  formulaText.textContent = `${pageCount} hal x Rp 1.000 x ${copies} copy`;
  totalCostDisplay.textContent = formatRupiah(currentTotalCost);
}

// Proses File PDF
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

    pageCountDisplay.textContent = `${pageCount} Halaman`;
    updateCalculation();

    dropZone.classList.add('hidden');
    fileDetailPanel.classList.remove('hidden');
  } catch (err) {
    console.error('Error membaca PDF:', err);
    alert('Gagal membaca dokumen PDF. Pastikan file tidak rusak atau terkunci password.');
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

// Drag & Drop
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('border-red-600', 'bg-red-50/50');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('border-red-600', 'bg-red-50/50');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('border-red-600', 'bg-red-50/50');
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

// Rangkap (Copies)
btnMinusCopy.addEventListener('click', () => {
  if (copies > 1) { copies--; copiesInput.value = copies; updateCalculation(); }
});
btnPlusCopy.addEventListener('click', () => {
  if (copies < 50) { copies++; copiesInput.value = copies; updateCalculation(); }
});
copiesInput.addEventListener('input', () => {
  let val = parseInt(copiesInput.value) || 1;
  if (val < 1) val = 1; if (val > 50) val = 50;
  copies = val; updateCalculation();
});

// Pengecekan Status Server & Printer
async function checkPrinterStatus() {
  const serverUrl = await getLiveServerUrl();
  if (serverUrl) {
    try {
      const res = await fetch(`${serverUrl}/api/info`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        return { online: true, name: data.selectedPrinter || 'EPSON L3210 (24 Jam Online)' };
      }
    } catch(e) {}
  }
  return {
    online: false,
    reason: 'Server Lab Telkom saat ini sedang <b>OFFLINE / Mati</b>. Komputer server di lab belum dinyalakan.'
  };
}

async function updatePrinterBadge() {
  if (!printerBadge) return;
  const status = await checkPrinterStatus();
  if (status.online) {
    printerBadge.className = "flex items-center space-x-2 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full text-xs font-semibold text-emerald-700";
    printerBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span id="printerNameText">${status.name}</span>`;
  } else {
    printerBadge.className = "flex items-center space-x-2 bg-red-50 border border-red-200 px-3 py-1.5 rounded-full text-xs font-semibold text-red-700";
    printerBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500"></span><span id="printerNameText">Server Offline</span>`;
  }
}
updatePrinterBadge();
setInterval(updatePrinterBadge, 30000);

if (btnCloseOfflineModal) {
  btnCloseOfflineModal.addEventListener('click', () => printerOfflineModal.classList.add('hidden'));
}

// Polling Status Order dari Server
function pollOrderStatus(orderId, serverUrl) {
  if (statusPollingInterval) clearInterval(statusPollingInterval);
  statusPollingInterval = setInterval(async () => {
    try {
      const res = await fetch(`${serverUrl}/api/order-status/${orderId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'COMPLETED' || data.status === 'PRINTING') {
          clearInterval(statusPollingInterval);
          statusPollingInterval = null;
          qrisModal.classList.add('hidden');
          successModal.classList.remove('hidden');
          // Simpan ke riwayat lokal
          saveLocalHistory(orderId, 'VALIDASI ADMIN (PRINT OTOMATIS)');
        } else if (data.status === 'REJECTED') {
          clearInterval(statusPollingInterval);
          statusPollingInterval = null;
          qrisModal.classList.add('hidden');
          alert(`❌ PESANAN DITOLAK\n\nMaaf, pesanan Anda #${orderId} telah ditolak oleh Admin karena penumpukan antrean atau kendala lain.\nSilakan hubungi WhatsApp Admin.`);
          resetFile();
        }
      }
    } catch(e) {}
  }, 2000);
}

// Proses Pembayaran: Upload Dokumen ke Server Komputer Lab 24 Jam
btnProcessPayment.addEventListener('click', async () => {
  if (!selectedFile || pageCount <= 0) return;

  const originalBtnHtml = btnProcessPayment.innerHTML;
  btnProcessPayment.disabled = true;
  btnProcessPayment.innerHTML = `<span>Menghubungi Server Lab...</span><span class="animate-pulse">⏳</span>`;

  const serverUrl = await getLiveServerUrl();
  if (!serverUrl) {
    btnProcessPayment.disabled = false;
    btnProcessPayment.innerHTML = originalBtnHtml;
    if (printerOfflineReason) {
      printerOfflineReason.innerHTML = 'Maaf, <b>Server Komputer Lab Telkom sedang Offline</b>. Komputer server belum dinyalakan (start-kiosk.bat).';
    }
    if (printerOfflineModal) printerOfflineModal.classList.remove('hidden');
    updatePrinterBadge();
    return;
  }

  btnProcessPayment.innerHTML = `<span>Mengunggah Dokumen PDF...</span><span class="animate-pulse">⏳</span>`;

  try {
    const formData = new FormData();
    formData.append('document', selectedFile);
    formData.append('copies', copies);

    const res = await fetch(`${serverUrl}/api/upload`, {
      method: 'POST',
      body: formData
    });

    if (!res.ok) throw new Error('Upload gagal');

    const data = await res.json();
    currentOrderId = data.order.orderId;
    const total = data.order.totalCost;

    // Update Modal
    modalAmount.textContent = formatRupiah(total);
    modalOrderId.textContent = `ID ORDER: #${currentOrderId}`;

    // Link WA Admin
    const waMessage = `Halo Admin Printer Lab Telkom,\nSaya sudah transfer ${formatRupiah(total)} via QRIS untuk dokumen "${selectedFile.name}".\n\nID Pesanan: #${currentOrderId}\n\nMohon dicek bukti transfer saya dan validasi agar langsung tercetak otomatis di printer! 🙏`;
    btnWhatsAppAdmin.href = `https://wa.me/${ADMIN_WA}?text=${encodeURIComponent(waMessage)}`;

    tokenInput.value = '';
    tokenErrorMsg.classList.add('hidden');

    // Broadcast pesanan baru ke Admin secara realtime (ntfy.sh, localStorage, channel)
    const pendingOrder = {
      orderId: currentOrderId,
      fileName: selectedFile ? selectedFile.name : 'dokumen.pdf',
      pages: pageCount,
      copies: copies,
      totalCost: total,
      createdAt: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
      status: 'MENUNGGU'
    };

    try {
      let pendingList = JSON.parse(localStorage.getItem('lab_pending_orders') || '[]');
      pendingList = pendingList.filter(p => p.orderId !== currentOrderId);
      pendingList.unshift(pendingOrder);
      localStorage.setItem('lab_pending_orders', JSON.stringify(pendingList));
    } catch(e) {}

    try {
      fetch('https://ntfy.sh/printer-lab-telkom-orders-2026', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'NEW_PENDING_ORDER',
          order: pendingOrder
        })
      }).catch(() => {});
    } catch(e) {}

    // Buka Modal & mulai polling
    qrisModal.classList.remove('hidden');
    pollOrderStatus(currentOrderId, serverUrl);

  } catch(err) {
    alert('Gagal mengunggah file ke Server Lab: ' + err.message);
  }

  btnProcessPayment.disabled = false;
  btnProcessPayment.innerHTML = originalBtnHtml;
});

// Validasi Token Manual oleh Pelanggan (Jika ingin ketik PIN Master 2423)
async function validateAndProceed() {
  const entered = tokenInput.value.trim();
  if (entered === MASTER_PIN) {
    const serverUrl = await getLiveServerUrl();
    if (serverUrl && currentOrderId) {
      btnValidateToken.disabled = true;
      btnValidateToken.textContent = 'Memproses...';
      try {
        await fetch(`${serverUrl}/api/simulate-pay/${currentOrderId}`, { method: 'POST' });
        saveLocalHistory(currentOrderId, `MASTER PIN ${MASTER_PIN}`);
        qrisModal.classList.add('hidden');
        successModal.classList.remove('hidden');
      } catch(e) {
        alert('Gagal mengirim perintah cetak ke server.');
      }
      btnValidateToken.disabled = false;
      btnValidateToken.textContent = '🔓 Validasi & Cetak';
    }
  } else {
    tokenErrorMsg.classList.remove('hidden');
    tokenInput.focus();
  }
}

btnValidateToken.addEventListener('click', validateAndProceed);
tokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') validateAndProceed();
});

btnCloseModal.addEventListener('click', () => {
  qrisModal.classList.add('hidden');
  if (statusPollingInterval) {
    clearInterval(statusPollingInterval);
    statusPollingInterval = null;
  }
});

btnFinishOrder.addEventListener('click', () => {
  successModal.classList.add('hidden');
  resetFile();
});

function saveLocalHistory(orderId, tokenUsed) {
  try {
    const history = JSON.parse(localStorage.getItem('lab_telkom_history') || '[]');
    history.unshift({
      date: new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      orderId: orderId,
      fileName: selectedFile ? selectedFile.name : 'dokumen.pdf',
      pages: pageCount,
      copies: copies,
      totalCost: currentTotalCost,
      tokenUsed: tokenUsed,
      status: 'SUKSES DICETAK'
    });
    localStorage.setItem('lab_telkom_history', JSON.stringify(history));
  } catch(e) {}
}
