<?php
// Public: the landing-page contact form. Messages are stored for the admin to read.
require __DIR__ . '/config.php';
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('Method not allowed.', 405);
}
$d = read_json();

// Hidden "website" field: real visitors leave it empty, bots fill it in.
if (field($d, 'website') !== '') {
    json_out([]);
}

const CONTACT_SUBJECTS = [
    'appointment'  => 'Book an Appointment',
    'cleaning'     => 'General Check-up & Cleaning',
    'orthodontics' => 'Orthodontics & Braces',
    'whitening'    => 'Teeth Whitening',
    'implants'     => 'Dental Implants',
    'other'        => 'Other Inquiry',
];

$name = preg_replace('/\s+/', ' ', field($d, 'name'));
if (mb_strlen($name) < 2 || mb_strlen($name) > 100) {
    fail('Please enter your full name.');
}
$email = strtolower(field($d, 'email'));
if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 150) {
    fail('Please enter a valid email address.');
}
$phone = preg_replace('/[\s\-().]/', '', field($d, 'phone'));
if (!preg_match('/^\+?[0-9]{7,15}$/', $phone)) {
    fail('Please enter a valid phone number.');
}
$key = field($d, 'subject');
if (!isset(CONTACT_SUBJECTS[$key])) {
    fail('Please choose what your message is about.');
}
$message = field($d, 'message');
if (mb_strlen($message) < 5) {
    fail('Please write a message.');
}
if (mb_strlen($message) > 2000) {
    fail('Your message is too long (2000 characters max).');
}

$pdo = db();
if (!message_rate_ok($pdo)) {
    fail('You have sent several messages already. Please try again later, or call the clinic.', 429);
}
$pdo->prepare(
    "INSERT INTO messages (kind, name, email, phone, subject, message, ip) VALUES ('contact', ?, ?, ?, ?, ?, ?)"
)->execute([$name, $email, $phone, CONTACT_SUBJECTS[$key], $message, client_ip()]);
json_out([], 201);
