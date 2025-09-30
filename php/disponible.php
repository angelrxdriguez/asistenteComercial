<?php
header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/conexion.php';
if (!isset($conn) || !($conn instanceof mysqli)) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Conexión no disponible.']);
    exit;
}

$conn->set_charset('utf8mb4');

$sql = "
    SELECT
        id, articulo, variedad, cultivo, fecha, cliente, vuelo,
        caducidad, tiempo_outlet, ubicacion, cajas, disponible, reservado,
         es_outlet, 
        preparado
    FROM ofertas
    WHERE (cliente IS NULL OR TRIM(cliente) = '')
      AND COALESCE(disponible, 0) > 0
    ORDER BY fecha DESC, id DESC
";

$result = $conn->query($sql);

if ($result === false) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $conn->error]);
    exit;
}

$rows = $result->fetch_all(MYSQLI_ASSOC);

echo json_encode([
    'success' => true,
    'count'   => count($rows),
    'data'    => $rows
], JSON_UNESCAPED_UNICODE);
