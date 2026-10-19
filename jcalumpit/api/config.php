<?php
// XAMPP defaults: user "root", empty password. Change if you set a MySQL password.
const DB_HOST = '127.0.0.1';
const DB_PORT = 3306;
const DB_NAME = 'jcalumpit_dental';
const DB_USER = 'root';
const DB_PASS = '';

const APP_TZ = 'Asia/Manila';

// Clinic hours (matches the landing page). Slots are 1 hour; 12:00 is lunch.
// Day numbers: 0 = Sunday ... 6 = Saturday.  [first slot hour, closing hour]
const CLINIC_HOURS = [
    1 => [9, 18], 2 => [9, 18], 3 => [9, 18], 4 => [9, 18], 5 => [9, 18],
    6 => [9, 15],
];
const LUNCH_HOUR = 12;
const MAX_ACTIVE_PER_PATIENT = 3;   // pending/approved/rescheduled upcoming visits
const BOOKING_WINDOW_DAYS = 90;
const INVOICE_DUE_DAYS = 7;          // due date shown on invoices = invoice date + this many days

// ---------------------------------------------------------------------------
// Online payment of invoice balances (patients see "Pay balance" in My Appointments)
//   'off'      -> no online payment; patients pay at the clinic   (default)
//   'paymongo' -> real GCash / Maya / card checkout hosted by PayMongo (needs your secret key)
// Use a sk_test_... key first to test safely, then your sk_live_... key to go live.
// ---------------------------------------------------------------------------
const PAYMENT_MODE = 'off';
const PAYMONGO_SECRET_KEY = '';                 // e.g. 'sk_test_xxxxxxxxxxxxxxxx'
const PAYMENT_METHODS = ['gcash', 'paymaya', 'card'];   // paymaya = Maya
const SITE_URL = '';                            // leave blank to detect automatically, e.g. 'https://yourclinic.com/jcalumpit'
const CURL_CA_BUNDLE = '';                      // XAMPP/Windows SSL fix: full path to cacert.pem if PayMongo calls fail with an SSL error

// Contact form / password-reset requests: max messages per visitor (IP) per hour
const MESSAGE_LIMIT_PER_HOUR = 5;
// Sign-in: failed attempts allowed per account+IP within 15 minutes
const LOGIN_MAX_FAILS = 5;

// ===========================================================================
// Shared helpers used by every endpoint (database, accounts, validation,
// scheduling, billing, online payments). You normally don't need to edit below.
// ===========================================================================
date_default_timezone_set(APP_TZ);

// Never print PHP warnings into the JSON reply (they still go to XAMPP's php_error_log).
ini_set('display_errors', '0');

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const STATUSES = ['pending', 'approved', 'rescheduled', 'declined', 'cancelled', 'completed'];
const ACTIVE_SQL = "('pending','approved','rescheduled')";   // statuses that hold a time slot
const BILLABLE_SQL = "('approved','rescheduled','completed')"; // statuses that can carry a fee
const BILLABLE = ['approved', 'rescheduled', 'completed'];

// Appointment columns + how much has been paid so far (used by every appointment query)
const APPT_COLS = 'a.*, u.username, (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.appointment_id = a.id) AS paid';

set_exception_handler(function ($e) {
    error_log('[jcalumpit] ' . $e);
    $msg = 'Something went wrong on the server. Please try again.';
    if ($e instanceof PDOException && in_array((int) $e->getCode(), [1049, 1045, 2002], true)) {
        $msg = 'Cannot reach the database. Start MySQL in XAMPP and import database.sql.';
    }
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $msg]);
});

/* The session is started on demand, so public endpoints (gallery thumbnails, contact form) stay fast. */
function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    ini_set('session.use_strict_mode', '1');
    ini_set('session.gc_maxlifetime', (string) (60 * 60 * 24 * 30));
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax']);
    session_start();
}

/* ---------- responses ---------- */
function json_out(array $data, int $code = 200)
{
    http_response_code($code);
    echo json_encode($data + ['ok' => $code < 400], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $message, int $code = 400, array $extra = [])
{
    json_out(['error' => $message] + $extra, $code);
}

/* Every state-changing request must be JSON. A cross-site <form> can't send that,
   so this doubles as basic CSRF protection. */
function read_json(): array
{
    $ct = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($ct, 'application/json') === false) {
        fail('Invalid request.', 415);
    }
    $raw = file_get_contents('php://input');
    $data = json_decode($raw === false ? '' : $raw, true);
    if (!is_array($data)) {
        fail('Invalid request body.');
    }
    return $data;
}

function field(array $d, string $key): string
{
    $v = $d[$key] ?? '';
    return is_scalar($v) ? trim((string) $v) : '';
}

/* ---------- database ---------- */
function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';dbname=' . DB_NAME . ';charset=utf8mb4';
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        $pdo->exec("SET time_zone = '+08:00'");
    }
    return $pdo;
}

/* ---------- users / auth ---------- */
function current_user(): ?array
{
    start_session();
    if (empty($_SESSION['uid'])) {
        return null;
    }
    $st = db()->prepare('SELECT * FROM users WHERE id = ?');
    $st->execute([$_SESSION['uid']]);
    $u = $st->fetch();
    if (!$u || (isset($u['is_active']) && !(int) $u['is_active'])) {
        unset($_SESSION['uid']);
        return null;
    }
    return $u;
}

function public_user(array $u): array
{
    $full = preg_replace('/\s+/', ' ', trim($u['first_name'] . ' ' . ($u['middle_name'] ?? '') . ' ' . $u['last_name']));
    return [
        'id'         => (int) $u['id'],
        'firstName'  => $u['first_name'],
        'middleName' => $u['middle_name'],
        'lastName'   => $u['last_name'],
        'fullName'   => $full,
        'email'      => $u['email'],
        'phone'      => $u['phone'],
        'address'    => $u['address'] ?? '',
        'username'   => $u['username'],
        'role'       => $u['role'],
    ];
}

function is_staff(array $u): bool
{
    return in_array($u['role'], ['admin', 'staff', 'dentist'], true);
}

function require_login(): array
{
    $u = current_user();
    if (!$u) {
        fail('Please sign in first.', 401, ['code' => 'auth']);
    }
    return $u;
}

function require_staff(): array
{
    $u = require_login();
    if (!is_staff($u)) {
        fail('This area is for clinic staff only.', 403);
    }
    return $u;
}

function require_admin(): array
{
    $u = require_staff();
    if ($u['role'] !== 'admin') {
        fail('Only an administrator can do that.', 403);
    }
    return $u;
}

function normalize_phone(string $p): string
{
    $p = preg_replace('/[\s\-().]/', '', $p);
    if (strpos($p, '+63') === 0) {
        $p = '0' . substr($p, 3);
    }
    return $p;
}

function valid_phone(string $normalized): bool
{
    return (bool) preg_match('/^09\d{9}$/', $normalized);
}

/* ---------- scheduling ---------- */
function valid_date(string $s): ?DateTimeImmutable
{
    $d = DateTimeImmutable::createFromFormat('!Y-m-d', $s);
    return ($d && $d->format('Y-m-d') === $s) ? $d : null;
}

/** Open start times ("HH:MM") for a calendar day; empty when the clinic is closed. */
function slot_times(DateTimeImmutable $d): array
{
    $hours = CLINIC_HOURS[(int) $d->format('w')] ?? null;
    if (!$hours) {
        return [];
    }
    $out = [];
    for ($h = $hours[0]; $h < $hours[1]; $h++) {
        if ($h === LUNCH_HOUR) {
            continue;
        }
        $out[] = sprintf('%02d:00', $h);
    }
    return $out;
}

function time_label(string $t): string
{
    return date('g:i A', strtotime($t));
}

function earliest_bookable(array $user): DateTimeImmutable
{
    $today = new DateTimeImmutable('today');
    return is_staff($user) ? $today : $today->modify('+1 day');
}

/** Times already held by an active appointment on $date. */
function taken_times(string $date, int $excludeId = 0): array
{
    $st = db()->prepare(
        "SELECT TIME_FORMAT(appt_time, '%H:%i') AS t FROM appointments
         WHERE appt_date = ? AND status IN " . ACTIVE_SQL . ' AND id <> ?'
    );
    $st->execute([$date, $excludeId]);
    return array_column($st->fetchAll(), 't');
}

/** Validates a requested date/time against clinic hours and booking limits. */
function check_slot(array $user, string $date, string $time): DateTimeImmutable
{
    $d = valid_date($date);
    if (!$d) {
        fail('Please choose a valid date.');
    }
    if ($d < earliest_bookable($user)) {
        fail(is_staff($user) ? 'That date has already passed.' : 'Appointments must be booked at least one day ahead.');
    }
    if ($d > (new DateTimeImmutable('today'))->modify('+' . BOOKING_WINDOW_DAYS . ' days')) {
        fail('We can only take bookings up to ' . BOOKING_WINDOW_DAYS . ' days ahead.');
    }
    if (!in_array($time, slot_times($d), true)) {
        fail('That time is not available. The clinic is closed on Sundays and during the 12:00 lunch hour.');
    }
    if ($d->format('Y-m-d') === date('Y-m-d') && strtotime($time) <= time()) {
        fail('That time has already passed.');
    }
    return $d;
}

function money($v): float
{
    return round((float) $v, 2);
}

/** What a patient has been billed, has paid, and still owes (approved/rescheduled/completed visits only). */
function billing_totals(int $userId): array
{
    $st = db()->prepare(
        'SELECT a.fee, (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.appointment_id = a.id) AS paid
         FROM appointments a WHERE a.user_id = ? AND a.fee > 0 AND a.status IN ' . BILLABLE_SQL
    );
    $st->execute([$userId]);
    $billed = 0.0;
    $paid = 0.0;
    foreach ($st->fetchAll() as $r) {
        $billed += (float) $r['fee'];
        $paid += min((float) $r['paid'], (float) $r['fee']);
    }
    return ['billed' => round($billed, 2), 'paid' => round($paid, 2), 'due' => round(max($billed - $paid, 0), 2)];
}

function appt_out(array $r): array
{
    $t = function ($v) {
        return $v ? substr($v, 0, 5) : null;
    };
    $fee = money($r['fee'] ?? 0);
    $paid = money($r['paid'] ?? 0);
    $billable = in_array($r['status'], BILLABLE, true);
    return [
        'id'            => (int) $r['id'],
        'userId'        => (int) $r['user_id'],
        'username'      => $r['username'] ?? null,
        'patientName'   => $r['patient_name'],
        'phone'         => $r['phone'],
        'email'         => $r['email'],
        'service'       => $r['service'],
        'dentist'       => $r['dentist'],
        'date'          => $r['appt_date'],
        'time'          => $t($r['appt_time']),
        'timeLabel'     => time_label($r['appt_time']),
        'prevDate'      => $r['prev_date'],
        'prevTimeLabel' => $r['prev_time'] ? time_label($r['prev_time']) : null,
        'notes'         => $r['notes'],
        'adminNote'     => $r['admin_note'],
        'status'        => $r['status'],
        'createdAt'     => $r['created_at'],
        'billable'      => $billable,
        'fee'           => $fee,
        'paid'          => min($paid, $fee > 0 ? $fee : $paid),
        'balance'       => $billable ? round(max($fee - $paid, 0), 2) : 0.0,
    ];
}

/* ---------- shared validation (registration, staff-created patients, staff accounts) ---------- */

/** Validates the personal-info fields. $self = true for the public registration form (adult + middle name required). */
function validate_profile(array $d, bool $self): array
{
    $who = $self ? 'your' : "the patient's";
    $nameRe = "/^\p{L}[\p{L} .'\-]*$/u";
    $out = [];
    foreach ([['firstName', 'first name', true], ['middleName', 'middle name', false], ['lastName', 'last name', true]] as [$key, $label, $required]) {
        $v = preg_replace('/\s+/', ' ', field($d, $key));
        if ($v === '') {
            if ($required) {
                fail("Please enter $who $label.");
            }
            $out[$key] = null;
            continue;
        }
        if (mb_strlen($v) > 60 || !preg_match($nameRe, $v)) {
            fail(ucfirst($who === 'your' ? 'your' : 'the') . " $label contains invalid characters.");
        }
        $out[$key] = $v;
    }

    $gender = field($d, 'gender');
    if (!in_array($gender, ['male', 'female', 'non-binary', 'prefer-not-to-say'], true)) {
        fail('Please select a gender.');
    }

    $birth = valid_date(field($d, 'birthDate'));
    if (!$birth) {
        fail('Please enter a valid birth date.');
    }
    $today = new DateTimeImmutable('today');
    if ($birth > $today) {
        fail('Birth date cannot be in the future.');
    }
    $age = $birth->diff($today)->y;
    if ($self && $age < 18) {
        fail('Minors under 18 years old are not allowed to register.');
    }
    if ($age > 120) {
        fail('Please enter a valid birth date.');
    }

    $email = strtolower(field($d, 'email'));
    if ($email === '' || strlen($email) > 150 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail('Please enter a valid email address.');
    }

    $phone = normalize_phone(field($d, 'phone'));
    if (!valid_phone($phone)) {
        fail('Use a valid PH mobile number, e.g. 09171234567.');
    }

    $address = preg_replace('/\s+/', ' ', field($d, 'address'));
    if ($address === '') {
        fail("Please enter $who address.");
    }
    if (mb_strlen($address) < 5) {
        fail('Please enter a complete address.');
    }
    if (mb_strlen($address) > 255) {
        fail('Address must be 255 characters or fewer.');
    }

    return [
        'first' => $out['firstName'], 'middle' => $out['middleName'], 'last' => $out['lastName'],
        'gender' => $gender, 'birth' => $birth->format('Y-m-d'), 'email' => $email, 'phone' => $phone, 'address' => $address,
    ];
}

function check_username(string $username): void
{
    if (!preg_match('/^[a-zA-Z0-9]+(-[a-zA-Z0-9]+)?$/', $username)) {
        fail('Username may only contain letters, numbers, or a single hyphen — no spaces.');
    }
    if (strlen($username) < 3 || strlen($username) > 30) {
        fail('Username must be 3 to 30 characters long.');
    }
}

function check_password_rules(string $password): void
{
    if (strlen($password) < 8) {
        fail('Password must be at least 8 characters.');
    }
    if (strlen($password) > 72) {
        fail('Password must be 72 characters or fewer.');
    }
    if (!preg_match('/[0-9]/', $password)) {
        fail('Password must contain at least one number.');
    }
    if (!preg_match('/[a-z]/', $password)) {
        fail('Password must contain at least one lowercase letter.');
    }
}

function assert_unique(string $username, string $email, int $exceptId = 0): void
{
    $st = db()->prepare('SELECT username, email FROM users WHERE (username = ? OR email = ?) AND id <> ?');
    $st->execute([$username, $email, $exceptId]);
    foreach ($st->fetchAll() as $row) {
        if (strcasecmp($row['username'], $username) === 0) {
            fail('That username is already taken.', 409);
        }
        fail('An account with that email already exists.', 409);
    }
}

/** A readable one-time password (letters + digits, no look-alike characters). */
function temp_password(): string
{
    $letters = 'abcdefghjkmnpqrstuvwxyz';
    $digits = '23456789';
    $chars = [];
    for ($i = 0; $i < 5; $i++) {
        $chars[] = $letters[random_int(0, strlen($letters) - 1)];
    }
    for ($i = 0; $i < 3; $i++) {
        $chars[] = $digits[random_int(0, strlen($digits) - 1)];
    }
    for ($i = count($chars) - 1; $i > 0; $i--) {
        $j = random_int(0, $i);
        $tmp = $chars[$i];
        $chars[$i] = $chars[$j];
        $chars[$j] = $tmp;
    }
    return implode('', $chars);
}

function make_username(string $first, string $last): string
{
    $base = substr(preg_replace('/[^a-z0-9]/', '', strtolower($first . $last)), 0, 20);
    if (strlen($base) < 3) {
        $base = 'patient';
    }
    $st = db()->prepare('SELECT 1 FROM users WHERE username = ?');
    for ($i = 0; $i < 1000; $i++) {
        $cand = $base . ($i ? (string) $i : '');
        $st->execute([$cand]);
        if (!$st->fetchColumn()) {
            return $cand;
        }
    }
    return $base . random_int(1000, 9999);
}

function patient_code(int $id): string
{
    return 'PT-' . str_pad((string) $id, 4, '0', STR_PAD_LEFT);
}

/* ---------- request helpers ---------- */
function client_ip(): string
{
    return substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);
}

/** e.g. http://localhost/jcalumpit  (no trailing slash). Used for payment return links. */
function app_base_url(): string
{
    if (SITE_URL !== '') {
        return rtrim(SITE_URL, '/');
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $host = preg_replace('/[^A-Za-z0-9.:\-\[\]]/', '', (string) ($_SERVER['HTTP_HOST'] ?? 'localhost'));
    $dir = rtrim(str_replace('\\', '/', dirname(dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/api/x.php')))), '/');
    return ($https ? 'https' : 'http') . '://' . $host . $dir;
}

/** Contact-form / reset-request flood protection (per IP). */
function message_rate_ok(PDO $pdo): bool
{
    $st = $pdo->prepare('SELECT COUNT(*) FROM messages WHERE ip = ? AND created_at >= (NOW() - INTERVAL 1 HOUR)');
    $st->execute([client_ip()]);
    return (int) $st->fetchColumn() < MESSAGE_LIMIT_PER_HOUR;
}

/* ---------- online payments (PayMongo) ---------- */

function pay_enabled(): bool
{
    return PAYMENT_MODE === 'paymongo' && PAYMONGO_SECRET_KEY !== '';
}

/** What a patient can still pay online for one appointment: the unpaid balance of its invoice. */
function pay_amount_due(array $a): float
{
    $fee = money($a['fee'] ?? 0);
    $paid = money($a['paid'] ?? 0);
    if (in_array($a['status'], BILLABLE, true) && $fee > 0) {
        return round(max($fee - $paid, 0), 2);
    }
    return 0.0;
}

function pay_method_for(string $providerType): string
{
    $map = ['gcash' => 'gcash', 'paymaya' => 'maya', 'maya' => 'maya', 'card' => 'card'];
    return $map[strtolower($providerType)] ?? 'other';
}

/** Calls the PayMongo REST API. Throws RuntimeException with a readable message on failure. */
function paymongo_request(string $method, string $path, ?array $body = null): array
{
    if (!function_exists('curl_init')) {
        throw new RuntimeException('PHP cURL is not enabled. Enable extension=curl in php.ini.');
    }
    $ch = curl_init('https://api.paymongo.com' . $path);
    $opts = [
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 25,
        CURLOPT_USERPWD        => PAYMONGO_SECRET_KEY . ':',
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'Accept: application/json'],
    ];
    if ($body !== null) {
        $opts[CURLOPT_POSTFIELDS] = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
    if (CURL_CA_BUNDLE !== '') {
        $opts[CURLOPT_CAINFO] = CURL_CA_BUNDLE;
    }
    curl_setopt_array($ch, $opts);
    $raw = curl_exec($ch);
    if ($raw === false) {
        $err = curl_error($ch);
        curl_close($ch);
        error_log('[jcalumpit] PayMongo cURL error: ' . $err);
        throw new RuntimeException('Could not reach the payment provider. If this is XAMPP on Windows and the error mentions an SSL certificate, set CURL_CA_BUNDLE in api/config.php (see README).');
    }
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $data = json_decode((string) $raw, true);
    if ($code >= 400 || !is_array($data)) {
        error_log('[jcalumpit] PayMongo HTTP ' . $code . ': ' . substr((string) $raw, 0, 500));
        $detail = $data['errors'][0]['detail'] ?? null;
        throw new RuntimeException($code === 401 ? 'The payment provider rejected the API key. Check PAYMONGO_SECRET_KEY in api/config.php.' : ('The payment provider returned an error' . ($detail ? ': ' . $detail : '.')));
    }
    return $data;
}

/** Records a successful online payment exactly once. Returns true if this call recorded it. */
function pay_record(PDO $pdo, array $session, string $providerRef, string $method, string $note): bool
{
    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare('SELECT * FROM payment_sessions WHERE id = ? FOR UPDATE');
        $st->execute([$session['id']]);
        $s = $st->fetch();
        if (!$s || $s['status'] === 'paid') {
            $pdo->commit();
            return false;
        }
        $pdo->prepare(
            'INSERT INTO payments (appointment_id, user_id, amount, method, reference, note, paid_at, recorded_by, provider, provider_ref)
             VALUES (?, ?, ?, ?, ?, ?, NOW(), NULL, ?, ?)'
        )->execute([$s['appointment_id'], $s['user_id'], $s['amount'], $method, $providerRef, $note, $s['provider'], $providerRef]);
        $pdo->prepare("UPDATE payment_sessions SET status = 'paid', paid_at = NOW() WHERE id = ?")->execute([$s['id']]);
        $pdo->commit();
        return true;
    } catch (PDOException $e) {
        $pdo->rollBack();
        if ($e->getCode() === '23000') {      // same gateway payment already recorded
            $pdo->prepare("UPDATE payment_sessions SET status = 'paid', paid_at = NOW() WHERE id = ?")->execute([$session['id']]);
            return false;
        }
        throw $e;
    }
}

/** Asks the provider whether a pending session was paid; records it if so. Returns the session status. */
function pay_verify_session(PDO $pdo, array $s): string
{
    if ($s['status'] !== 'pending') {
        return $s['status'];
    }
    if ($s['provider'] !== 'paymongo' || !$s['provider_session_id']) {
        $pdo->prepare("UPDATE payment_sessions SET status = 'cancelled' WHERE id = ? AND status = 'pending'")->execute([$s['id']]);
        return 'cancelled';   // leftovers from the removed practice checkout
    }
    $r = paymongo_request('GET', '/v1/checkout_sessions/' . rawurlencode($s['provider_session_id']));
    $attrs = $r['data']['attributes'] ?? [];
    $expected = (int) round(((float) $s['amount']) * 100);
    foreach (($attrs['payments'] ?? []) as $p) {
        $pa = $p['attributes'] ?? [];
        if (($pa['status'] ?? '') === 'paid' && (int) ($pa['amount'] ?? 0) >= $expected) {
            $src = $pa['source']['type'] ?? ($pa['source']['brand'] ?? '');
            pay_record($pdo, $s, (string) ($p['id'] ?? ('pm-' . $s['id'])), pay_method_for((string) $src), 'Paid online via PayMongo checkout');
            return 'paid';
        }
    }
    if (($attrs['status'] ?? '') === 'expired') {
        $pdo->prepare("UPDATE payment_sessions SET status = 'cancelled' WHERE id = ? AND status = 'pending'")->execute([$s['id']]);
        return 'cancelled';
    }
    return 'pending';
}

function session_out(array $s): array
{
    return [
        'token' => $s['token'], 'status' => $s['status'], 'provider' => $s['provider'],
        'amount' => money($s['amount']), 'appointmentId' => (int) $s['appointment_id'],
    ];
}
