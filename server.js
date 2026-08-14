const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json());

// --- CONEXIÓN A MONGODB ATLAS ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/appmenu';

mongoose.connect(MONGO_URI)
  .then(() => console.log('🟢 Conectado exitosamente a MongoDB'))
  .catch((err) => console.error('🔴 Error de conexión a MongoDB:', err));

// --- ESQUEMAS Y MODELOS DE MONGOOSE ---

// Configuración Global (SuperAdmin)
const configGlobalSchema = new mongoose.Schema({
  tipo: { type: String, required: true, unique: true },
  password: { type: String, required: true }
}, { collection: 'configglobals' });

const ConfigGlobal = mongoose.model('ConfigGlobal', configGlobalSchema);

// Locales (Restaurantes / Demos)
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

// Avisos / Mensajes Globales (Colección 'avisos')
const avisoSchema = new mongoose.Schema({
  destinatario: { type: String, default: 'todos' },
  asunto: { type: String, default: 'Aviso del Sistema' },
  texto: { type: String, required: true },
  fecha: { type: Date, default: Date.now }
}, { collection: 'avisos' });

const Aviso = mongoose.model('Aviso', avisoSchema);

// Auxiliar Regex
function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

// --- RUTAS DE LA API ---

// 1. LOGIN DE ADMINISTRADOR GENERAL
app.post('/api/admin/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ ok: false, error: 'Debe ingresar una contraseña' });

    const configAdmin = await ConfigGlobal.findOne({ tipo: 'superadmin' });
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

// 2. OBTENER TODOS LOS LOCALES (Para demo.html)
app.get('/api/locales', async (req, res) => {
  try {
    const locales = await Local.find().sort({ fechaCreacion: -1 });
    // Adaptar la estructura devolviendo 'localId' para compatibilidad con demo.html
    const localesFormateados = locales.map(l => ({
      _id: l._id,
      id: l.id,
      localId: l.local,
      local: l.local,
      nombre: l.nombre,
      rut: l.rut,
      correo: l.correo,
      activo: l.activo,
      fechaCreacion: l.fechaCreacion,
      fechaVencimiento: l.fechaVencimiento
    }));
    res.json(localesFormateados);
  } catch (error) {
    console.error("Error al obtener locales:", error);
    res.status(500).json({ error: 'Error interno en el servidor' });
  }
});

// 3. CREAR LOCAL DEMO RÁPIDO (Ruta POST /api/locales)
app.post('/api/locales', async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const nombreLimpio = nombre.trim();
    const localSlug = nombreLimpio.toLowerCase().replace(/[^a-z0-9]/g, '');
    const nombreEscaped = escapeRegex(nombreLimpio);

    const existe = await Local.findOne({
      $or: [{ local: localSlug }, { nombre: { $regex: new RegExp(`^${nombreEscaped}$`, 'i') } }]
    });

    if (existe) return res.status(400).json({ error: 'El nombre de este local ya está registrado' });

    const ahora = new Date();
    const fechaVencimiento = new Date();
    fechaVencimiento.setDate(ahora.getDate() + 30);

    const nuevoLocal = new Local({
      id: Date.now(),
      local: localSlug,
      nombre: nombreLimpio,
      rut: 'DEMO-30DIAS',
      correo: 'demo@appmenu.cl',
      password: '123',
      activo: true,
      fechaCreacion: ahora,
      fechaVencimiento: fechaVencimiento,
      menu: [],
      anuncio: "ok"
    });

    await nuevoLocal.save();
    res.status(201).json({ mensaje: 'Local creado con éxito', local: localSlug, localId: localSlug, nombre: nombreLimpio });
  } catch (error) {
    console.error("Error al crear local demo:", error);
    res.status(500).json({ error: 'Error interno en el servidor' });
  }
});

// 4. DAR DE ALTA UN RESTAURANTE
app.post('/api/locales/alta', async (req, res) => {
  try {
    const { nombre, rut, correo, password } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const nombreLimpio = nombre.trim();
    const localSlug = nombreLimpio.toLowerCase().replace(/[^a-z0-9]/g, '');
    const nombreEscaped = escapeRegex(nombreLimpio);

    const existe = await Local.findOne({
      $or: [{ local: localSlug }, { nombre: { $regex: new RegExp(`^${nombreEscaped}$`, 'i') } }]
    });

    if (existe) return res.status(400).json({ error: 'Este local ya existe' });

    const ahora = new Date();
    const fechaVencimiento = new Date();
    fechaVencimiento.setDate(ahora.getDate() + 365); // 1 año de licencia oficial

    const nuevoLocal = new Local({
      id: Date.now(),
      local: localSlug,
      nombre: nombreLimpio,
      rut: rut || 'SIN-RUT',
      correo: correo || 'contacto@local.cl',
      password: password || '123456',
      activo: true,
      fechaCreacion: ahora,
      fechaVencimiento: fechaVencimiento,
      menu: [],
      anuncio: "ok"
    });

    await nuevoLocal.save();
    res.status(201).json({ mensaje: 'Alta realizada con éxito', local: localSlug, localId: localSlug, nombre: nombreLimpio });
  } catch (error) {
    console.error("Error al dar de alta:", error);
    res.status(500).json({ error: 'Error interno al procesar el alta' });
  }
});

// 5. CAMBIAR ESTADO DE LICENCIA (Bloquear / Desbloquear)
app.patch('/api/locales/:localId/licencia', async (req, res) => {
  try {
    const { localId } = req.params;
    const { activo } = req.body;

    const local = await Local.findOneAndUpdate({ local: localId }, { activo }, { new: true });
    if (!local) return res.status(404).json({ error: 'Local no encontrado' });

    res.json({ ok: true, mensaje: 'Estado actualizado correctamente', local });
  } catch (error) {
    res.status(500).json({ error: 'Error al cambiar licencia' });
  }
});

// 6. RECUPERAR / REENVIAR CLAVE
app.post('/api/locales/recuperar', async (req, res) => {
  try {
    const { correo } = req.body;
    const local = await Local.findOne({ correo: correo.trim() });
    if (!local) return res.status(404).json({ error: 'No existe un local registrado con ese correo' });

    res.json({ ok: true, password: local.password });
  } catch (error) {
    res.status(500).json({ error: 'Error al buscar credenciales' });
  }
});

app.post('/api/locales/reenviar-clave', async (req, res) => {
  try {
    const { local } = req.body;
    const reg = await Local.findOne({ local });
    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    res.json({ ok: true, mensaje: `La clave del local "${reg.nombre}" es: ${reg.password}` });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener la clave' });
  }
});

// 7. OBTENER AVISOS (Para mensajes.html)
app.get('/api/avisos', async (req, res) => {
  try {
    const avisos = await Aviso.find().sort({ fecha: -1 });
    res.json(avisos);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los avisos' });
  }
});

// 8. PUBLICAR AVISO
app.post('/api/avisos', async (req, res) => {
  try {
    const { destinatario, asunto, texto } = req.body;
    if (!texto) return res.status(400).json({ error: 'El contenido del aviso es requerido' });

    const nuevoAviso = new Aviso({ destinatario, asunto, texto });
    await nuevoAviso.save();
    res.status(201).json({ ok: true, aviso: nuevoAviso });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar el aviso' });
  }
});

// 9. ELIMINAR AVISO
app.delete('/api/avisos/:id', async (req, res) => {
  try {
    await Aviso.findByIdAndDelete(req.params.id);
    res.json({ ok: true, mensaje: 'Aviso eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar el aviso' });
  }
});

// PUERTO DEL SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`);
});
