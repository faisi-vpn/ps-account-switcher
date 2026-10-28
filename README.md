# Portal Sekolah Account Switcher

Extension Chrome buat ganti-ganti akun testing Portal Sekolah di local dan staging. Ga perlu logout terus login lagi di web.

Simpan beberapa akun di extension. Pas namanya diklik, cookie login diganti, tab di-reload.

![Daftar akun Admin, Teacher, Student](docs/screenshots/popup-list.png)

## Kenapa ga dari halaman login

Kalau masih ada cookie, halaman login langsung ke dashboard. Di local itu `http://localhost:3000/login`. Di staging sama aja, cuma domainnya `portal-sekolah.com`. Akun lain ga bisa dimasukin dari situ.

Extension login sendiri lewat API, jadi tab yang lagi kebuka ga perlu dilogout dulu.

## Install

1. Clone repo ini
2. Buka Chrome, ketik `chrome://extensions`
3. Nyalakan **Developer mode** (pojok kanan atas)
4. Klik **Load unpacked**
5. Pilih folder hasil clone
6. Pin ikon **PS** di toolbar

Kalau kodenya berubah, tekan **Reload** di kartu extension-nya.

## Akun testing

Pakai akun testing yang biasa dipakai tim (admin, guru, siswa). Username dan password jangan ditulis di repo. Tanya ke tim kalau belum punya.

Pas nambah akun, ketik nama sekolah (minimal 3 huruf) lalu pilih dari daftar.

## Cara pakai

### 1. Buka tab yang mau diganti akunnya

- Local: login di `http://localhost:3000`, app yang ditest di `http://localhost:3001`
- Staging: buka tab di `portal-sekolah.com` (misalnya management, guru, atau student)

Tab boleh sudah login. Yang penting tab-nya lagi aktif pas akun di extension diklik.

### 2. Tambah akun

Klik ikon extension, lalu **Tambah akun**. Isi nama tampilan, sekolah, username, dan password.

Klik **Tambah akun**. Tab yang lagi kebuka tetap akun yang lama.

![Form tambah akun](docs/screenshots/popup-add.png)

Ulangi buat role lain yang mau disimpan.

### 3. Ganti akun

Klik nama akun di daftar, misalnya **Teacher**. Extension akan:

1. Login atau refresh token akun itu
2. Ganti cookie login
3. Reload tab

Tab langsung jadi sesi akun itu, tanpa isi form login.

![Tiga akun tersimpan, Admin sedang aktif](docs/screenshots/popup-list.png)

### 4. Hapus akun

Klik **✕**, lalu **Hapus**. Konfirmasinya di dalam popup, karena dialog Chrome bikin popup-nya nutup.

### 5. Logout tab

Kalau mau logout beneran, klik **Kosongkan sesi** dua kali. Cookie di tab itu dihapus, lalu tab reload.

## Tombol

| Tombol | Fungsi |
| --- | --- |
| Tambah akun | Login lewat API, simpan akun. Tab tidak diganti. |
| Simpan snapshot | Simpan cookie tab yang sedang login, tanpa password. |
| ↻ | Refresh token, atau login ulang kalau token sudah mati. |
| ✕ | Hapus akun dari daftar. |

## Refresh token

Tiap 10 menit, token akun yang tersimpan di-refresh. Pas akun diklik:

1. Token masih valid: langsung dipakai
2. Token expired: di-refresh
3. Refresh gagal: login ulang pake password yang tersimpan

## Catatan

- Password dan token disimpan di Chrome (`chrome.storage.local`), bukan di repo. Jangan install di komputer orang luar.
- Local: cookie localhost kepakai di `:3000` dan `:3001`. `localStorage` tidak, karena origin-nya beda.
- Staging: cookie dipasang ke domain `portal-sekolah.com`, jadi kepakai di subdomain-nya.
- Akun yang disimpan di local bisa diklik juga di staging, dan sebaliknya. Backend-nya sama.
- Kalau token access dan refresh dua-duanya sudah mati, klik akun itu lagi. Extension login ulang sendiri.
