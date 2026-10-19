<?php
// Photo gallery: everything in media/gallery/ (no upload page, no database).
//   gallery.php?limit=60&offset=0   list of photos (public)
//   gallery.php?thumb=photo.jpg      small version of a photo (created once, then cached)
// Thumbnails deliberately do not start a session, so many can load at the same time.
require __DIR__ . '/config.php';

function gallery_dir(): string
{
    return dirname(__DIR__) . '/media/gallery';
}

function gallery_is_photo(string $name): bool
{
    return $name !== '' && $name[0] !== '.' && (bool) preg_match('/^[^\/\\\\]+\.(jpe?g|png|webp)$/i', $name);
}

/** Photo file names, in natural order (name them 01.jpg, 02.jpg ... to control the order). */
function gallery_files(): array
{
    $dir = gallery_dir();
    if (!is_dir($dir)) {
        return [];
    }
    $files = array_values(array_filter(scandir($dir) ?: [], 'gallery_is_photo'));
    natcasesort($files);
    return array_values($files);
}

function gallery_thumb_name(string $file): string
{
    return pathinfo($file, PATHINFO_FILENAME) . '.jpg';
}

/** "clinic-reception.jpg" -> "Clinic reception"; camera names like IMG_1234 get no caption. */
function gallery_caption(string $file): ?string
{
    $base = pathinfo($file, PATHINFO_FILENAME);
    if (preg_match('/^(img|dsc|dscn|pxl|photo|image|screenshot|whatsapp|\d)/i', $base) || strlen($base) < 3) {
        return null;
    }
    $t = trim(preg_replace('/\s+/', ' ', str_replace(['-', '_'], ' ', $base)));
    return $t === '' ? null : mb_strtoupper(mb_substr($t, 0, 1)) . mb_substr($t, 1);
}

/** Makes a small JPEG thumbnail (needs GD; returns false when it can't). */
function gallery_make_thumb(string $src, string $dst, int $maxW = 520): bool
{
    if (!function_exists('imagecreatetruecolor')) {
        return false;
    }
    $info = @getimagesize($src);
    if (!$info) {
        return false;
    }
    [$w, $h, $type] = $info;
    $im = false;
    if ($type === IMAGETYPE_JPEG && function_exists('imagecreatefromjpeg')) {
        $im = @imagecreatefromjpeg($src);
    } elseif ($type === IMAGETYPE_PNG && function_exists('imagecreatefrompng')) {
        $im = @imagecreatefrompng($src);
    } elseif ($type === IMAGETYPE_WEBP && function_exists('imagecreatefromwebp')) {
        $im = @imagecreatefromwebp($src);
    }
    if (!$im) {
        return false;
    }
    // Phone photos: respect the EXIF rotation so thumbnails aren't sideways.
    if ($type === IMAGETYPE_JPEG && function_exists('exif_read_data') && function_exists('imagerotate')) {
        $exif = @exif_read_data($src);
        $angle = [3 => 180, 6 => -90, 8 => 90][(int) ($exif['Orientation'] ?? 1)] ?? 0;
        if ($angle) {
            $rot = imagerotate($im, $angle, 0);
            if ($rot) {
                imagedestroy($im);
                $im = $rot;
                $w = imagesx($im);
                $h = imagesy($im);
            }
        }
    }
    $tw = min($maxW, $w);
    $th = max(1, (int) round($h * $tw / $w));
    $t = imagecreatetruecolor($tw, $th);
    imagefill($t, 0, 0, imagecolorallocate($t, 255, 255, 255));
    imagecopyresampled($t, $im, 0, 0, 0, 0, $tw, $th, imagesx($im), imagesy($im));
    $ok = imagejpeg($t, $dst, 82);
    imagedestroy($im);
    imagedestroy($t);
    return (bool) $ok;
}

/**
 * Public: photos for the landing page.
 */
function gallery_list(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        fail('Method not allowed.', 405);
    }
    $limit = max(1, min(200, (int) ($_GET['limit'] ?? 60)));
    $offset = max(0, (int) ($_GET['offset'] ?? 0));
    $files = gallery_files();
    $hasGd = function_exists('imagecreatetruecolor');

    $images = [];
    foreach (array_slice($files, $offset, $limit) as $i => $f) {
        $src = 'media/gallery/' . rawurlencode($f);
        $thumbFile = gallery_thumb_name($f);
        if (is_file(gallery_dir() . '/thumbs/' . $thumbFile)) {
            $thumb = 'media/gallery/thumbs/' . rawurlencode($thumbFile);   // already cached: served directly
        } else {
            $thumb = $hasGd ? 'api/gallery.php?thumb=' . rawurlencode($f) : $src;   // made the first time it is viewed
        }
        $images[] = ['id' => $offset + $i + 1, 'src' => $src, 'thumb' => $thumb, 'caption' => gallery_caption($f)];
    }
    json_out(['images' => $images, 'total' => count($files)]);
}

/**
 * Serves (and creates, once) the small version of a photo.
 */
function gallery_thumb(): void
{
    $f = basename((string) ($_GET['thumb'] ?? ''));
    $src = gallery_dir() . '/' . $f;
    if (!gallery_is_photo($f) || !is_file($src)) {
        http_response_code(404);
        exit;
    }

    $thumbDir = gallery_dir() . '/thumbs';
    $thumb = $thumbDir . '/' . gallery_thumb_name($f);
    if (!is_file($thumb)) {
        if (!is_dir($thumbDir)) {
            @mkdir($thumbDir, 0775, true);
        }
        // One thumbnail at a time: big photos use a lot of memory to decode.
        $lock = @fopen($thumbDir . '/.lock', 'c');
        if ($lock) {
            flock($lock, LOCK_EX);
        }
        if (!is_file($thumb)) {
            @set_time_limit(60);
            gallery_make_thumb($src, $thumb);
        }
        if ($lock) {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    $file = is_file($thumb) ? $thumb : $src;       // fall back to the original if GD can't make a thumbnail
    $mime = $file === $src ? (getimagesize($src)['mime'] ?? 'image/jpeg') : 'image/jpeg';
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . filesize($file));
    header('Cache-Control: public, max-age=604800');
    readfile($file);
}

if (isset($_GET['thumb'])) {
    gallery_thumb();
} else {
    gallery_list();
}
