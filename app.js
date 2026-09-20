// Inisialisasi PDF.js Worker
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// --- ENGINE QRIS DINAMIS STANDAR EMVCo (Client-Side) ---
function calculateCRC16(str) {
  let crc = 0xFFFF;
  for (let c = 0; c < str.length; c++) {
    crc ^= str.charCodeAt(c) << 8;
    for (let i = 0; i < 8; i++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Base QRIS Resmi: LAB. TELEKOMUNIKASI UB, EDUKASI (NMID: ID1026577429792)
const OFFICIAL_QRIS_STATIC = "00020101021126610014COM.GO-JEK.WWW01189360091433211473700210G3211473700303UMI51440014ID.CO.QRIS.WWW0215ID10265774297920303UMI5204829953033605802ID5925Lab. Telekomunikasi UB, E6006MALANG61056514562070703A0163042F55";

function generateDynamicQRIS(amount, orderId = "") {
  // Ambil base string resmi tanpa CRC tag 6304
  let base = OFFICIAL_QRIS_STATIC.substring(0, OFFICIAL_QRIS_STATIC.length - 8);
  // Ubah tipe ke dynamic (12)
  base = base.replace("010211", "010212");

  // Format nominal tag 54
  const amountStr = Math.round(amount).toString();
  const len = amountStr.length.toString().padStart(2, '0');
  const tag54 = `54${len}${amountStr}`;

  // Sisipkan tag 54 tepat sebelum tag 58 (Country Code ID)
  const idx58 = base.indexOf("5802ID");
  if (idx58 !== -1) {
    base = base.substring(0, idx58) + tag54 + base.substring(idx58);
  }

  // Hitung ulang checksum CRC16 EMVCo
  const toCrc = base + "6304";
  const checksum = calculateCRC16(toCrc);
  return toCrc + checksum;
}

// Algoritma Encode ID Pesanan 4-Digit (Mengunci jumlah halaman & copy anti-manipulasi)
const SECRET_CIPHER_KEY = 4257;
const CIPHER_MULTIPLIER = 137;

function encodeOrderId(pages, copies = 1) {
  const safeCopies = Math.min(Math.max(copies, 1), 9);
  const safePages = Math.min(Math.max(pages, 1), 999);
  const packed = safePages * 10 + safeCopies;
  const cipher = (packed * CIPHER_MULTIPLIER + SECRET_CIPHER_KEY) % 10000;
  return `PRN-${cipher.toString().padStart(4, '0')}`;
}

// Algoritma Token Deterministik Rahasia Lab Telkom
function generateOrderToken(orderId) {
  let hash = 0;
  const seed = `LABTELKOM_${orderId}_SEC2026`;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  const token = (Math.abs(hash) % 9000) + 1000;
  return token.toString();
}

// State Aplikasi
let selectedFile = null;
let selectedFileUrl = null;
let pageCount = 0;
let copies = 1;
const PRICE_PER_PAGE = 1000;
let currentOrderId = null;
let currentOrderToken = null;
let currentTotalCost = 0;
let qrcodeInstance = null;

// Konfigurasi Admin WhatsApp & Token Master
const ADMIN_WA = '6281536852418'; // 081536852418
const MASTER_PIN = '2423'; // PIN Master cadangan admin yang selalu aktif

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
const tokenInput = document.getElementById('tokenInput');
const btnValidateToken = document.getElementById('btnValidateToken');
const tokenErrorMsg = document.getElementById('tokenErrorMsg');

// Success Modal
const successModal = document.getElementById('successModal');
const btnFinishOrder = document.getElementById('btnFinishOrder');

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

// Simpan transaksi ke Riwayat Lab Telkom
function saveToHistory(orderData) {
  try {
    const history = JSON.parse(localStorage.getItem('lab_telkom_history') || '[]');
    history.unshift(orderData);
    if (history.length > 50) history.pop(); // simpan 50 riwayat terakhir
    localStorage.setItem('lab_telkom_history', JSON.stringify(history));
  } catch (e) {
    console.warn('Gagal menyimpan riwayat:', e);
  }
}

// Update Kalkulasi Harga
function updateCalculation() {
  currentTotalCost = pageCount * PRICE_PER_PAGE * copies;
  formulaText.textContent = `${pageCount} hal x Rp 1.000 x ${copies} copy`;
  totalCostDisplay.textContent = formatRupiah(currentTotalCost);
}

// Hitung Jumlah Halaman Menggunakan PDF.js langsung di Browser
async function processPdfFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
    alert('Harap pilih file berformat PDF.');
    return;
  }

  selectedFile = file;
  if (selectedFileUrl) URL.revokeObjectURL(selectedFileUrl);
  selectedFileUrl = URL.createObjectURL(file);

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
  if (selectedFileUrl) {
    URL.revokeObjectURL(selectedFileUrl);
    selectedFileUrl = null;
  }
  pageCount = 0;
  copies = 1;
  copiesInput.value = 1;
  fileInput.value = '';
  dropZone.classList.remove('hidden');
  fileDetailPanel.classList.add('hidden');
}

// Event Listeners Drag & Drop
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

// --- SISTEM PENGECEKAN STATUS PRINTER ---
async function checkPrinterStatus() {
  // 1. Cek penyimpanan lokal (jika diubah admin di perangkat/browser yang sama)
  try {
    const localStatus = localStorage.getItem('lab_printer_status');
    if (localStatus) {
      const parsed = JSON.parse(localStatus);
      if (parsed.status === 'OFFLINE') {
        return {
          online: false,
          reason: parsed.reason || 'Maaf, printer Lab Telkom saat ini sedang <b>OFFLINE / Habis Kertas</b> atau dalam pemeliharaan.'
        };
      }
    }
  } catch (e) {}

  // 2. Cek status.json dari server/GitHub Pages
  try {
    const res = await fetch('./status.json?cache=' + Date.now(), { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data.status && data.status.toUpperCase() === 'OFFLINE') {
        return {
          online: false,
          reason: data.message || 'Maaf, printer Lab Telkom saat ini sedang <b>OFFLINE / Habis Kertas</b>.'
        };
      }
    }
  } catch (err) {
    console.log('Status file check skipped:', err);
  }

  return { online: true, message: 'EPSON Ready' };
}

// Update tampilan badge printer di header
async function updatePrinterBadge() {
  if (!printerBadge) return;
  const status = await checkPrinterStatus();
  if (status.online) {
    printerBadge.className = "flex items-center space-x-2 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full text-xs font-semibold text-emerald-700";
    printerBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span id="printerNameText">EPSON Ready</span>`;
  } else {
    printerBadge.className = "flex items-center space-x-2 bg-red-50 border border-red-200 px-3 py-1.5 rounded-full text-xs font-semibold text-red-700";
    printerBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500"></span><span id="printerNameText">Printer Offline</span>`;
  }
}

// Jalankan update badge saat halaman dibuka
updatePrinterBadge();

// Tombol Tutup Modal Peringatan Offline
if (btnCloseOfflineModal) {
  btnCloseOfflineModal.addEventListener('click', () => {
    printerOfflineModal.classList.add('hidden');
  });
}

// Proses Pembayaran: Cek Kesiapan Printer -> Buat QRIS Dinamis & Link WhatsApp Aman
btnProcessPayment.addEventListener('click', async () => {
  if (!selectedFile || pageCount <= 0) return;

  // 1. CEK DAHULU APAKAH PRINTER AKTIF SEBELUM LANJUT KE PEMBAYARAN
  const originalBtnHtml = btnProcessPayment.innerHTML;
  btnProcessPayment.disabled = true;
  btnProcessPayment.innerHTML = `<span>Mengecek status printer...</span><span class="animate-pulse">⏳</span>`;

  const printerStatus = await checkPrinterStatus();
  btnProcessPayment.disabled = false;
  btnProcessPayment.innerHTML = originalBtnHtml;

  if (!printerStatus.online) {
    if (printerOfflineReason) {
      printerOfflineReason.innerHTML = printerStatus.reason;
    }
    if (printerOfflineModal) {
      printerOfflineModal.classList.remove('hidden');
    }
    updatePrinterBadge();
    return; // BLOKIR PEMBAYARAN: Tidak menampilkan QRIS jika printer offline
  }

  // 2. JIKA PRINTER AKTIF: Lanjut ke pembuatan QRIS & ID Pesanan
  currentOrderId = encodeOrderId(pageCount, copies);
  currentOrderToken = generateOrderToken(currentOrderId);
  const total = pageCount * PRICE_PER_PAGE * copies;

  // Generate QRIS String standar EMVCo resmi dengan Tag 54 = total
  const qrisString = generateDynamicQRIS(total, currentOrderId);

  // Update Tampilan Modal
  modalAmount.textContent = formatRupiah(total);
  modalOrderId.textContent = `ID ORDER: #${currentOrderId}`;

  // Link WhatsApp Admin Aman: HANYA BERISI ID PESANAN (KODE TOKEN TIDAK DICANTUMKAN!)
  const waMessage = `Halo Admin Printer Lab Telkom,\nSaya sudah transfer ${formatRupiah(total)} via QRIS (LAB. TELEKOMUNIKASI UB) untuk cetak dokumen "${selectedFile.name}".\n\nID Pesanan: #${currentOrderId}\n\nMohon dicek bukti transfer saya dan kirimkan token cetaknya ya min! 🙏`;
  btnWhatsAppAdmin.href = `https://wa.me/${ADMIN_WA}?text=${encodeURIComponent(waMessage)}`;

  // Reset form input token
  tokenInput.value = '';
  tokenErrorMsg.classList.add('hidden');

  // Bersihkan qrcode sebelumnya jika ada
  qrisQrcodeDiv.innerHTML = '';
  
  // Render Barcode QRIS menggunakan QRCode.js di Browser
  if (window.QRCode) {
    qrcodeInstance = new QRCode(qrisQrcodeDiv, {
      text: qrisString,
      width: 200,
      height: 200,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M
    });
  } else {
    qrisQrcodeDiv.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrisString)}" class="w-48 h-48 mx-auto">`;
  }

  // Buka Modal QRIS & Mulai Pantau Validasi Admin Realtime
  qrisModal.classList.remove('hidden');
  startAutoValidationWatcher();
});

// Tutup Modal QRIS
btnCloseModal.addEventListener('click', () => {
  qrisModal.classList.add('hidden');
  if (autoValidationTimer) {
    clearInterval(autoValidationTimer);
    autoValidationTimer = null;
  }
});

// --- SISTEM AUTO-VALIDASI REALTIME DARI ADMIN ---
let autoValidationTimer = null;
const syncChannel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('printer_lab_telkom_sync') : null;

// Fungsi terpusat untuk eksekusi cetak & sukses transaksi
function triggerSuccessPrint(tokenUsed = 'VALIDASI LANGSUNG ADMIN') {
  if (!currentOrderId) return;
  
  if (autoValidationTimer) {
    clearInterval(autoValidationTimer);
    autoValidationTimer = null;
  }

  tokenErrorMsg.classList.add('hidden');
  qrisModal.classList.add('hidden');
  successModal.classList.remove('hidden');

  // Catat transaksi sukses ke Riwayat Kios
  saveToHistory({
    date: new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    orderId: currentOrderId,
    fileName: selectedFile ? selectedFile.name : 'dokumen.pdf',
    pages: pageCount,
    copies: copies,
    totalCost: currentTotalCost,
    tokenUsed: tokenUsed,
    status: 'SUKSES DICETAK'
  });

  // Hapus flag validated lokal agar bersih
  try {
    localStorage.removeItem(`validated_order_${currentOrderId.toUpperCase()}`);
  } catch(e) {}

  // Buka jendela print dokumen ke EPSON secara otomatis
  if (selectedFileUrl) {
    const printWindow = window.open(selectedFileUrl, '_blank');
    if (printWindow) {
      printWindow.focus();
      setTimeout(() => {
        try { printWindow.print(); } catch (e) {}
      }, 1000);
    }
  }
}

// 1. Dengar sinyal BroadcastChannel (Instan antar-tab browser di komputer Kios yang sama)
if (syncChannel) {
  syncChannel.onmessage = (e) => {
    if (e.data && e.data.action === 'ORDER_VALIDATED') {
      if (currentOrderId && e.data.orderId && e.data.orderId.toUpperCase() === currentOrderId.toUpperCase()) {
        triggerSuccessPrint('VALIDASI 1-KLIK ADMIN');
      }
    }
  };
}

// 2. Dengar sinyal window storage event
window.addEventListener('storage', (e) => {
  if (currentOrderId && e.key === `validated_order_${currentOrderId.toUpperCase()}`) {
    triggerSuccessPrint('VALIDASI 1-KLIK ADMIN');
  }
});

// 3. Polling watcher lokal setiap 1 detik selama modal QRIS terbuka
function startAutoValidationWatcher() {
  if (autoValidationTimer) clearInterval(autoValidationTimer);
  autoValidationTimer = setInterval(() => {
    if (!currentOrderId) return;
    const validated = localStorage.getItem(`validated_order_${currentOrderId.toUpperCase()}`);
    if (validated) {
      triggerSuccessPrint('VALIDASI 1-KLIK ADMIN');
    }
  }, 1000);
}

// 4. Subscribe ke realtime Server-Sent Events (ntfy.sh) untuk notifikasi beda perangkat (HP Admin -> Kios)
try {
  const remoteSse = new EventSource('https://ntfy.sh/printer-lab-telkom-orders-2026/sse');
  remoteSse.onmessage = (e) => {
    try {
      let data = JSON.parse(e.data);
      if (typeof data.message === 'string') {
        try { data = JSON.parse(data.message); } catch(err) {}
      }
      if (data && data.action === 'ORDER_VALIDATED' && data.orderId) {
        if (currentOrderId && data.orderId.toUpperCase() === currentOrderId.toUpperCase()) {
          triggerSuccessPrint('VALIDASI 1-KLIK ADMIN');
        }
      }
    } catch(err) {}
  };
} catch(err) {}

// Validasi Token Manual dari Pelanggan (Jika pelanggan memilih ketik token sendiri)
function validateAndProceed() {
  const entered = tokenInput.value.trim();
  
  // Validasi: cocok dengan token order ini ATAU Master PIN admin yang selalu aktif
  if (entered === currentOrderToken || entered === MASTER_PIN) {
    triggerSuccessPrint(entered);
  } else {
    tokenErrorMsg.classList.remove('hidden');
    tokenInput.focus();
  }
}

btnValidateToken.addEventListener('click', validateAndProceed);

tokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    validateAndProceed();
  }
});

// Tombol Selesai di Modal Sukses
btnFinishOrder.addEventListener('click', () => {
  successModal.classList.add('hidden');
  resetFile();
});
