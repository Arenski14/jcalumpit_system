# J. Calumpit Dental Clinic — PHP + MySQL (XAMPP)

## Folder layout
```
jcalumpit/
├── index.html            landing page (+ contact form, photo gallery)
├── login.html            sign in
├── register.html         create an account
├── appointment.html      book an appointment (+ payment balance)
├── dashboard.html        My Appointments (patient)
├── style.css             landing-page styles (+ gallery)
├── database.sql          database (import in phpMyAdmin)
├── admin/
│   ├── index.html        admin panel
│   └── admin.js          all admin sections
├── api/
│   ├── config.php        settings you can edit (top) + shared helpers
│   ├── auth.php          session, login, logout, register, forgot / change password
│   ├── appointments.php  list / request / cancel appointments, open time slots
│   ├── payments.php      my balance, online payment (PayMongo)
│   ├── contact.php       landing-page contact form
│   ├── gallery.php       photos from media/gallery/ (+ thumbnails)
│   └── admin.php         everything the admin panel needs
├── assets/
│   ├── site.js           shared: API helper, navbar sign-in/out, contact form, gallery
│   ├── auth.js / auth.css   login + register
│   ├── appointment.js    booking page
│   └── dashboard.js      My Appointments page
└── media/
    ├── logo.jpg, hero-image.png, about-pic.jpg, register-hero.jpg
    └── gallery/          drop your clinic photos here
```
(The only stylesheet for the landing page is `style.css`.) Folders `storage/records/` (private patient files) and `media/gallery/thumbs/` are created automatically when first needed.

## Setup
1. Install **XAMPP** (PHP 7.4 or newer) and start **Apache** and **MySQL**.
2. Copy the `jcalumpit` folder into `C:\xampp\htdocs\`.
3. Open **http://localhost/phpmyadmin** → **Import** → choose `database.sql` → **Go**. (It drops and recreates the tables. If you already imported the previous version, you can keep your current database: nothing changed.)
4. Open **http://localhost/jcalumpit/** — always through `http://localhost/`, never by double-clicking the .html files.
5. Sign in to the admin panel at **http://localhost/jcalumpit/admin/** and change the starter passwords (Settings → Change password):

| Role          | Username  | Password      |
|---------------|-----------|---------------|
| Administrator | `admin`   | `Admin@123`   |
| Staff         | `staff`   | `Staff@123`   |
| Dentist       | `dentist` | `Dentist@123` |

Extensions used (on by default in XAMPP): `pdo_mysql`, `fileinfo`, `curl`, `gd`.

### Upgrading from the previous zip
The folder was reorganised, so **delete the old `jcalumpit` folder first**, then copy the new one. Before deleting, keep: your photos in `media/gallery/` and, if you uploaded patient records, the `storage/` folder. Your database is untouched.

## Settings (`api/config.php`)
Database login, clinic hours and booking limits, sign-in lockout, and online payments.

## Gallery (built for ~50 photos)
Copy photos (.jpg / .jpeg / .png / .webp) into `media/gallery/` — no upload page and no database step. The landing page shows the first 8 with a **Show more** button, and a lightbox (arrow keys / swipe). Name files `01.jpg`, `02.jpg`… to control the order; `reception-area.jpg` becomes the caption "Reception area". Small thumbnails are created on first view (needs GD).

## Payment balance and online payment
There is no deposit when booking. After the clinic approves a visit and sets its fee (Admin → Billing), patients see their **payment balance** on the Book Appointment page and in My Appointments. Staff record cash/GCash/card payments in Billing.
To let patients also **pay online** (a Pay button appears), set in `api/config.php`: `PAYMENT_MODE = 'paymongo'` and `PAYMONGO_SECRET_KEY = 'sk_test_...'` (a [PayMongo](https://www.paymongo.com) test key — no real money). Checkout is hosted by PayMongo (GCash, Maya, card) and every payment is confirmed directly with PayMongo before it is recorded. For real payments use your `sk_live_...` key on an HTTPS domain. On XAMPP/Windows, if you see an SSL certificate error, put the path of a downloaded `cacert.pem` in `CURL_CA_BUNDLE`.

## Contact form and messages
Messages from the landing page are saved and shown in **Admin → Messages** (so are "Forgot password?" requests; staff reset the password from Patients). Emailed reset links need a mail server, which stock XAMPP does not have.

## Admin panel
Dashboard · Appointments · Patients · Records · Treatment · Billing · Messages · Reports · Settings · Users (administrators only). Only administrators can delete things.

## Booking rules
Mon–Fri 9 AM–6 PM, Sat 9 AM–3 PM, closed Sundays, 12 PM lunch, 1-hour slots, bookings from tomorrow up to 90 days ahead, max 3 upcoming requests per patient. Sign-in locks for 15 minutes after 5 failed attempts.

## VS Code shows red errors?
Messages like *Undefined function 'db'* come from the **Intelephense** extension, not from PHP: every file in `api/` loads `config.php`, which defines those functions, and Intelephense sometimes fails to index it. Press `Ctrl+Shift+P` → **Intelephense: Index workspace** (or **Developer: Reload Window**). If they remain, add these two lines to your User Settings (JSON): `"intelephense.diagnostics.undefinedFunctions": false`, `"intelephense.diagnostics.undefinedConstants": false`. A stray `tsconfig.json` in the folder is not part of this project — delete it.
