const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// Inisialisasi client WhatsApp dengan penyimpanan sesi lokal
const client = new Client({
    authStrategy: new LocalAuth() // Menyimpan sesi login secara otomatis
});

let dataSpam = {}; // Objek untuk menyimpan data sementara
const JSON_SERVER_URL = 'http://localhost:5000/orders'; // URL ke JSON Server

client.on('qr', (qr) => {
    // Generate QR code untuk dipindai
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Bot siap digunakan!');
});

// Fungsi untuk menghitung rekap
async function generateRekap() {
    try {
        const response = await axios.get(JSON_SERVER_URL);
        const orders = response.data;

        const productCounts = {};
        let totalRevenue = 0;

        // Menghitung jumlah pembelian per produk dan total pendapatan
        orders.forEach(order => {
            const productName = order.product.split(' ')[0]; // Mengambil nama produk tanpa varian
            const price = parseInt(order.price.replace('k', '')) * 1000; // Mengonversi harga ke integer

            if (!productCounts[productName]) {
                productCounts[productName] = { buyers: 0, totalRevenue: 0 };
            }

            productCounts[productName].buyers += 1;
            productCounts[productName].totalRevenue += price;
            totalRevenue += price;
        });

        return { productCounts, totalRevenue, orders };

    } catch (error) {
        console.error('Gagal mengambil data dari JSON Server:', error.message);
        throw new Error('Gagal mengambil data.');
    }
}

// Fungsi untuk membuat file Excel dari data rekap
async function createExcelFile(orders) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Rekap Pesanan');

    // Menambahkan header
    worksheet.columns = [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Nama Customer', key: 'customerName', width: 30 },
        { header: 'Nomor Customer', key: 'customerNumber', width: 20 },
        { header: 'Produk', key: 'product', width: 30 },
        { header: 'Kode Produk', key: 'code', width: 10 },
        { header: 'Harga', key: 'price', width: 10 }
    ];

    // Menambahkan data ke dalam sheet
    orders.forEach(order => {
        worksheet.addRow(order);
    });

    const filePath = path.join(__dirname, 'rekap_pesanan.xlsx');
    await workbook.xlsx.writeFile(filePath);
    return filePath;
}

// Menangani pesan yang diterima
client.on('message', async (message) => {

    const msg = message.body.toLowerCase().trim(); // Menghapus spasi kosong di awal/akhir pesan
    const from = message.from;

    // Menangani pesan "rekap kinasihku"
    if (msg === 'rekap kinasih') {
        try {
            // Ambil rekap data
            const { productCounts, totalRevenue, orders } = await generateRekap();

            // Buat file Excel dan simpan
            const filePath = await createExcelFile(orders);

            // Kirim file Excel ke pengguna
            const media = MessageMedia.fromFilePath(filePath);
            await client.sendMessage(from, media);

            // Mengirim rekap jumlah pembeli per produk dan total pendapatan
            let rekapPesan = 'Rekap Kinasihku:\n';
            for (const [product, data] of Object.entries(productCounts)) {
                rekapPesan += `${product}: ${data.buyers} pembeli\n`;
            }
            rekapPesan += `Total Pendapatan: Rp${totalRevenue.toLocaleString()}k\n`;

            await message.reply(rekapPesan);

            // Hapus file setelah dikirim
            fs.unlinkSync(filePath);
            console.log('Rekap berhasil dikirim dan file Excel dihapus.');

        } catch (error) {
            console.error(error.message);
            await message.reply('Maaf, terjadi kesalahan saat menghasilkan rekap.');
        }
    } 
    // Tangani pesan biasa atau spam
    else if (msg === 'spam') {
        await message.reply('pesan apa?');
        dataSpam[from] = { step: 'pesan' };

    } else if (dataSpam[from]?.step === 'pesan') {
        dataSpam[from].pesan = message.body;
        dataSpam[from].step = 'tujuan';
        await message.reply('ke siapa ayang atau adek?');

    } else if (dataSpam[from]?.step === 'tujuan') {
        const tujuan = message.body.toLowerCase();
        if (tujuan === 'ayang') {
            dataSpam[from].tujuan = '62895378394020@c.us';
        } else if (tujuan === 'adek') {
            dataSpam[from].tujuan = '62895396334564@c.us';
        } else {
            await message.reply('Pilihan tidak valid, ketik "ayang" atau "adek".');
            return;
        }
        dataSpam[from].step = 'jumlah';
        await message.reply('berapa kali?');

    } else if (dataSpam[from]?.step === 'jumlah') {
        dataSpam[from].jumlah = parseInt(message.body, 10);
        if (isNaN(dataSpam[from].jumlah)) {
            await message.reply('Harap masukkan angka yang valid.');
            return;
        }
        dataSpam[from].step = 'kapan';
        await message.reply('jam berapa?');

    } else if (dataSpam[from]?.step === 'kapan') {
        const waktu = message.body;
        dataSpam[from].kapan = waktu;

        // Mengonversi waktu ke jam dalam milidetik
        const [jam, menit] = waktu.split(':').map(Number);
        const sekarang = new Date();
        const pengirimanWaktu = new Date();
        pengirimanWaktu.setHours(jam, menit, 0, 0);

        if (pengirimanWaktu <= sekarang) {
            // Jika waktu pengiriman sudah berlalu, setel untuk pengiriman di hari berikutnya
            pengirimanWaktu.setDate(pengirimanWaktu.getDate() + 1);
        }

        // Menghitung selisih waktu antara sekarang dan waktu pengiriman
        const selisih = pengirimanWaktu - sekarang;

        await message.reply(`Data yang akan dikirim:
Pesan: ${dataSpam[from].pesan}
Tujuan: ${dataSpam[from].tujuan === '62895378394020@c.us' ? 'ayang' : 'adek'}
Jumlah: ${dataSpam[from].jumlah}
Jam: ${dataSpam[from].kapan}`);

        // Menjadwalkan pengiriman pesan
        // Menjadwalkan pengiriman pesan dengan jeda 5 detik antara setiap pesan
setTimeout(async () => {
    for (let i = 0; i < dataSpam[from].jumlah; i++) {
        setTimeout(async () => {
            await client.sendMessage(dataSpam[from].tujuan, `${dataSpam[from].pesan}`);
        }, i * 5000); // Jeda 5 detik antara setiap pesan (5000 milidetik)
    }
    // Hapus data setelah selesai
    delete dataSpam[from];
}, selisih);


    } else {
        await message.reply(message.body);
    }
});

// Memulai client
client.initialize();
