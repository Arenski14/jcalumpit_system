<?php
// Everything the admin panel needs (staff only).  admin.php?r=<section>
//   stats | appointments | patients | records | record_file | treatments | billing | reports | users | messages | dentists
require __DIR__ . '/config.php';

const SELECT_APPT = 'SELECT ' . APPT_COLS . ' FROM appointments a JOIN users u ON u.id = a.user_id';

function fetch_appt(PDO $pdo, int $id): array
{
    $row = $pdo->prepare(SELECT_APPT . ' WHERE a.id = ?');
    $row->execute([$id]);
    return appt_out($row->fetch());
}

function patient_out(array $u): array
{
    $age = (new DateTimeImmutable($u['birth_date']))->diff(new DateTimeImmutable('today'))->y;
    return [
        'id' => (int) $u['id'], 'firstName' => $u['first_name'], 'middleName' => $u['middle_name'], 'lastName' => $u['last_name'],
        'fullName' => public_user($u)['fullName'], 'username' => $u['username'],
        'email' => $u['email'], 'phone' => $u['phone'], 'address' => $u['address'] ?? '', 'gender' => $u['gender'],
        'birthDate' => $u['birth_date'], 'age' => $age, 'joined' => substr($u['created_at'], 0, 10),
    ];
}

function get_patient(PDO $pdo, int $id): array
{
    $st = $pdo->prepare("SELECT * FROM users WHERE id = ? AND role = 'patient'");
    $st->execute([$id]);
    $u = $st->fetch();
    if (!$u) {
        fail('Patient not found.', 404);
    }
    return $u;
}

const REC_TYPES = ['medical_history', 'prescription', 'xray', 'lab_result', 'document'];

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const FILE_TYPES = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'application/pdf' => 'pdf'];

const REC_SELECT = "SELECT r.*, CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name) AS patient_name,
                           CONCAT_WS(' ', s.first_name, s.last_name) AS added_by_name
                    FROM records r JOIN users p ON p.id = r.patient_id LEFT JOIN users s ON s.id = r.added_by";

function rec_out(array $r): array
{
    return [
        'id' => (int) $r['id'], 'patientId' => (int) $r['patient_id'], 'patientName' => preg_replace('/\s+/', ' ', $r['patient_name']),
        'type' => $r['record_type'], 'title' => $r['title'], 'details' => $r['details'], 'date' => $r['record_date'],
        'hasFile' => $r['file_path'] !== null, 'fileName' => $r['file_name'], 'fileMime' => $r['file_mime'],
        'addedBy' => $r['added_by_name'] ?: null,
    ];
}

function rec_fields(array $d): array
{
    $type = field($d, 'type');
    if (!in_array($type, REC_TYPES, true)) {
        fail('Choose a record type.');
    }
    $title = field($d, 'title');
    if ($title === '' || mb_strlen($title) > 150) {
        fail('Enter a title (150 characters max).');
    }
    $details = field($d, 'details');
    if (mb_strlen($details) > 5000) {
        fail('The details are too long (5000 characters max).');
    }
    $date = field($d, 'date');
    if (!valid_date($date)) {
        fail('Enter a valid record date.');
    }
    return [$type, $title, $details !== '' ? $details : null, $date];
}

function fetch_rec(PDO $pdo, int $id): array
{
    $st = $pdo->prepare(REC_SELECT . ' WHERE r.id = ?');
    $st->execute([$id]);
    $r = $st->fetch();
    if (!$r) {
        fail('Record not found.', 404);
    }
    return $r;
}

const TR_STATUSES = ['plan', 'ongoing', 'completed', 'cancelled'];

const TR_SELECT = "SELECT t.*, CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name) AS patient_name
                   FROM treatments t JOIN users p ON p.id = t.patient_id";

function tr_out(array $t): array
{
    return [
        'id' => (int) $t['id'], 'patientId' => (int) $t['patient_id'], 'patientName' => preg_replace('/\s+/', ' ', $t['patient_name']),
        'name' => $t['name'], 'dentist' => $t['dentist'], 'startDate' => $t['start_date'], 'status' => $t['status'],
        'completedOn' => $t['completed_on'], 'notes' => $t['notes'],
    ];
}

function tr_fields(array $d): array
{
    $name = field($d, 'name');
    if ($name === '' || mb_strlen($name) > 150) {
        fail('Enter the treatment name (150 characters max).');
    }
    $dentist = field($d, 'dentist') ?: 'Dr. Calumpit';
    if (mb_strlen($dentist) > 100) {
        fail('The dentist name is too long.');
    }
    $start = field($d, 'startDate');
    if (!valid_date($start)) {
        fail('Enter a valid start date.');
    }
    $status = field($d, 'status');
    if (!in_array($status, TR_STATUSES, true)) {
        fail('Choose a status.');
    }
    $notes = field($d, 'notes');
    if (mb_strlen($notes) > 5000) {
        fail('The notes are too long.');
    }
    return [$name, $dentist, $start, $status, $notes !== '' ? $notes : null];
}

function fetch_tr(PDO $pdo, int $id): array
{
    $st = $pdo->prepare(TR_SELECT . ' WHERE t.id = ?');
    $st->execute([$id]);
    $t = $st->fetch();
    if (!$t) {
        fail('Treatment not found.', 404);
    }
    return $t;
}

const PAY_METHODS = ['cash', 'gcash', 'maya', 'card', 'bank_transfer', 'other'];

function peso(float $n): string
{
    return '₱' . number_format($n, 2);
}

function parse_amount($v): float
{
    if (is_string($v)) {
        $v = str_replace(',', '', trim($v));
    }
    if ($v === '' || $v === null || !is_numeric($v)) {
        fail('Enter a valid amount.');
    }
    $n = round((float) $v, 2);
    if ($n < 0 || $n > 1000000) {
        fail('Amount must be between 0 and 1,000,000.');
    }
    return $n;
}

function billing_state(PDO $pdo, int $apptId): array
{
    $st = $pdo->prepare('SELECT ' . APPT_COLS . ' FROM appointments a JOIN users u ON u.id = a.user_id WHERE a.id = ?');
    $st->execute([$apptId]);
    $a = $st->fetch();
    if (!$a) {
        fail('Appointment not found.', 404);
    }
    $p = $pdo->prepare(
        'SELECT p.*, r.first_name AS rec_name FROM payments p LEFT JOIN users r ON r.id = p.recorded_by
         WHERE p.appointment_id = ? ORDER BY p.paid_at DESC, p.id DESC'
    );
    $p->execute([$apptId]);
    $payments = [];
    foreach ($p->fetchAll() as $row) {
        $payments[] = [
            'id' => (int) $row['id'], 'amount' => money($row['amount']), 'method' => $row['method'],
            'reference' => $row['reference'], 'note' => $row['note'], 'paidAt' => $row['paid_at'],
            'recordedBy' => $row['rec_name'], 'provider' => $row['provider'] ?? null,
        ];
    }
    return ['appointment' => appt_out($a), 'payments' => $payments];
}

function metrics(PDO $pdo, string $from, string $to): array
{
    $one = function (string $sql) use ($pdo, $from, $to) {
        $st = $pdo->prepare($sql);
        $st->execute([$from, $to]);
        return $st->fetchColumn();
    };
    return [
        'appointments' => (int) $one("SELECT COUNT(*) FROM appointments WHERE appt_date BETWEEN ? AND ? AND status NOT IN ('declined','cancelled')"),
        'newPatients'  => (int) $one("SELECT COUNT(*) FROM users WHERE role = 'patient' AND DATE(created_at) BETWEEN ? AND ?"),
        'revenue'      => round((float) $one('SELECT COALESCE(SUM(amount), 0) FROM payments WHERE DATE(paid_at) BETWEEN ? AND ?'), 2),
        'treatments'   => (int) $one("SELECT COUNT(*) FROM treatments WHERE status = 'completed' AND completed_on BETWEEN ? AND ?"),
    ];
}

const STAFF_ROLES = ['admin', 'dentist', 'staff'];

const STAFF_ADDRESS = '2nd floor Banlicom Sentre 217 Maharlika Hwy, Banlic, Cabuyao, Philippines, 4025';

function user_out(array $u): array
{
    return [
        'id' => (int) $u['id'], 'firstName' => $u['first_name'], 'lastName' => $u['last_name'], 'fullName' => public_user($u)['fullName'],
        'role' => $u['role'], 'email' => $u['email'], 'phone' => $u['phone'], 'username' => $u['username'],
        'isActive' => (bool) (int) $u['is_active'], 'lastLogin' => $u['last_login'],
    ];
}

function staff_user(PDO $pdo, int $id): array
{
    $st = $pdo->prepare("SELECT * FROM users WHERE id = ? AND role IN ('admin','dentist','staff')");
    $st->execute([$id]);
    $u = $st->fetch();
    if (!$u) {
        fail('User not found.', 404);
    }
    return $u;
}

/** Another active admin must always remain. */
function ensure_other_admin(PDO $pdo, int $exceptId): void
{
    $st = $pdo->prepare("SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?");
    $st->execute([$exceptId]);
    if ((int) $st->fetchColumn() < 1) {
        fail('There must be at least one active administrator.', 409);
    }
}

function staff_fields(array $d): array
{
    $names = [];
    foreach (['firstName' => 'first name', 'lastName' => 'last name'] as $k => $label) {
        $v = preg_replace('/\s+/', ' ', field($d, $k));
        if ($v === '' || mb_strlen($v) > 60 || !preg_match("/^\p{L}[\p{L} .'\-]*$/u", $v)) {
            fail("Enter a valid $label.");
        }
        $names[$k] = $v;
    }
    $email = strtolower(field($d, 'email'));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 150) {
        fail('Enter a valid email address.');
    }
    $phone = normalize_phone(field($d, 'phone'));
    if (!valid_phone($phone)) {
        fail('Use a valid PH mobile number, e.g. 09171234567.');
    }
    $role = field($d, 'role');
    if (!in_array($role, STAFF_ROLES, true)) {
        fail('Choose a role.');
    }
    return [$names['firstName'], $names['lastName'], $email, $phone, $role];
}

function msg_out(array $m): array
{
    return [
        'id' => (int) $m['id'], 'kind' => $m['kind'], 'name' => $m['name'], 'email' => $m['email'], 'phone' => $m['phone'],
        'subject' => $m['subject'], 'message' => $m['message'], 'isRead' => (bool) (int) $m['is_read'],
        'createdAt' => $m['created_at'], 'readAt' => $m['read_at'], 'readBy' => $m['read_by_name'] ?? null,
        'accountId' => isset($m['account_id']) ? (int) $m['account_id'] : null, 'accountRole' => $m['account_role'] ?? null,
    ];
}

/**
 * Dashboard numbers (cards, weekly chart, patient statistics, bell badge).
 * Staff dashboard numbers (cards, weekly chart, patient statistics, bell badge).
 */
function admin_stats(): void
{
    require_staff();
    $pdo = db();

    $r = $pdo->query(
        "SELECT
            COALESCE(SUM(status = 'pending'), 0) AS pending,
            COALESCE(SUM(status IN ('pending','approved','rescheduled','completed') AND appt_date = CURDATE()), 0) AS today,
            COALESCE(SUM(status IN ('approved','rescheduled') AND appt_date >= CURDATE()), 0) AS upcoming,
            COALESCE(SUM(status = 'completed'), 0) AS completed,
            COUNT(*) AS total
         FROM appointments"
    )->fetch();

    $p = $pdo->query(
        "SELECT COUNT(*) AS total,
                COALESCE(SUM(u.created_at >= (CURDATE() - INTERVAL 30 DAY)), 0) AS new_p,
                COALESCE(SUM(u.created_at < (CURDATE() - INTERVAL 30 DAY) AND EXISTS (
                    SELECT 1 FROM appointments a WHERE a.user_id = u.id AND a.status IN ('approved','rescheduled','completed')
                    AND a.appt_date >= (CURDATE() - INTERVAL 180 DAY))), 0) AS returning_p
         FROM users u WHERE u.role = 'patient'"
    )->fetch();
    $new = (int) $p['new_p'];
    $returning = (int) $p['returning_p'];
    $patients = (int) $p['total'];

    // Appointments per week of the current month (week 1 = days 1-7, ...)
    $weeks = (int) ceil((int) date('t') / 7);
    $weekly = array_fill(1, $weeks, 0);
    $w = $pdo->query(
        "SELECT FLOOR((DAY(appt_date) - 1) / 7) + 1 AS wk, COUNT(*) AS c FROM appointments
         WHERE appt_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01') AND appt_date <= LAST_DAY(CURDATE())
           AND status NOT IN ('declined','cancelled') GROUP BY wk"
    )->fetchAll();
    foreach ($w as $row) {
        $weekly[(int) $row['wk']] = (int) $row['c'];
    }

    $outstanding = (float) $pdo->query(
        "SELECT COALESCE(SUM(GREATEST(a.fee - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.appointment_id = a.id), 0), 0)), 0)
         FROM appointments a WHERE a.status IN " . BILLABLE_SQL
    )->fetchColumn();
    $collected = (float) $pdo->query(
        "SELECT COALESCE(SUM(amount), 0) FROM payments WHERE paid_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')"
    )->fetchColumn();

    json_out(['stats' => [
        'pending'          => (int) $r['pending'],
        'today'            => (int) $r['today'],
        'upcoming'         => (int) $r['upcoming'],
        'completed'        => (int) $r['completed'],
        'total'            => (int) $r['total'],
        'patients'         => $patients,
        'activeTreatments' => (int) $pdo->query("SELECT COUNT(*) FROM treatments WHERE status = 'ongoing'")->fetchColumn(),
        'unreadMessages'   => (int) $pdo->query('SELECT COUNT(*) FROM messages WHERE is_read = 0')->fetchColumn(),
        'records'          => (int) $pdo->query('SELECT COUNT(*) FROM records')->fetchColumn(),
        'outstanding'      => round($outstanding, 2),
        'collected'        => round($collected, 2),
        'weekly'           => array_values($weekly),
        'patientStats'     => ['new' => $new, 'returning' => $returning, 'inactive' => max($patients - $new - $returning, 0)],
    ]]);
}

/**
 * List/filter appointments; approve, decline, reschedule, complete, cancel, create, delete.
 * Staff endpoint.
 * GET  = list/filter appointments (+ overall counts)
 * POST = approve | decline | reschedule | complete | cancel | create (walk-in/phone booking) | delete (admin)
 */
function admin_appointments(): void
{
    $staff = require_staff();
    $method = $_SERVER['REQUEST_METHOD'];
    $pdo = db();


    if ($method === 'GET') {
        $where = [];
        $args = [];

        $status = (string) ($_GET['status'] ?? '');
        if ($status !== '' && $status !== 'all') {
            $list = array_values(array_filter(explode(',', $status)));
            foreach ($list as $s) {
                if (!in_array($s, STATUSES, true)) {
                    fail('Unknown status.');
                }
            }
            $where[] = 'a.status IN (' . implode(',', array_fill(0, count($list), '?')) . ')';
            array_push($args, ...$list);
        }
        $date = (string) ($_GET['date'] ?? '');
        if ($date !== '') {
            if (!valid_date($date)) {
                fail('Invalid date.');
            }
            $where[] = 'a.appt_date = ?';
            $args[] = $date;
        }
        foreach (['from' => '>=', 'to' => '<='] as $key => $op) {
            $v = (string) ($_GET[$key] ?? '');
            if ($v !== '') {
                if (!valid_date($v)) {
                    fail('Invalid date.');
                }
                $where[] = "a.appt_date $op ?";
                $args[] = $v;
            }
        }
        $range = (string) ($_GET['range'] ?? 'all');
        $order = 'ASC';
        if ($range === 'upcoming') {
            $where[] = 'a.appt_date >= CURDATE()';
        } elseif ($range === 'past') {
            $where[] = 'a.appt_date < CURDATE()';
            $order = 'DESC';
        }
        if (($_GET['sort'] ?? '') === 'desc') {
            $order = 'DESC';
        } elseif (($_GET['sort'] ?? '') === 'asc') {
            $order = 'ASC';
        }
        $q = trim((string) ($_GET['q'] ?? ''));
        if ($q !== '') {
            $like = '%' . addcslashes($q, '%_\\') . '%';
            $where[] = '(a.patient_name LIKE ? OR a.phone LIKE ? OR a.email LIKE ? OR u.username LIKE ? OR a.service LIKE ?)';
            array_push($args, $like, $like, $like, $like, $like);
        }

        $sql = SELECT_APPT . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
             . " ORDER BY a.appt_date $order, a.appt_time $order LIMIT 500";
        $st = $pdo->prepare($sql);
        $st->execute($args);

        $c = $pdo->query(
            "SELECT COUNT(*) AS total,
                    COALESCE(SUM(status = 'pending'), 0) AS pending,
                    COALESCE(SUM(status IN ('approved','rescheduled') AND appt_date >= CURDATE()), 0) AS upcoming,
                    COALESCE(SUM(status = 'completed'), 0) AS completed,
                    COALESCE(SUM(status IN ('cancelled','declined')), 0) AS cancelled
             FROM appointments"
        )->fetch();
        json_out([
            'appointments' => array_map('appt_out', $st->fetchAll()),
            'counts' => array_map('intval', $c),
        ]);
    }

    if ($method !== 'POST') {
        fail('Method not allowed.', 405);
    }

    $d = read_json();
    $action = field($d, 'action');
    $note = field($d, 'note');
    if (mb_strlen($note) > 500) {
        fail('The note is too long (500 characters max).');
    }


    /* ----- staff books on behalf of a patient (approved straight away) ----- */
    if ($action === 'create') {
        $pu = $pdo->prepare("SELECT * FROM users WHERE id = ? AND role = 'patient'");
        $pu->execute([(int) ($d['patientId'] ?? 0)]);
        $patient = $pu->fetch();
        if (!$patient) {
            fail('Choose a patient.', 404);
        }
        $service = field($d, 'service');
        $dentist = field($d, 'dentist') ?: 'Dr. Calumpit';
        $date = field($d, 'date');
        $time = field($d, 'time');
        $notes = field($d, 'notes');
        if ($service === '' || mb_strlen($service) > 100) {
            fail('Choose a service.');
        }
        if (mb_strlen($dentist) > 100 || mb_strlen($notes) > 1000) {
            fail('Dentist or notes are too long.');
        }
        check_slot($staff, $date, $time);

        $pdo->beginTransaction();
        $clash = $pdo->prepare(
            'SELECT id FROM appointments WHERE appt_date = ? AND appt_time = ? AND status IN ' . ACTIVE_SQL . ' FOR UPDATE'
        );
        $clash->execute([$date, $time . ':00']);
        if ($clash->fetch()) {
            fail('That slot is already taken by another appointment.', 409, ['code' => 'slot_taken']);
        }
        $pdo->prepare(
            "INSERT INTO appointments (user_id, patient_name, phone, email, service, dentist, appt_date, appt_time, notes, admin_note, status, handled_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?)"
        )->execute([
            $patient['id'], public_user($patient)['fullName'], $patient['phone'], $patient['email'], $service, $dentist,
            $date, $time . ':00', $notes !== '' ? $notes : null, $note !== '' ? $note : null, $staff['id'],
        ]);
        $id = (int) $pdo->lastInsertId();
        $pdo->commit();
        json_out(['appointment' => fetch_appt($pdo, $id)], 201);
    }

    $id = (int) ($d['id'] ?? 0);

    if ($action === 'delete') {
        if ($staff['role'] !== 'admin') {
            fail('Only an administrator can delete an appointment.', 403);
        }
        $pdo->prepare('DELETE FROM appointments WHERE id = ?')->execute([$id]);
        json_out([]);
    }

    $allowed = [
        'pending'     => ['approve', 'decline', 'reschedule', 'cancel'],
        'approved'    => ['reschedule', 'complete', 'cancel'],
        'rescheduled' => ['reschedule', 'complete', 'cancel'],
    ];

    $pdo->beginTransaction();
    $st = $pdo->prepare('SELECT * FROM appointments WHERE id = ? FOR UPDATE');
    $st->execute([$id]);
    $a = $st->fetch();
    if (!$a) {
        fail('Appointment not found.', 404);
    }
    if (!in_array($action, $allowed[$a['status']] ?? [], true)) {
        fail('You can\'t "' . $action . '" an appointment that is ' . $a['status'] . '.', 409);
    }

    $noteVal = $note !== '' ? $note : null;

    if ($action === 'reschedule') {
        $newDate = field($d, 'date');
        $newTime = field($d, 'time');
        check_slot($staff, $newDate, $newTime);
        if ($newDate === $a['appt_date'] && $newTime . ':00' === $a['appt_time']) {
            fail('Choose a different date or time than the current one.');
        }
        $clash = $pdo->prepare(
            'SELECT id FROM appointments WHERE appt_date = ? AND appt_time = ? AND id <> ? AND status IN ' . ACTIVE_SQL . ' FOR UPDATE'
        );
        $clash->execute([$newDate, $newTime . ':00', $id]);
        if ($clash->fetch()) {
            fail('That slot is already taken by another appointment.', 409, ['code' => 'slot_taken']);
        }
        $pdo->prepare(
            "UPDATE appointments SET prev_date = appt_date, prev_time = appt_time, appt_date = ?, appt_time = ?,
             status = 'rescheduled', admin_note = ?, handled_by = ? WHERE id = ?"
        )->execute([$newDate, $newTime . ':00', $noteVal, $staff['id'], $id]);
    } else {
        if ($action === 'complete' && $a['appt_date'] > date('Y-m-d')) {
            fail('A visit can only be marked completed on or after its appointment date.', 409);
        }
        $newStatus = ['approve' => 'approved', 'decline' => 'declined', 'cancel' => 'cancelled', 'complete' => 'completed'][$action];
        $pdo->prepare('UPDATE appointments SET status = ?, admin_note = ?, handled_by = ? WHERE id = ?')
            ->execute([$newStatus, $noteVal, $staff['id'], $id]);
    }
    $pdo->commit();

    json_out(['appointment' => fetch_appt($pdo, $id)]);
}

/**
 * Patients: list, profile, create, update, reset password, delete.
 * Staff endpoint.
 * GET ?q=...        -> patient list + stats      GET ?brief=1 -> id/name list for drop-downs
 * GET ?id=N         -> one patient + billing + visit history + records + treatments
 * POST create | update | reset_password | delete (delete = admin only)
 */
function admin_patients(): void
{
    $staff = require_staff();
    $pdo = db();



    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        if (isset($_GET['brief'])) {
            $rows = $pdo->query("SELECT * FROM users WHERE role = 'patient' ORDER BY first_name, last_name LIMIT 2000")->fetchAll();
            json_out(['patients' => array_map(function ($u) {
                return ['id' => (int) $u['id'], 'fullName' => public_user($u)['fullName'], 'username' => $u['username']];
            }, $rows)]);
        }

        if (isset($_GET['id'])) {
            $u = get_patient($pdo, (int) $_GET['id']);
            $h = $pdo->prepare(
                'SELECT ' . APPT_COLS . ' FROM appointments a JOIN users u ON u.id = a.user_id
                 WHERE a.user_id = ? ORDER BY a.appt_date DESC, a.appt_time DESC'
            );
            $h->execute([$u['id']]);
            $rec = $pdo->prepare('SELECT id, record_type, title, record_date FROM records WHERE patient_id = ? ORDER BY record_date DESC, id DESC LIMIT 50');
            $rec->execute([$u['id']]);
            $tr = $pdo->prepare('SELECT id, name, dentist, start_date, status FROM treatments WHERE patient_id = ? ORDER BY start_date DESC, id DESC LIMIT 50');
            $tr->execute([$u['id']]);
            json_out([
                'patient'      => patient_out($u),
                'billing'      => billing_totals((int) $u['id']),
                'appointments' => array_map('appt_out', $h->fetchAll()),
                'records'      => $rec->fetchAll(),
                'treatments'   => $tr->fetchAll(),
            ]);
        }

        $where = "u.role = 'patient'";
        $args = [];
        $q = trim((string) ($_GET['q'] ?? ''));
        if ($q !== '') {
            $like = '%' . addcslashes($q, '%_\\') . '%';
            $where .= " AND (CONCAT_WS(' ', u.first_name, u.middle_name, u.last_name) LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR u.username LIKE ? OR u.address LIKE ?)";
            array_push($args, $like, $like, $like, $like, $like);
        }
        $st = $pdo->prepare(
            "SELECT u.*, COUNT(a.id) AS visits,
                    MAX(CASE WHEN a.appt_date <= CURDATE() THEN a.appt_date END) AS last_visit,
                    (SELECT COALESCE(SUM(GREATEST(b.fee - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.appointment_id = b.id), 0), 0)), 0)
                       FROM appointments b WHERE b.user_id = u.id AND b.status IN " . BILLABLE_SQL . ") AS due
             FROM users u LEFT JOIN appointments a ON a.user_id = u.id AND a.status IN ('approved','rescheduled','completed')
             WHERE $where GROUP BY u.id ORDER BY u.created_at DESC LIMIT 500"
        );
        $st->execute($args);
        $out = [];
        foreach ($st->fetchAll() as $u) {
            $out[] = patient_out($u) + ['visits' => (int) $u['visits'], 'lastVisit' => $u['last_visit'], 'due' => money($u['due'])];
        }
        $s = $pdo->query(
            "SELECT COUNT(*) AS total, COALESCE(SUM(gender = 'male'), 0) AS male, COALESCE(SUM(gender = 'female'), 0) AS female,
                    COALESCE(SUM(created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')), 0) AS new_month
             FROM users WHERE role = 'patient'"
        )->fetch();
        json_out(['patients' => $out, 'stats' => [
            'total' => (int) $s['total'], 'male' => (int) $s['male'], 'female' => (int) $s['female'], 'newMonth' => (int) $s['new_month'],
        ]]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fail('Method not allowed.', 405);
    }
    $d = read_json();
    $action = field($d, 'action');

    if ($action === 'create') {
        $p = validate_profile($d, false);
        $username = field($d, 'username');
        if ($username === '') {
            $username = make_username((string) $p['first'], (string) $p['last']);
        }
        check_username($username);
        assert_unique($username, $p['email']);
        $temp = temp_password();
        $pdo->prepare(
            "INSERT INTO users (first_name, middle_name, last_name, gender, birth_date, email, phone, address, username, password_hash, role)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'patient')"
        )->execute([$p['first'], $p['middle'], $p['last'], $p['gender'], $p['birth'], $p['email'], $p['phone'], $p['address'],
                    $username, password_hash($temp, PASSWORD_DEFAULT)]);
        json_out(['id' => (int) $pdo->lastInsertId(), 'username' => $username, 'tempPassword' => $temp], 201);
    }

    $u = get_patient($pdo, (int) ($d['id'] ?? 0));

    if ($action === 'update') {
        $p = validate_profile($d, false);
        assert_unique($u['username'], $p['email'], (int) $u['id']);
        $pdo->prepare(
            'UPDATE users SET first_name = ?, middle_name = ?, last_name = ?, gender = ?, birth_date = ?, email = ?, phone = ?, address = ? WHERE id = ?'
        )->execute([$p['first'], $p['middle'], $p['last'], $p['gender'], $p['birth'], $p['email'], $p['phone'], $p['address'], $u['id']]);
        json_out([]);
    }

    if ($action === 'reset_password') {
        $temp = temp_password();
        $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($temp, PASSWORD_DEFAULT), $u['id']]);
        json_out(['username' => $u['username'], 'tempPassword' => $temp]);
    }

    if ($action === 'delete') {
        if ($staff['role'] !== 'admin') {
            fail('Only an administrator can delete a patient.', 403);
        }
        $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$u['id']]);
        json_out([]);
    }

    fail('Unknown action.');
}

/**
 * Patient records (medical history, prescriptions, x-rays, lab results, documents).
 * Staff endpoint for patient records.
 * GET ?type=&q=   -> list + counts per type
 * POST create (optional base64 file) | update | delete (admin only)
 */
function admin_records(): void
{
    $staff = require_staff();
    $pdo = db();

    $dir = __DIR__ . '/../storage/records';




    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $where = [];
        $args = [];
        $type = (string) ($_GET['type'] ?? '');
        if ($type !== '' && $type !== 'all') {
            if (!in_array($type, REC_TYPES, true)) {
                fail('Unknown record type.');
            }
            $where[] = 'r.record_type = ?';
            $args[] = $type;
        }
        $q = trim((string) ($_GET['q'] ?? ''));
        if ($q !== '') {
            $like = '%' . addcslashes($q, '%_\\') . '%';
            $where[] = "(r.title LIKE ? OR CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name) LIKE ?)";
            array_push($args, $like, $like);
        }
        $st = $pdo->prepare(REC_SELECT . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY r.record_date DESC, r.id DESC LIMIT 1000');
        $st->execute($args);

        $counts = array_fill_keys(REC_TYPES, 0);
        foreach ($pdo->query('SELECT record_type, COUNT(*) AS c FROM records GROUP BY record_type')->fetchAll() as $row) {
            $counts[$row['record_type']] = (int) $row['c'];
        }
        json_out(['records' => array_map('rec_out', $st->fetchAll()), 'counts' => $counts + ['all' => array_sum($counts)]]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fail('Method not allowed.', 405);
    }
    $d = read_json();
    $action = field($d, 'action');


    if ($action === 'create') {
        $pt = $pdo->prepare("SELECT id FROM users WHERE id = ? AND role = 'patient'");
        $pt->execute([(int) ($d['patientId'] ?? 0)]);
        if (!$pt->fetchColumn()) {
            fail('Choose a patient.', 404);
        }
        [$type, $title, $details, $date] = rec_fields($d);

        $fileName = $filePath = $fileMime = null;
        $file = $d['file'] ?? null;
        if (is_array($file) && !empty($file['data'])) {
            $bytes = base64_decode((string) $file['data'], true);
            if ($bytes === false || $bytes === '') {
                fail('The file could not be read. Please try again.');
            }
            if (strlen($bytes) > MAX_FILE_BYTES) {
                fail('The file is too large (5 MB max).');
            }
            $mime = (new finfo(FILEINFO_MIME_TYPE))->buffer($bytes);
            if (!array_key_exists($mime, FILE_TYPES)) {
                fail('Only JPG, PNG, WebP or PDF files are allowed.');
            }
            if (!is_dir($dir) && !mkdir($dir, 0775, true)) {
                fail('The server could not create the storage folder.', 500);
            }
            // Keep uploaded records private: Apache must never serve this folder directly.
            foreach ([dirname($dir), $dir] as $protect) {
                if (!is_file($protect . '/.htaccess')) {
                    @file_put_contents($protect . '/.htaccess', "Require all denied\n<IfModule !mod_authz_core.c>\n  Deny from all\n</IfModule>\n");
                }
            }
            $filePath = bin2hex(random_bytes(16)) . '.' . FILE_TYPES[$mime];
            if (file_put_contents($dir . '/' . $filePath, $bytes) === false) {
                fail('The server could not save the file.', 500);
            }
            $fileMime = $mime;
            $fileName = substr(preg_replace('/[^A-Za-z0-9._ -]/', '_', basename((string) ($file['name'] ?? 'file'))), 0, 200);
        }

        $pdo->prepare(
            'INSERT INTO records (patient_id, record_type, title, details, file_name, file_path, file_mime, record_date, added_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([(int) $d['patientId'], $type, $title, $details, $fileName, $filePath, $fileMime, $date, $staff['id']]);
        json_out(['record' => rec_out(fetch_rec($pdo, (int) $pdo->lastInsertId()))], 201);
    }

    $id = (int) ($d['id'] ?? 0);
    $r = fetch_rec($pdo, $id);

    if ($action === 'update') {
        [$type, $title, $details, $date] = rec_fields($d);
        $pdo->prepare('UPDATE records SET record_type = ?, title = ?, details = ?, record_date = ? WHERE id = ?')
            ->execute([$type, $title, $details, $date, $id]);
        json_out(['record' => rec_out(fetch_rec($pdo, $id))]);
    }

    if ($action === 'delete') {
        if ($staff['role'] !== 'admin') {
            fail('Only an administrator can delete a record.', 403);
        }
        if ($r['file_path']) {
            @unlink($dir . '/' . basename($r['file_path']));
        }
        $pdo->prepare('DELETE FROM records WHERE id = ?')->execute([$id]);
        json_out([]);
    }

    fail('Unknown action.');
}

/**
 * Streams a stored record file to signed-in staff only.
 * Streams a stored record file (X-ray, PDF...) to signed-in staff only.
 */
function admin_record_file(): void
{
    require_staff();

    $st = db()->prepare('SELECT file_name, file_path, file_mime FROM records WHERE id = ? AND file_path IS NOT NULL');
    $st->execute([(int) ($_GET['id'] ?? 0)]);
    $r = $st->fetch();
    $path = $r ? __DIR__ . '/../storage/records/' . basename($r['file_path']) : '';
    if (!$r || !is_file($path)) {
        fail('File not found.', 404);
    }

    header('Content-Type: ' . $r['file_mime']);
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: inline; filename="' . str_replace('"', '', $r['file_name'] ?: 'record') . '"');
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
    readfile($path);
}

/**
 * Treatments and treatment plans.
 * Staff endpoint for treatments / treatment plans.
 * GET ?status=&q=  -> list + counts      POST create | update | delete (admin only)
 */
function admin_treatments(): void
{
    $staff = require_staff();
    $pdo = db();





    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $where = [];
        $args = [];
        $status = (string) ($_GET['status'] ?? '');
        if ($status !== '' && $status !== 'all') {
            if (!in_array($status, TR_STATUSES, true)) {
                fail('Unknown status.');
            }
            $where[] = 't.status = ?';
            $args[] = $status;
        }
        $q = trim((string) ($_GET['q'] ?? ''));
        if ($q !== '') {
            $like = '%' . addcslashes($q, '%_\\') . '%';
            $where[] = "(t.name LIKE ? OR t.dentist LIKE ? OR CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name) LIKE ?)";
            array_push($args, $like, $like, $like);
        }
        $st = $pdo->prepare(TR_SELECT . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY t.start_date DESC, t.id DESC LIMIT 1000');
        $st->execute($args);
        $counts = array_fill_keys(TR_STATUSES, 0);
        foreach ($pdo->query('SELECT status, COUNT(*) AS c FROM treatments GROUP BY status')->fetchAll() as $row) {
            $counts[$row['status']] = (int) $row['c'];
        }
        json_out(['treatments' => array_map('tr_out', $st->fetchAll()), 'counts' => $counts]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fail('Method not allowed.', 405);
    }
    $d = read_json();
    $action = field($d, 'action');

    if ($action === 'create') {
        $pt = $pdo->prepare("SELECT id FROM users WHERE id = ? AND role = 'patient'");
        $pt->execute([(int) ($d['patientId'] ?? 0)]);
        if (!$pt->fetchColumn()) {
            fail('Choose a patient.', 404);
        }
        [$name, $dentist, $start, $status, $notes] = tr_fields($d);
        $pdo->prepare(
            'INSERT INTO treatments (patient_id, name, dentist, start_date, status, completed_on, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([(int) $d['patientId'], $name, $dentist, $start, $status, $status === 'completed' ? date('Y-m-d') : null, $notes, $staff['id']]);
        json_out(['treatment' => tr_out(fetch_tr($pdo, (int) $pdo->lastInsertId()))], 201);
    }

    $id = (int) ($d['id'] ?? 0);
    $t = fetch_tr($pdo, $id);

    if ($action === 'update') {
        [$name, $dentist, $start, $status, $notes] = tr_fields($d);
        $completedOn = $status === 'completed' ? ($t['completed_on'] ?: date('Y-m-d')) : null;
        $pdo->prepare('UPDATE treatments SET name = ?, dentist = ?, start_date = ?, status = ?, completed_on = ?, notes = ? WHERE id = ?')
            ->execute([$name, $dentist, $start, $status, $completedOn, $notes, $id]);
        json_out(['treatment' => tr_out(fetch_tr($pdo, $id))]);
    }

    if ($action === 'delete') {
        if ($staff['role'] !== 'admin') {
            fail('Only an administrator can delete a treatment.', 403);
        }
        $pdo->prepare('DELETE FROM treatments WHERE id = ?')->execute([$id]);
        json_out([]);
    }

    fail('Unknown action.');
}

/**
 * Invoices, fees and payments recorded by staff.
 * Staff endpoint.  GET ?appointment_id=N -> fee, payments, balance
 * POST {action: set_fee | add_payment | delete_payment, ...}
 */
function admin_billing(): void
{
    $staff = require_staff();
    $pdo = db();





    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        if (!isset($_GET['list'])) {
            json_out(billing_state($pdo, (int) ($_GET['appointment_id'] ?? 0)));
        }

        // Invoice list: every approved/rescheduled/completed visit, with its fee, payments and status.
        $rows = $pdo->query(
            'SELECT ' . APPT_COLS . ' FROM appointments a JOIN users u ON u.id = a.user_id
             WHERE a.status IN ' . BILLABLE_SQL . '
                OR (a.status IN (\'declined\', \'cancelled\') AND EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = a.id))
             ORDER BY COALESCE(a.billed_at, a.created_at) DESC, a.id DESC LIMIT 1000'
        )->fetchAll();
        $today = date('Y-m-d');
        $invoices = [];
        $billed = 0.0;
        $paidTotal = 0.0;
        $count = 0;
        foreach ($rows as $r) {
            $fee = money($r['fee']);
            $paid = min(money($r['paid']), $fee);
            $date = $r['billed_at'] ? substr($r['billed_at'], 0, 10) : null;
            $due = $date ? date('Y-m-d', strtotime($date . ' +' . INVOICE_DUE_DAYS . ' days')) : null;
            if (!in_array($r['status'], BILLABLE, true)) {
                // declined/cancelled visit that still holds an online deposit
                $status = 'refund';
                $fee = money($r['paid']);
                $paid = $fee;
            } elseif ($fee <= 0) {
                $status = 'notbilled';
                $paid = money($r['paid']);      // a deposit paid before the fee was set
            } else {
                $status = $paid >= $fee ? 'paid' : ($paid > 0 ? 'partial' : 'unpaid');
                $billed += $fee;
                $paidTotal += $paid;
                $count++;
            }
            $invoices[] = [
                'id' => (int) $r['id'], 'userId' => (int) $r['user_id'], 'patientName' => $r['patient_name'], 'service' => $r['service'],
                'apptDate' => $r['appt_date'], 'invoiceDate' => $date, 'dueDate' => $due, 'fee' => $fee, 'paid' => $paid,
                'balance' => round(max($fee - $paid, 0), 2), 'status' => $status,
                'overdue' => !in_array($status, ['paid', 'notbilled', 'refund'], true) && $due !== null && $due < $today,
            ];
        }
        json_out(['invoices' => $invoices, 'stats' => [
            'billed' => round($billed, 2), 'paid' => round($paidTotal, 2),
            'outstanding' => round(max($billed - $paidTotal, 0), 2), 'invoices' => $count,
        ]]);
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fail('Method not allowed.', 405);
    }

    $d = read_json();
    $action = field($d, 'action');

    if ($action === 'delete_payment') {
        if ($staff['role'] !== 'admin') {
            fail('Only an admin can remove a payment.', 403);
        }
        $st = $pdo->prepare('SELECT appointment_id FROM payments WHERE id = ?');
        $st->execute([(int) ($d['paymentId'] ?? 0)]);
        $apptId = $st->fetchColumn();
        if (!$apptId) {
            fail('Payment not found.', 404);
        }
        $pdo->prepare('DELETE FROM payments WHERE id = ?')->execute([(int) $d['paymentId']]);
        json_out(billing_state($pdo, (int) $apptId));
    }

    if (!in_array($action, ['set_fee', 'add_payment'], true)) {
        fail('Unknown action.');
    }

    $apptId = (int) ($d['appointmentId'] ?? 0);
    $pdo->beginTransaction();
    $st = $pdo->prepare('SELECT * FROM appointments WHERE id = ? FOR UPDATE');
    $st->execute([$apptId]);
    $a = $st->fetch();
    if (!$a) {
        fail('Appointment not found.', 404);
    }
    if (!in_array($a['status'], BILLABLE, true)) {
        fail('Billing is available once an appointment is approved.', 409);
    }

    $sum = $pdo->prepare('SELECT COALESCE(SUM(amount), 0) FROM payments WHERE appointment_id = ?');
    $sum->execute([$apptId]);
    $paid = money($sum->fetchColumn());
    $fee = money($a['fee']);

    if ($action === 'set_fee') {
        $newFee = parse_amount($d['fee'] ?? null);
        if ($newFee < $paid) {
            fail('The fee can\'t be lower than the ' . peso($paid) . ' already paid. Remove a payment first if it was a mistake.', 409);
        }
        $pdo->prepare('UPDATE appointments SET fee = ?, billed_at = CASE WHEN ? > 0 THEN COALESCE(billed_at, NOW()) ELSE NULL END WHERE id = ?')
            ->execute([$newFee, $newFee, $apptId]);
    } else {
        $amount = parse_amount($d['amount'] ?? null);
        if ($amount <= 0) {
            fail('Enter a payment amount greater than zero.');
        }
        if ($fee <= 0) {
            fail('Set the fee for this visit before recording a payment.', 409);
        }
        if ($amount > round($fee - $paid, 2) + 0.001) {
            fail('That is more than the remaining balance of ' . peso(max($fee - $paid, 0)) . '.', 409);
        }
        $method = field($d, 'method');
        if (!in_array($method, PAY_METHODS, true)) {
            fail('Choose a payment method.');
        }
        $ref = field($d, 'reference');
        $note = field($d, 'note');
        if (mb_strlen($ref) > 100 || mb_strlen($note) > 255) {
            fail('The reference or note is too long.');
        }
        $pdo->prepare(
            'INSERT INTO payments (appointment_id, user_id, amount, method, reference, note, recorded_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        )->execute([$apptId, $a['user_id'], $amount, $method, $ref !== '' ? $ref : null, $note !== '' ? $note : null, $staff['id']]);
    }
    $pdo->commit();
    json_out(billing_state($pdo, $apptId));
}

/**
 * Reports by period.
 * Staff reports.  GET ?period=this_month|last_month|last_30|this_year
 */
function admin_reports(): void
{
    require_staff();
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        fail('Method not allowed.', 405);
    }
    $pdo = db();
    $today = new DateTimeImmutable('today');
    $period = (string) ($_GET['period'] ?? 'this_month');

    switch ($period) {
        case 'last_month':
            $from = $today->modify('first day of last month');
            $to = $today->modify('last day of last month');
            $pFrom = $from->modify('first day of last month');
            $pTo = $from->modify('-1 day');
            break;
        case 'last_30':
            $from = $today->modify('-29 days');
            $to = $today;
            $pFrom = $today->modify('-59 days');
            $pTo = $today->modify('-30 days');
            break;
        case 'this_year':
            $from = new DateTimeImmutable($today->format('Y') . '-01-01');
            $to = new DateTimeImmutable($today->format('Y') . '-12-31');
            $pFrom = $from->modify('-1 year');
            $pTo = $to->modify('-1 year');
            break;
        case 'this_month':
        default:
            $period = 'this_month';
            $from = $today->modify('first day of this month');
            $to = $today->modify('last day of this month');
            $pFrom = $from->modify('first day of last month');
            $pTo = $from->modify('-1 day');
    }


    $f = $from->format('Y-m-d');
    $t = $to->format('Y-m-d');
    $cur = metrics($pdo, $f, $t);
    $prev = metrics($pdo, $pFrom->format('Y-m-d'), $pTo->format('Y-m-d'));
    $change = [];
    foreach ($cur as $k => $v) {
        $change[$k] = $prev[$k] > 0 ? (int) round(($v - $prev[$k]) / $prev[$k] * 100) : null;
    }

    // Per-day counts / revenue, then bucketed below
    $ap = [];
    $st = $pdo->prepare("SELECT appt_date AS d, COUNT(*) AS c FROM appointments WHERE appt_date BETWEEN ? AND ? AND status NOT IN ('declined','cancelled') GROUP BY appt_date");
    $st->execute([$f, $t]);
    foreach ($st->fetchAll() as $r) {
        $ap[$r['d']] = (int) $r['c'];
    }
    $rv = [];
    $st = $pdo->prepare('SELECT DATE(paid_at) AS d, SUM(amount) AS s FROM payments WHERE DATE(paid_at) BETWEEN ? AND ? GROUP BY DATE(paid_at)');
    $st->execute([$f, $t]);
    foreach ($st->fetchAll() as $r) {
        $rv[$r['d']] = (float) $r['s'];
    }

    $appointmentsSeries = [];
    $revenueSeries = [];
    if ($period === 'this_year') {
        for ($m = 1; $m <= 12; $m++) {
            $key = sprintf('%s-%02d', $today->format('Y'), $m);
            $c = 0;
            $s = 0.0;
            foreach ($ap as $d => $v) {
                if (strpos($d, $key) === 0) {
                    $c += $v;
                }
            }
            foreach ($rv as $d => $v) {
                if (strpos($d, $key) === 0) {
                    $s += $v;
                }
            }
            $label = date('M', strtotime($key . '-01'));
            $appointmentsSeries[] = ['label' => $label, 'value' => $c];
            $revenueSeries[] = ['label' => $label, 'value' => round($s, 2)];
        }
    } else {
        for ($d = $from; $d <= $to; $d = $d->modify('+1 day')) {
            $appointmentsSeries[] = ['label' => $d->format('M j'), 'value' => $ap[$d->format('Y-m-d')] ?? 0];
        }
        // revenue in 7-day blocks
        for ($start = $from; $start <= $to; $start = $start->modify('+7 days')) {
            $end = $start->modify('+6 days');
            if ($end > $to) {
                $end = $to;
            }
            $sum = 0.0;
            for ($d = $start; $d <= $end; $d = $d->modify('+1 day')) {
                $sum += $rv[$d->format('Y-m-d')] ?? 0;
            }
            $revenueSeries[] = ['label' => $start->format('M j'), 'value' => round($sum, 2)];
        }
    }

    $st = $pdo->prepare("SELECT service, COUNT(*) AS c FROM appointments WHERE appt_date BETWEEN ? AND ? AND status NOT IN ('declined','cancelled') GROUP BY service ORDER BY c DESC");
    $st->execute([$f, $t]);
    $services = [];
    $other = 0;
    foreach ($st->fetchAll() as $i => $r) {
        if ($i < 4) {
            $services[] = ['label' => $r['service'], 'value' => (int) $r['c']];
        } else {
            $other += (int) $r['c'];
        }
    }
    if ($other > 0) {
        $services[] = ['label' => 'Other', 'value' => $other];
    }

    json_out([
        'period' => $period, 'from' => $f, 'to' => $t,
        'metrics' => $cur, 'previous' => $prev, 'change' => $change,
        'appointmentsSeries' => $appointmentsSeries, 'revenueSeries' => $revenueSeries, 'services' => $services,
    ]);
}

/**
 * Administrator only: manage staff, dentist and admin accounts.
 * Administrator-only: manage staff, dentist and admin accounts.
 * GET -> list + counts      POST create | update | set_active | reset_password | delete
 */
function admin_users(): void
{
    $admin = require_admin();
    $pdo = db();






    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $rows = $pdo->query("SELECT * FROM users WHERE role IN ('admin','dentist','staff') ORDER BY FIELD(role,'admin','dentist','staff'), first_name")->fetchAll();
        $counts = ['total' => count($rows), 'admin' => 0, 'dentist' => 0, 'staff' => 0];
        foreach ($rows as $r) {
            $counts[$r['role']]++;
        }
        json_out(['users' => array_map('user_out', $rows), 'counts' => $counts, 'meId' => (int) $admin['id']]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fail('Method not allowed.', 405);
    }
    $d = read_json();
    $action = field($d, 'action');

    if ($action === 'create') {
        [$first, $last, $email, $phone, $role] = staff_fields($d);
        $username = field($d, 'username');
        check_username($username);
        assert_unique($username, $email);
        $password = is_string($d['password'] ?? null) ? $d['password'] : '';
        $generated = false;
        if ($password === '') {
            $password = temp_password();
            $generated = true;
        } else {
            check_password_rules($password);
        }
        $pdo->prepare(
            "INSERT INTO users (first_name, middle_name, last_name, gender, birth_date, email, phone, address, username, password_hash, role)
             VALUES (?, NULL, ?, 'prefer-not-to-say', '1990-01-01', ?, ?, ?, ?, ?, ?)"
        )->execute([$first, $last, $email, $phone, STAFF_ADDRESS, $username, password_hash($password, PASSWORD_DEFAULT), $role]);
        json_out(['id' => (int) $pdo->lastInsertId(), 'username' => $username, 'tempPassword' => $generated ? $password : null], 201);
    }

    $u = staff_user($pdo, (int) ($d['id'] ?? 0));
    $isSelf = (int) $u['id'] === (int) $admin['id'];

    if ($action === 'update') {
        [$first, $last, $email, $phone, $role] = staff_fields($d);
        assert_unique($u['username'], $email, (int) $u['id']);
        if ($role !== $u['role']) {
            if ($isSelf) {
                fail('You can\'t change your own role.', 409);
            }
            if ($u['role'] === 'admin') {
                ensure_other_admin($pdo, (int) $u['id']);
            }
        }
        $pdo->prepare('UPDATE users SET first_name = ?, last_name = ?, email = ?, phone = ?, role = ? WHERE id = ?')
            ->execute([$first, $last, $email, $phone, $role, $u['id']]);
        json_out([]);
    }

    if ($action === 'set_active') {
        $active = !empty($d['active']) ? 1 : 0;
        if (!$active) {
            if ($isSelf) {
                fail('You can\'t deactivate your own account.', 409);
            }
            if ($u['role'] === 'admin') {
                ensure_other_admin($pdo, (int) $u['id']);
            }
        }
        $pdo->prepare('UPDATE users SET is_active = ? WHERE id = ?')->execute([$active, $u['id']]);
        json_out([]);
    }

    if ($action === 'reset_password') {
        $temp = temp_password();
        $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($temp, PASSWORD_DEFAULT), $u['id']]);
        json_out(['username' => $u['username'], 'tempPassword' => $temp]);
    }

    if ($action === 'delete') {
        if ($isSelf) {
            fail('You can\'t delete your own account.', 409);
        }
        if ($u['role'] === 'admin') {
            ensure_other_admin($pdo, (int) $u['id']);
        }
        $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$u['id']]);
        json_out([]);
    }

    fail('Unknown action.');
}

/**
 * Inbox: contact-form messages and password-reset requests.
 * Staff inbox for contact-form messages and password-reset requests.
 * GET ?filter=all|unread|contact|password_reset&q=   POST mark_read | mark_all_read | delete (admin only)
 */
function admin_messages(): void
{
    $staff = require_staff();
    $pdo = db();


    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $where = [];
        $args = [];
        $filter = (string) ($_GET['filter'] ?? 'all');
        if ($filter === 'unread') {
            $where[] = 'm.is_read = 0';
        } elseif ($filter === 'contact' || $filter === 'password_reset') {
            $where[] = 'm.kind = ?';
            $args[] = $filter;
        }
        $q = trim((string) ($_GET['q'] ?? ''));
        if ($q !== '') {
            $like = '%' . addcslashes($q, '%_\\') . '%';
            $where[] = '(m.name LIKE ? OR m.email LIKE ? OR m.subject LIKE ? OR m.message LIKE ?)';
            array_push($args, $like, $like, $like, $like);
        }
        $st = $pdo->prepare(
            "SELECT m.*, CONCAT_WS(' ', r.first_name, r.last_name) AS read_by_name, u.id AS account_id, u.role AS account_role
             FROM messages m LEFT JOIN users r ON r.id = m.read_by LEFT JOIN users u ON u.email = m.email"
            . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY m.created_at DESC, m.id DESC LIMIT 500'
        );
        $st->execute($args);
        $c = $pdo->query(
            "SELECT COUNT(*) AS total, COALESCE(SUM(is_read = 0), 0) AS unread,
                    COALESCE(SUM(kind = 'contact'), 0) AS contact, COALESCE(SUM(kind = 'password_reset'), 0) AS resets FROM messages"
        )->fetch();
        json_out(['messages' => array_map('msg_out', $st->fetchAll()), 'counts' => array_map('intval', $c)]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fail('Method not allowed.', 405);
    }
    $d = read_json();
    $action = field($d, 'action');
    $id = (int) ($d['id'] ?? 0);

    if ($action === 'mark_all_read') {
        $pdo->prepare('UPDATE messages SET is_read = 1, read_by = ?, read_at = NOW() WHERE is_read = 0')->execute([$staff['id']]);
        json_out([]);
    }
    if ($action === 'mark_read') {
        if (!empty($d['read'])) {
            $pdo->prepare('UPDATE messages SET is_read = 1, read_by = ?, read_at = NOW() WHERE id = ?')->execute([$staff['id'], $id]);
        } else {
            $pdo->prepare('UPDATE messages SET is_read = 0, read_by = NULL, read_at = NULL WHERE id = ?')->execute([$id]);
        }
        json_out([]);
    }
    if ($action === 'delete') {
        if ($staff['role'] !== 'admin') {
            fail('Only an administrator can delete a message.', 403);
        }
        $pdo->prepare('DELETE FROM messages WHERE id = ?')->execute([$id]);
        json_out([]);
    }
    fail('Unknown action.');
}

/**
 * Names offered in the "Dentist" drop-downs.
 */
function admin_dentists(): void
{
    require_staff();
    $st = db()->query("SELECT last_name FROM users WHERE role = 'dentist' AND is_active = 1 ORDER BY last_name");
    $names = [];
    foreach ($st->fetchAll() as $r) {
        $names['Dr. ' . $r['last_name']] = true;
    }
    if (!$names) {
        $names['Dr. Calumpit'] = true;
    }
    json_out(['dentists' => array_keys($names)]);
}

start_session();
switch ($_GET['r'] ?? '') {
    case 'stats':        admin_stats();        break;
    case 'appointments': admin_appointments(); break;
    case 'patients':     admin_patients();     break;
    case 'records':      admin_records();      break;
    case 'record_file':  admin_record_file();  break;
    case 'treatments':   admin_treatments();   break;
    case 'billing':      admin_billing();      break;
    case 'reports':      admin_reports();      break;
    case 'users':        admin_users();        break;
    case 'messages':     admin_messages();     break;
    case 'dentists':     admin_dentists();     break;
    default:             fail('Unknown section.', 404);
}
