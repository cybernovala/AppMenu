const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json());

// --- CONEXIÓN A MONGODB ATLAS ---
// Si tienes tu URL de MongoDB Atlas la puedes pegar directamente reemplazando este valor
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/appmenu';

mongoose.connect(MONGO_URI)
  .then(() => console.log('🟢 Conectado exitosamente a MongoDB'))
  .catch((err) => console.error('🔴 Error de conexión a MongoDB:', err));

// --- ESQUEMAS Y MODELOS DE MONGOOSE ---

// Esquema para la configuración global del SuperAdmin en MongoDB
const configGlobalSchema = new mongoose.Schema({
  tipo: { type: String, required: true, unique: true },
  password: { type: String, required: true }
}, { collection: 'configglobals' });

const ConfigGlobal = mongoose.model('ConfigGlobal', configGlobalSchema);

// Esquema para los Locales (Negocios / Demos)
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
}, { collection: 'locales' });

const Local = mongoose.model('Local', localSchema);

// Función auxiliar para escapar caracteres en expresiones regulares
function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

// --- RUTAS DE LA API ---

// 1. LOGIN DE ADMINISTRADOR GENERAL (Consulta primero a MongoDB en 'configglobals')
app.post('/api/admin/login', async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ ok: false, error: 'Debe ingresar una contraseña' });
    }

    // Buscar en la colección 'configglobals' la clave del SuperAdmin
    const configAdmin = await ConfigGlobal.findOne({ tipo: 'superadmin' });
    
    // Si la BD no tiene registro aún, usa la contraseña por defecto
    const claveCorrecta = configAdmin ? configAdmin.password : "@Juan20737373";

    if (password === claveCorrecta) {
      return res.json({ ok: true, mensaje: 'Acceso concedido como Administrador General' });
    } else {
      return res.status(401).json({ ok: false, error: 'Contraseña incorrecta' });
    }
  } catch (error) {
    console.error("Error en login admin:", error);
    res.status(500).json({ ok: false, error: 'Error al consultar la base de datos' });
  }
});

// 2. VERIFICAR SI UN LOCAL EXISTE
app.get('/api/locales/verificar/:busqueda', async (req, res) => {
  try {
    const termino = req.params.busqueda.trim();
    const localSlug = termino.toLowerCase().replace(/[^a-z0-9]/g, '');
    const terminoEscaped = escapeRegex(termino);

    const local = await Local.findOne({
      $or: [
        { local: localSlug },
        { nombre: { $regex: new RegExp(`^${terminoEscaped}$`, 'i') } }
      ]
    });

    if (local) {
      return res.json({ existe: true, local: local.local, nombre: local.nombre });
    } else {
      return res.status(404).json({ existe: false, error: 'El local no existe' });
    }
  } catch (error) {
    console.error("Error al verificar local:", error);
    res.status(500).json({ error: 'Error interno en el servidor' });
  }
});

// 3. CREAR UN NUEVO LOCAL DEMO (30 DÍAS)
app.post('/api/locales/alta', async (req, res) => {
  try {
    const { nombre, rut, correo, password } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre del local es obligatorio' });
    }

    const nombreLimpio = nombre.trim();
    const localSlug = nombreLimpio.toLowerCase().replace(/[^a-z0-9]/g, '');
    const nombreEscaped = escapeRegex(nombreLimpio);

    // Verificar en MongoDB si ya existe un local registrado con ese nombre
    const existe = await Local.findOne({
      $or: [
        { local: localSlug },
        { nombre: { $regex: new RegExp(`^${nombreEscaped}$`, 'i') } }
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
      nombre: nombreLimpio,
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

// PUERTO DEL SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`);
});
