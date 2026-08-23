<?php

declare(strict_types=1);

umask(0077);

use Egoe\Leads\Endpoint;
use Egoe\Leads\HttpFailure;

require __DIR__ . '/lib/LeadBackend.php';

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, private, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Frame-Options: DENY');
header('Content-Security-Policy: default-src \'none\'; frame-ancestors \'none\'; base-uri \'none\'');

try {
    $result = Endpoint::handle($_SERVER, $_POST, $_FILES);
    http_response_code($result['status']);
    echo json_encode($result['body'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
} catch (HttpFailure $error) {
    http_response_code($error->status);
    if ($error->status === 405) {
        header('Allow: POST');
    }
    echo json_encode([
        'ok' => false,
        'code' => $error->publicCode,
        'message' => $error->getMessage(),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
} catch (Throwable) {
    http_response_code(500);
    echo '{"ok":false,"code":"SERVER_ERROR","message":"Сервис временно недоступен. Повторите позднее."}';
}
