<?php
// Patient appointments.
//   GET appointments.php                      my appointments
//   POST appointments.php                     request an appointment
//   POST appointments.php?action=cancel       cancel one of mine
//   GET appointments.php?action=slots&date=   open time slots for a day
require __DIR__ . '/config.php';



/**
 * Patient: list my appointments (GET) or request a new one (POST).
 * Patient endpoint.  GET = my appointments, POST = request a new appointment.
 */
function appts_list_or_create(): void
{
    $user = require_login();
    $method = $_SERVER['REQUEST_METHOD'];
    $pdo = db();

    if ($method === 'GET') {
        $st = $pdo->prepare(
            'SELECT ' . APPT_COLS . ' FROM appointments a JOIN users u ON u.id = a.user_id
             WHERE a.user_id = ? ORDER BY a.appt_date DESC, a.appt_time DESC'
        );
        $st->execute([$user['id']]);
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $o = appt_out($r);
            $o['payDue'] = pay_enabled() ? pay_amount_due($r) : 0;
            $out[] = $o;
        }
        json_out(['appointments' => $out, 'payment' => ['enabled' => pay_enabled(), 'mode' => PAYMENT_MODE]]);
    }

    if ($method !== 'POST') {
        fail('Method not allowed.', 405);
    }
    if (is_staff($user)) {
        fail('Staff accounts manage appointments from the admin page. Please sign in with a patient account to book.', 403);
    }

    $d = read_json();
    $name    = preg_replace('/\s+/', ' ', field($d, 'patient'));
    $phone   = normalize_phone(field($d, 'phone'));
    $email   = strtolower(field($d, 'email'));
    $service = field($d, 'service');
    $dentist = field($d, 'dentist') ?: 'Dr. Calumpit';
    $date    = field($d, 'date');
    $time    = field($d, 'slot');
    $notes   = field($d, 'notes');

    if (mb_strlen($name) < 2 || mb_strlen($name) > 150) {
        fail("Enter the patient's full name.");
    }
    if (!valid_phone($phone)) {
        fail('Use a valid PH number, e.g. 09171234567.');
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 150) {
        fail('Enter a valid email address.');
    }
    if ($service === '' || mb_strlen($service) > 100) {
        fail('Choose a service.');
    }
    if (mb_strlen($dentist) > 100) {
        fail('Invalid dentist.');
    }
    if (mb_strlen($notes) > 1000) {
        fail('Notes are too long (1000 characters max).');
    }
    check_slot($user, $date, $time);

    $pdo->beginTransaction();

    $cnt = $pdo->prepare(
        'SELECT COUNT(*) FROM appointments WHERE user_id = ? AND appt_date >= CURDATE() AND status IN ' . ACTIVE_SQL
    );
    $cnt->execute([$user['id']]);
    if ((int) $cnt->fetchColumn() >= MAX_ACTIVE_PER_PATIENT) {
        fail('You already have ' . MAX_ACTIVE_PER_PATIENT . ' upcoming appointments. Please cancel one or wait for the clinic to complete it before booking another.', 409);
    }

    // Lock the slot so two patients can't take it at the same moment.
    $clash = $pdo->prepare(
        'SELECT id FROM appointments WHERE appt_date = ? AND appt_time = ? AND status IN ' . ACTIVE_SQL . ' FOR UPDATE'
    );
    $clash->execute([$date, $time . ':00']);
    if ($clash->fetch()) {
        fail('Sorry, that time was just taken. Please pick another slot.', 409, ['code' => 'slot_taken']);
    }

    $ins = $pdo->prepare(
        "INSERT INTO appointments (user_id, patient_name, phone, email, service, dentist, appt_date, appt_time, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')"
    );
    $ins->execute([$user['id'], $name, $phone, $email, $service, $dentist, $date, $time . ':00', $notes !== '' ? $notes : null]);
    $id = (int) $pdo->lastInsertId();
    $pdo->commit();

    $row = $pdo->prepare('SELECT ' . APPT_COLS . ' FROM appointments a JOIN users u ON u.id = a.user_id WHERE a.id = ?');
    $row->execute([$id]);
    json_out(['appointment' => appt_out($row->fetch())], 201);
}

/**
 * Patient cancels one of their own upcoming appointments.
 */
function appts_cancel(): void
{
    $user = require_login();
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fail('Method not allowed.', 405);
    }
    $d = read_json();
    $id = (int) ($d['id'] ?? 0);

    $pdo = db();
    $st = $pdo->prepare('SELECT * FROM appointments WHERE id = ? AND user_id = ?');
    $st->execute([$id, $user['id']]);
    $a = $st->fetch();
    if (!$a) {
        fail('Appointment not found.', 404);
    }
    if (!in_array($a['status'], ['pending', 'approved', 'rescheduled'], true)) {
        fail('This appointment can no longer be cancelled.', 409);
    }
    if ($a['appt_date'] < date('Y-m-d')) {
        fail('Past appointments cannot be cancelled.', 409);
    }

    $pdo->prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?")->execute([$id]);
    json_out([]);
}

/**
 * Open/taken time slots for a day (patients and staff).
 * GET api/slots.php?date=YYYY-MM-DD[&exclude=ID]  ->  open/taken time slots for that day
 */
function appts_slots(): void
{
    $user = require_login();
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        fail('Method not allowed.', 405);
    }

    $dateStr = (string) ($_GET['date'] ?? '');
    $d = valid_date($dateStr);
    if (!$d) {
        fail('Please choose a valid date.');
    }

    $min = earliest_bookable($user);
    $max = (new DateTimeImmutable('today'))->modify('+' . BOOKING_WINDOW_DAYS . ' days');
    if ($d < $min || $d > $max) {
        json_out(['date' => $dateStr, 'open' => false, 'slots' => [],
                  'message' => $d < $min ? 'Please pick a later date.' : 'That date is too far ahead.']);
    }

    $times = slot_times($d);
    if (!$times) {
        json_out(['date' => $dateStr, 'open' => false, 'slots' => [],
                  'message' => 'The clinic is closed on Sundays. Please pick another date.']);
    }

    $exclude = is_staff($user) ? (int) ($_GET['exclude'] ?? 0) : 0;
    $taken = taken_times($dateStr, $exclude);
    $isToday = $dateStr === date('Y-m-d');

    $slots = [];
    foreach ($times as $t) {
        $past = $isToday && strtotime($t) <= time();
        $slots[] = ['time' => $t, 'label' => time_label($t), 'taken' => $past || in_array($t, $taken, true)];
    }
    json_out(['date' => $dateStr, 'open' => true, 'slots' => $slots]);
}

start_session();
switch ($_GET['action'] ?? '') {
    case 'cancel': appts_cancel(); break;
    case 'slots':  appts_slots();  break;
    default:       appts_list_or_create();
}
