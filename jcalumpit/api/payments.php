<?php
// Patient payments.
//   payments.php?action=billing   my billed / paid / balance + payment history
//   payments.php?action=start     start an online payment (PayMongo checkout)
//   payments.php?action=verify    confirm a payment with the provider
require __DIR__ . '/config.php';



/**
 * My billed / paid / still owed, plus payment history.
 * Patient endpoint: how much I've been billed / paid / still owe, plus my payment history.
 */
function pay_billing(): void
{
    $user = require_login();
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        fail('Method not allowed.', 405);
    }

    $st = db()->prepare(
        'SELECT p.id, p.amount, p.method, p.reference, p.paid_at, a.id AS appt_id, a.service, a.appt_date, a.status
         FROM payments p JOIN appointments a ON a.id = p.appointment_id
         WHERE p.user_id = ? ORDER BY p.paid_at DESC, p.id DESC LIMIT 100'
    );
    $st->execute([$user['id']]);

    $payments = [];
    foreach ($st->fetchAll() as $p) {
        $payments[] = [
            'id' => (int) $p['id'], 'amount' => money($p['amount']), 'method' => $p['method'],
            'reference' => $p['reference'], 'paidAt' => $p['paid_at'], 'appointmentId' => (int) $p['appt_id'],
            'service' => $p['service'], 'apptDate' => $p['appt_date'], 'apptStatus' => $p['status'],
        ];
    }
    json_out(['summary' => billing_totals((int) $user['id']), 'payments' => $payments]);
}

/**
 * Start an online payment for the unpaid balance of one invoice.
 * Patient starts an online payment for the unpaid balance of one of their invoices.
 * The amount is always worked out here on the server, never taken from the browser.
 */
function pay_start(): void
{
    $user = require_login();
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fail('Method not allowed.', 405);
    }
    $d = read_json();
    if (!pay_enabled()) {
        fail('Online payment is not available right now. You can pay at the clinic.', 503);
    }

    $pdo = db();
    $st = $pdo->prepare('SELECT ' . APPT_COLS . ' FROM appointments a JOIN users u ON u.id = a.user_id WHERE a.id = ? AND a.user_id = ?');
    $st->execute([(int) ($d['appointmentId'] ?? 0), $user['id']]);
    $a = $st->fetch();
    if (!$a) {
        fail('Appointment not found.', 404);
    }
    $due = pay_amount_due($a);
    if ($due <= 0) {
        fail('There is nothing to pay for this appointment.', 409);
    }
    if ($due < 1) {
        fail('The amount is too small to pay online.', 409);
    }

    // Any earlier unfinished checkout for this appointment is replaced by the new one.
    $pdo->prepare("UPDATE payment_sessions SET status = 'cancelled' WHERE appointment_id = ? AND status = 'pending'")->execute([$a['id']]);

    $token = bin2hex(random_bytes(16));
    $pdo->prepare("INSERT INTO payment_sessions (token, user_id, appointment_id, provider, amount) VALUES (?, ?, ?, 'paymongo', ?)")
        ->execute([$token, $user['id'], $a['id'], $due]);
    $sid = (int) $pdo->lastInsertId();
    $base = app_base_url();
    $page = (($d['returnTo'] ?? '') === 'appointment') ? 'appointment' : 'dashboard';   // page to come back to after paying

    try {
        $r = paymongo_request('POST', '/v1/checkout_sessions', ['data' => ['attributes' => [
            'description'          => 'Dental bill — ' . $a['service'] . ' on ' . $a['appt_date'],
            'line_items'           => [[
                'name'     => 'Balance: ' . $a['service'],
                'amount'   => (int) round($due * 100),
                'currency' => 'PHP',
                'quantity' => 1,
            ]],
            'payment_method_types' => PAYMENT_METHODS,
            'success_url'          => $base . '/' . $page . '.html?pay=' . $token,
            'cancel_url'           => $base . '/' . $page . '.html?pay=' . $token . '&cancelled=1',
            'reference_number'     => 'APPT-' . $a['id'] . '-' . $sid,
            'send_email_receipt'   => false,
            'billing'              => ['name' => $a['patient_name'], 'email' => $a['email']],
            'metadata'             => ['appointment_id' => (string) $a['id'], 'session' => (string) $sid],
        ]]]);
        $cs = $r['data']['id'] ?? '';
        $url = $r['data']['attributes']['checkout_url'] ?? '';
        if ($cs === '' || $url === '') {
            throw new RuntimeException('The payment provider did not return a checkout link.');
        }
    } catch (RuntimeException $e) {
        $pdo->prepare("UPDATE payment_sessions SET status = 'cancelled' WHERE id = ?")->execute([$sid]);
        fail($e->getMessage(), 502);
    }
    $pdo->prepare('UPDATE payment_sessions SET provider_session_id = ? WHERE id = ?')->execute([$cs, $sid]);
    json_out(['checkoutUrl' => $url, 'token' => $token, 'amount' => $due]);
}

/**
 * Confirm payments with the provider (never trusts the browser redirect).
 * Confirms payments with the provider (never trusts the browser redirect).
 * POST {token}  -> status of that checkout       POST {} -> re-check all of my unfinished checkouts
 */
function pay_verify(): void
{
    $user = require_login();
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fail('Method not allowed.', 405);
    }
    $d = read_json();
    $pdo = db();
    $token = field($d, 'token');

    if ($token !== '') {
        $st = $pdo->prepare('SELECT * FROM payment_sessions WHERE token = ? AND user_id = ?');
        $st->execute([$token, $user['id']]);
        $s = $st->fetch();
        if (!$s) {
            fail('Payment not found.', 404);
        }
        $problem = null;
        try {
            $status = pay_verify_session($pdo, $s);
        } catch (RuntimeException $e) {
            $status = $s['status'];
            $problem = $e->getMessage();
        }
        $st->execute([$token, $user['id']]);
        $s = $st->fetch();
        $ap = $pdo->prepare('SELECT service, appt_date, appt_time, status FROM appointments WHERE id = ?');
        $ap->execute([$s['appointment_id']]);
        $a = $ap->fetch() ?: [];
        json_out(['payment' => session_out($s) + ['appointment' => $a ? [
            'service' => $a['service'], 'date' => $a['appt_date'], 'timeLabel' => time_label($a['appt_time']), 'status' => $a['status'],
        ] : null], 'problem' => $problem]);
    }

    // Reconcile anything left unfinished (e.g. the patient closed the tab after paying).
    $st = $pdo->prepare("SELECT * FROM payment_sessions WHERE user_id = ? AND status = 'pending' AND provider = 'paymongo' AND created_at >= (NOW() - INTERVAL 3 DAY) ORDER BY id DESC LIMIT 5");
    $st->execute([$user['id']]);
    $paid = 0;
    foreach ($st->fetchAll() as $s) {
        try {
            if (pay_verify_session($pdo, $s) === 'paid') {
                $paid++;
            }
        } catch (RuntimeException $e) {
            break;
        }
    }
    json_out(['paid' => $paid]);
}

start_session();
switch ($_GET['action'] ?? '') {
    case 'billing': pay_billing(); break;
    case 'start':   pay_start();   break;
    case 'verify':  pay_verify();  break;
    default:        fail('Unknown action.', 404);
}
