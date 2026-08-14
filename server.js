const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// --- ESQUEMA Y MODELO DE MONGOOSE ---
const localSchema = new mongoose.Schema({
  id: Number,
  local: { type: String, required: true, unique: true },
  nombre: { type: String, required: true },
  rut: String,
  correo: String,
  password: { type: String, default: '123' },
  activo: { type: Boolean, default: true },
  fechaCreacion: Date,
  fechaVencimiento: Date,
  menu: Array,
  anuncio: String
});

const Local = mongoose.model('Local', localSchema, 'locales');

// --- RUTAS DE LA API ---

// 1. VERIFICAR SI UN LOCAL EXISTE (Busca por 'nombre' o por 'local' slug)
app.get('/api/locales/verificar/:busqueda', async (req, res) => {
  try {
    const termino = req.params.busqueda.trim();
    const localSlug = termino.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Busca coincidencia en 'local' O en 'nombre' (insensible a mayúsculas/minúsculas)
    const local = await Local.findOne({
      $or: [
        { local: localSlug },
        { nombre: new RegExp(`^${termino}$`, 'i') }
      ]
    });

    if (local) {
      return res.json({ existe: true, local: local.local, nombre: local.nombre });
    } else {
      return res.status(404).json({ existe: false, error: 'Local no encontrado' });
    }
  } catch (error) {
    console.error("Error al verificar local:", error);
    res.status(500).json({ error: 'Error interno en el servidor' });
  }
});

// 2. CREAR UN NUEVO LOCAL DEMO (30 DÍAS)
app.post('/api/locales/alta', async (req, res) => {
  try {
    const { nombre, rut, correo, password } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: 'El nombre del local es obligatorio' });
    }

    const localSlug = nombre.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Verificar en MongoDB por slug o por nombre
    const existe = await Local.findOne({
      $or: [
        { local: localSlug },
        { nombre: new RegExp(`^${nombre.trim()}$`, 'i') }
      ]
    });

    if (existe) {
      return res.status(400).json({ error: 'El nombre de este local ya está registrado. Intenta con otro.' });
    }

    const ahora = new Date();
    const fechaVencimiento = new Date();
    fechaVencimiento.setDate(ahora.getDate() + 30); // 30 días de prueba

    const nuevoLocal = new Local({
      id: Date.now(),
      local: localSlug,
      nombre: nombre.trim(),
      rut: rut || 'DEMO-30DIAS',
      correo: correo || 'demo@appmenu.cl',
      password: password || '123',
      activo: true,
      fechaCreacion: ahora,
      fechaVencimiento: fechaVencimiento,
      menu: [
        {
          categoria: "Entradas",
          productos: [{ nombre: "Empanada Demo", precio: 2500 }]
        }
      ],
      anuncio: "ok"
    });

    await nuevoLocal.save();

    res.status(201).json({
      mensaje: 'Local creado exitosamente con 30 días de prueba',
      local: localSlug,
      fechaVencimiento: fechaVencimiento
    });

  } catch (error) {
    console.error("Error al crear local:", error);
    res.status(500).json({ error: 'Error interno en el servidor al crear la demo' });
  }
});

// 3. LOGIN ADMINISTRADOR GENERAL (VALIDACIÓN SEGURA DESDE EL BACKEND)
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const ADMIN_PASS = "@Juan20737373"; // Contraseña protegida en backend

  if (password === ADMIN_PASS) {
    return res.json({ ok: true, mensaje: "Acceso concedido" });
  } else {
    return res.status(401).json({ ok: false, error: "Contraseña incorrecta" });
  }
});

// PUERTO DEL SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en el puerto ${PORT}`);
});
