const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const ARCHIVO_PEDIDOS = path.join(__dirname, 'pedidos.json');
const ARCHIVO_MENU = path.join(__dirname, 'menu.json');

// Menú por defecto si el archivo no existe aún
const MENU_INICIAL = [
  {
    categoria: "Completos",
    productos: [
      { id: "1", nombre: "Completo Italiano", precio: 2990 },
      { id: "2", nombre: "Completo Palta", precio: 2990 }
    ]
  }
];

const obtenerDatos = (archivo, porDefecto) => {
  if (!fs.existsSync(archivo)) return porDefecto;
  const data = fs.readFileSync(archivo, 'utf-8');
  return data ? JSON.parse(data) : porDefecto;
};

const guardarDatos = (archivo, datos) => {
  fs.writeFileSync(archivo, JSON.stringify(datos, null, 2));
};

// --- RUTAS DE PEDIDOS ---
app.get('/api/pedidos', (req, res) => {
  res.json(obtenerDatos(ARCHIVO_PEDIDOS, []));
});

app.post('/api/pedidos', (req, res) => {
  const { mesa, items, total } = req.body;
  if (!mesa || !items || items.length === 0) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  const pedidos = obtenerDatos(ARCHIVO_PEDIDOS, []);
  const nuevoPedido = {
    id: Date.now(),
    mesa,
    items,
    total,
    estado: 'Pendiente',
    hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
  };

  pedidos.push(nuevoPedido);
  guardarDatos(ARCHIVO_PEDIDOS, pedidos);
  res.status(201).json({ mensaje: 'Pedido recibido', pedido: nuevoPedido });
});

app.patch('/api/pedidos/:id', (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  let pedidos = obtenerDatos(ARCHIVO_PEDIDOS, []);
  const index = pedidos.findIndex(p => p.id == id);

  if (index !== -1) {
    if (estado === 'Eliminar') {
      pedidos.splice(index, 1);
    } else {
      pedidos[index].estado = estado;
    }
    guardarDatos(ARCHIVO_PEDIDOS, pedidos);
    return res.json({ mensaje: 'Pedido actualizado' });
  }
  res.status(404).json({ error: 'Pedido no encontrado' });
});

// --- RUTAS DEL MENÚ (ADMINISTRACIÓN) ---
app.get('/api/menu', (req, res) => {
  res.json(obtenerDatos(ARCHIVO_MENU, MENU_INICIAL));
});

app.post('/api/menu', (req, res) => {
  const { password, menu } = req.body;

  // Contraseña de acceso para guardar cambios (puedes cambiarla)
  if (password !== 'admin123') {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }

  guardarDatos(ARCHIVO_MENU, menu);
  res.json({ mensaje: 'Menú actualizado con éxito' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
