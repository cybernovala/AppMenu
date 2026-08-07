const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const DB_FILE = path.join(__dirname, 'database.json');
let db = {};

if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    db = {};
  }
}

function guardarEnDisco() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let pedidosTemp = {};

// ------------------- RUTAS DE MENÚ Y PEDIDOS -------------------

app.get('/api/menu', (req, res) => {
  const { local } = req.query;
  const localData = db[local] || { menu: [] };
  res.json(localData.menu || []);
});

app.post('/api/menu', (req, res) => {
  const { local, password, menu } = req.body;
  if (!db[local]) return res.status(404).json({ error: 'El restaurante no existe.' });
  if (db[local].password !== password) return res.status(403).json({ error: 'Contraseña incorrecta.' });

  db[local].menu = menu;
  guardarEnDisco();
  res.json({ mensaje: 'Menú actualizado correctamente.' });
});

app.post('/api/pedidos', (req, res) => {
  const { local, mesa, items, total } = req.body;
  
  if (db[local] && db[local].fechaVencimiento) {
    const hoy = new Date();
    const vencimiento = new Date(db[local].fechaVencimiento);
    if (hoy > vencimiento) {
      return res.status(402).json({ error: 'El servicio de este restaurante se encuentra suspendido por mantenimiento.' });
    }
  }

  if (!pedidosTemp[local]) pedidosTemp[local] = [];

  const nuevoPedido = {
    id: Date.now(),
    mesa,
    items,
    total,
    estado: 'pendiente',
    hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
  };

  pedidosTemp[local].unshift(nuevoPedido);
  res.json({ mensaje: 'Pedido recibido', pedido: nuevoPedido });
});

app.get('/api/pedidos', (req, res) => {
  const { local } = req.query;
  res.json(pedidosTemp[local] || []);
});

// ------------------- RUTAS PARA EL GARZÓN -------------------

app.get('/api/pedidos/garzon', (req, res) => {
  const { local } = req.query;
  res.json(pedidosTemp[local] || []);
});

app.post('/api/pedidos/entregar', (req, res) => {
  const { local, id } = req.body;
  if (!pedidosTemp[local]) return res.status(404).json({ error: 'No hay pedidos' });

  const idx = pedidosTemp[local].findIndex(p => p.id === id);
  if (idx !== -1) {
    pedidosTemp[local].splice(idx, 1); // Lo elimina de cocina y garzón
    return res.json({ mensaje: 'Pedido entregado en mesa' });
  }
  res.status(404).json({ error: 'Pedido no encontrado' });
});

// ------------------- RUTAS DE SUSCRIPCIÓN Y SUPERADMIN -------------------

app.get('/api/suscripcion', (req, res) => {
  const { local } = req.query;
  if (!db[local]) return res.status(404).json({ error: 'Local no encontrado' });

  const hoy = new Date();
  const fechaVenc = new Date(db[local].fechaVencimiento || hoy);
  const diffTiempo = fechaVenc - hoy;
  const diasRestantes = Math.ceil(diffTiempo / (1000 * 60 * 60 * 24));

  res.json({
    fechaVencimiento: db[local].fechaVencimiento,
    diasRestantes,
    alerta: diasRestantes <= 2 && diasRestantes >= 0,
    vencido: diasRestantes < 0
  });
});

app.post('/api/superadmin/crear-local', (req, res) => {
  const { claveSuperAdmin, local, passwordCliente } = req.body;
  if (claveSuperAdmin !== 'superadmin123') return res.status(403).json({ error: 'Clave Maestra incorrecta' });

  const hoy = new Date();
  const vencimiento = new Date();
  vencimiento.setDate(hoy.getDate() + 30);

  db[local] = {
    password: passwordCliente,
    fechaCreacion: hoy.toISOString().split('T')[0],
    fechaVencimiento: vencimiento.toISOString().split('T')[0],
    menu: []
  };

  guardarEnDisco();
  res.json({ mensaje: 'Restaurante creado con éxito', fechaVencimiento: db[local].fechaVencimiento });
});

app.post('/api/superadmin/renovar-pago', (req, res) => {
  const { claveSuperAdmin, local } = req.body;
  if (claveSuperAdmin !== 'superadmin123') return res.status(403).json({ error: 'Clave Maestra incorrecta' });
  if (!db[local]) return res.status(404).json({ error: 'Local no encontrado' });

  const hoy = new Date();
  let fechaBase = new Date(db[local].fechaVencimiento);
  
  if (isNaN(fechaBase.getTime()) || fechaBase < hoy) {
    fechaBase = new Date();
  }
  
  fechaBase.setDate(fechaBase.getDate() + 30);
  db[local].fechaVencimiento = fechaBase.toISOString().split('T')[0];

  guardarEnDisco();
  res.json({ mensaje: 'Pago registrado con éxito', nuevaFecha: db[local].fechaVencimiento });
});

app.get('/api/superadmin/backup', (req, res) => {
  const { clave } = req.query;
  if (clave !== 'superadmin123') return res.status(403).json({ error: 'Clave Maestra incorrecta' });
  res.json(db);
});

app.post('/api/superadmin/restore', (req, res) => {
  const { clave, backupData } = req.body;
  if (clave !== 'superadmin123') return res.status(403).json({ error: 'Clave Maestra incorrecta' });

  db = backupData;
  guardarEnDisco();
  res.json({ mensaje: 'Base de datos restaurada correctamente' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor iniciado en puerto ${PORT}`));