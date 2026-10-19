<?php
// Accounts: session, login, logout, register, forgot password, change password.
//   auth.php?action=session | login | logout | register | forgot | password
require __DIR__ . '/config.php';



/**
 * Who is signed in (used by every page).
 */
function auth_session(): void
{
    $u = current_user();
    json_out(['loggedIn' => (bool) $u, 'user' => $u ? public_user($u) : null]);
}

/**
 * Sign in (username or email) with a lockout after repeated failures.
 */
function auth_login(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fail('Method not allowed.', 405);
    }
    $d = read_json();

    $id = field($d, 'identifier');
    $password = isset($d['password']) && is_string($d['password']) ? $d['password'] : '';
    if ($id === '' || $password === '') {
        fail('Please enter your username/email and password.');
    }

    // Slow down password guessing: too many recent failures for this account from this address
    $pdo = db();
    $ip = client_ip();
    $idKey = strtolower(substr($id, 0, 150));
    $fails = $pdo->prepare('SELECT COUNT(*) FROM login_attempts WHERE identifier = ? AND ip = ? AND attempted_at >= (NOW() - INTERVAL 15 MINUTE)');
    $fails->execute([$idKey, $ip]);
    if ((int) $fails->fetchColumn() >= LOGIN_MAX_FAILS) {
        fail('Too many failed attempts. Please wait 15 minutes and try again, or use "Forgot password?".', 429);
    }

    $st = db()->prepare('SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1');
    $st->execute([$id, strtolower($id)]);
    $u = $st->fetch();

    if (!$u || !password_verify($password, $u['password_hash'])) {
        usleep(400000);
        $pdo->prepare('INSERT INTO login_attempts (ip, identifier) VALUES (?, ?)')->execute([$ip, $idKey]);
        $pdo->exec('DELETE FROM login_attempts WHERE attempted_at < (NOW() - INTERVAL 1 DAY)');
        fail('Incorrect username/email or password.', 401);
    }

    if (password_needs_rehash($u['password_hash'], PASSWORD_DEFAULT)) {
        db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
            ->execute([password_hash($password, PASSWORD_DEFAULT), $u['id']]);
    }

    $pdo->prepare('DELETE FROM login_attempts WHERE identifier = ? AND ip = ?')->execute([$idKey, $ip]);
    if (!(int) $u['is_active']) {
        fail('This account has been deactivated. Please contact the clinic.', 403);
    }

    session_regenerate_id(true);
    $_SESSION['uid'] = (int) $u['id'];
    db()->prepare('UPDATE users SET last_login = NOW() WHERE id = ?')->execute([$u['id']]);

    if (!empty($d['remember'])) {
        setcookie(session_name(), session_id(), [
            'expires' => time() + 60 * 60 * 24 * 30, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax',
        ]);
    }

    json_out(['user' => public_user($u)]);
}

/**
 * Sign out.
 */
function auth_logout(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fail('Method not allowed.', 405);
    }
    read_json();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => $p['path'], 'httponly' => true, 'samesite' => 'Lax']);
    }
    session_destroy();
    json_out([]);
}

/**
 * Create a patient account and sign the patient in.
 */
function auth_register(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fail('Method not allowed.', 405);
    }
    $d = read_json();

    $p = validate_profile($d, true);

    $username = field($d, 'username');
    check_username($username);

    $password = isset($d['password']) && is_string($d['password']) ? $d['password'] : '';
    check_password_rules($password);
    if ($password !== ($d['confirmPassword'] ?? null)) {
        fail('Passwords do not match!');
    }

    assert_unique($username, $p['email']);

    $pdo = db();
    try {
        $ins = $pdo->prepare(
            "INSERT INTO users (first_name, middle_name, last_name, gender, birth_date, email, phone, address, username, password_hash, role)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'patient')"
        );
        $ins->execute([
            $p['first'], $p['middle'], $p['last'], $p['gender'], $p['birth'], $p['email'], $p['phone'], $p['address'],
            $username, password_hash($password, PASSWORD_DEFAULT),
        ]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') {
            fail('That username or email is already registered.', 409);
        }
        throw $e;
    }

    // Creating an account signs the patient in right away.
    session_regenerate_id(true);
    $_SESSION['uid'] = (int) $pdo->lastInsertId();
    $pdo->prepare('UPDATE users SET last_login = NOW() WHERE id = ?')->execute([$_SESSION['uid']]);
    json_out(['user' => public_user(current_user())], 201);
}

/**
 * "Forgot password": notify the clinic (shown in Admin > Messages).
 * Public: "Forgot password?" The clinic gets a request in Messages and issues a temporary password.
 * (Emailing reset links needs a mail server, which a stock XAMPP does not have.)
 */
function auth_forgot(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fail('Method not allowed.', 405);
    }
    $d = read_json();
    $email = strtolower(field($d, 'email'));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 150) {
        fail('Please enter the email address on your account.');
    }

    $pdo = db();
    if (!message_rate_ok($pdo)) {
        fail('Too many requests. Please try again later, or call the clinic.', 429);
    }
    $st = $pdo->prepare('SELECT first_name, last_name, username FROM users WHERE email = ?');
    $st->execute([$email]);
    $u = $st->fetch();

    // Same answer whether or not the account exists, so this can't be used to find out who is registered.
    if ($u) {
        $pdo->prepare("INSERT INTO messages (kind, name, email, subject, message, ip) VALUES ('password_reset', ?, ?, 'Password reset request', ?, ?)")
            ->execute([$u['first_name'] . ' ' . $u['last_name'], $email, 'Requested a password reset for username "' . $u['username'] . '". Verify their identity, then reset it from Patients (or Users).', client_ip()]);
    }
    json_out(['message' => 'If that email belongs to an account, the clinic has been notified and will contact you with a temporary password.']);
}

/**
 * Signed-in user changes their own password.
 * Any signed-in user changes their own password.
 */
function auth_password(): void
{
    $user = require_login();
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fail('Method not allowed.', 405);
    }
    $d = read_json();
    $current = is_string($d['current'] ?? null) ? $d['current'] : '';
    $new = is_string($d['password'] ?? null) ? $d['password'] : '';

    if (!password_verify($current, $user['password_hash'])) {
        usleep(400000);
        fail('Your current password is incorrect.', 403);
    }
    check_password_rules($new);
    if ($new !== ($d['confirmPassword'] ?? null)) {
        fail('The new passwords do not match.');
    }
    if ($new === $current) {
        fail('Choose a password that is different from the current one.');
    }
    db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        ->execute([password_hash($new, PASSWORD_DEFAULT), $user['id']]);
    json_out([]);
}

start_session();
switch ($_GET['action'] ?? '') {
    case 'session':  auth_session();  break;
    case 'login':    auth_login();    break;
    case 'logout':   auth_logout();   break;
    case 'register': auth_register(); break;
    case 'forgot':   auth_forgot();   break;
    case 'password': auth_password(); break;
    default:         fail('Unknown action.', 404);
}
