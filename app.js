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

function formatTLV(tag, value) {
  const len = value.length.toString().padStart(2, '0');
  return `${tag}${len}${value}`;
}

function generateDynamicQRIS(amount, merchantName = "PRINTER LAB TELKOM", orderId = "") {
  const amountStr = Math.round(amount).toString();
  const tag54 = formatTLV("54", amountStr); // Tag 54: Transaction Amount
  
  let qrisData = "";
  qrisData += formatTLV("00", "01"); // Format indicator
  qrisData += formatTLV("01", "12"); // 12 = Dynamic QR
  
  // Tag 26: Merchant Info
  const sub26_00 = formatTLV("00", "ID.CO.QRIS.WWW");
  const sub26_01 = formatTLV("01", "0000000000000001");
  const sub26_02 = formatTLV("02", "123456789012345");
  const sub26_03 = formatTLV("03", "UMI");
  qrisData += formatTLV("26", sub26_00 + sub26_01 + sub26_02 + sub26_03);

  // Tag 51: GPN Info
  const sub51_00 = formatTLV("00", "ID.OR.GPN");
  const sub51_01 = formatTLV("01", "195450000000000");
  const sub51_02 = formatTLV("02", "0123456789");
  qrisData += formatTLV("51", sub51_00 + sub51_01 + sub51_02);

  qrisData += formatTLV("52", "5999");
  qrisData += formatTLV("53", "360"); // IDR Currency
  qrisData += tag54;
  qrisData += formatTLV("58", "ID");
  qrisData += formatTLV("59", merchantName.substring(0, 25));
  qrisData += formatTLV("60", "BANDUNG");
  qrisData += formatTLV("61", "40115");

  if (orderId) {
    qrisData += formatTLV("62", formatTLV("01", orderId));
  }

  const dataForCRC = qrisData + "6304";
  const checksum = calculateCRC16(dataForCRC);
  return dataForCRC + checksum;
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
const MASTER_PIN = '2418'; // PIN Master cadangan admin

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
const qrisQrcodeDiv = document.getElementById('qrisQrcode');
const btnWhatsAppAdmin = document.getElementById('btnWhatsAppAdmin');
const tokenInput = document.getElementById('tokenInput');
const btnValidateToken = document.getElementById('btnValidateToken');
const tokenErrorMsg = document.getElementById('tokenErrorMsg');
const btnSimulatePay = document.getElementById('btnSimulatePay');

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

// Proses Pembayaran: Buat QRIS Dinamis & Link WhatsApp Aman (Tanpa Bocor Token)
btnProcessPayment.addEventListener('click', () => {
  if (!selectedFile || pageCount <= 0) return;

  currentOrderId = `PRN-${Date.now().toString().slice(-6)}`;
  // Token dihitung dengan rumus rahasia Lab Telkom
  currentOrderToken = generateOrderToken(currentOrderId);
  const total = pageCount * PRICE_PER_PAGE * copies;

  // Generate QRIS String standar EMVCo dengan Tag 54 = total
  const qrisString = generateDynamicQRIS(total, "PRINTER LAB TELKOM", currentOrderId);

  // Update Tampilan Modal
  modalAmount.textContent = formatRupiah(total);
  modalOrderId.textContent = `ID ORDER: ${currentOrderId}`;

  // Link WhatsApp Admin Aman: HANYA BERISI ID PESANAN (KODE TOKEN TIDAK DICANTUMKAN!)
  const waMessage = `Halo Admin Printer Lab Telkom,\nSaya sudah transfer ${formatRupiah(total)} untuk cetak dokumen "${selectedFile.name}" (${pageCount} hal x ${copies} copy).\n\nID Pesanan: #${currentOrderId}\n\nMohon dicek bukti transfer saya dan minta token cetaknya ya min! 🙏`;
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

  // Buka Modal QRIS
  qrisModal.classList.remove('hidden');
});

// Tutup Modal QRIS
btnCloseModal.addEventListener('click', () => {
  qrisModal.classList.add('hidden');
});

// Validasi Token dari Admin
function validateAndProceed() {
  const entered = tokenInput.value.trim();
  
  // Validasi: cocok dengan token order ini ATAU Master PIN admin
  if (entered === currentOrderToken || entered === MASTER_PIN) {
    tokenErrorMsg.classList.add('hidden');
    qrisModal.classList.add('hidden');
    successModal.classList.remove('hidden');

    // Catat transaksi sukses ke Riwayat
    saveToHistory({
      date: new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      orderId: currentOrderId,
      fileName: selectedFile ? selectedFile.name : 'dokumen.pdf',
      pages: pageCount,
      copies: copies,
      totalCost: currentTotalCost,
      tokenUsed: entered,
      status: 'SUKSES DICETAK'
    });

    // Buka jendela print dokumen ke EPSON
    if (selectedFileUrl) {
      const printWindow = window.open(selectedFileUrl, '_blank');
      if (printWindow) {
        printWindow.focus();
        setTimeout(() => {
          try { printWindow.print(); } catch (e) {}
        }, 1000);
      }
    }
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

// Tombol Uji Coba Cepat (Simulator tanpa WA)
btnSimulatePay.addEventListener('click', () => {
  tokenInput.value = currentOrderToken || MASTER_PIN;
  validateAndProceed();
});

// Tombol Selesai di Modal Sukses
btnFinishOrder.addEventListener('click', () => {
  successModal.classList.add('hidden');
  resetFile();
});
