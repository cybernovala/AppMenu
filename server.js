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
  anuncio: { type: String, default: "ok" }
}, { collection: 'locales' });

const Local = mongoose.model('Local', localSchema);

// Avisos / Mensajes Globales y Respuestas
const respuestaAvisoSchema = new mongoose.Schema({
  local: { type: String, required: true },
  texto: { type: String, required: true },
  fecha: { type: Date, default: Date.now }
});

const avisoSchema = new mongoose.Schema({
  destinatario: { type: String, default: 'todos' },
  asunto: { type: String, default: 'Aviso del Sistema' },
  texto: { type: String, required: true },
  fecha: { type: Date, default: Date.now },
  respuestas: [respuestaAvisoSchema]
}, { collection: 'avisos' });

const Aviso = mongoose.model('Aviso', avisoSchema);

// Pedidos en Cocina / Pendientes
const pedidoSchema = new mongoose.Schema({
  local: { type: String, required: true },
  mesa: { type: String, required: true },
  items: Array,
  total: { type: Number, default: 0 },
  estado: { type: String, default: 'pendiente' },
  fecha: { type: Date, default: Date.now }
}, { collection: 'pedidos', timestamps: true });

const Pedido = mongoose.model('Pedido', pedidoSchema);

// Historial de Entregas (Garzones)
const historialSchema = new mongoose.Schema({
  id: String,
  local: { type: String, required: true },
  mesa: String,
  items: Array,
  total: Number,
  estado: { type: String, default: 'entregado' },
  hora: String,
  rutGarzon: String,
  horaEntrega: String,
  fechaEntrega: String
}, { collection: 'historials', timestamps: true });

const Historial = mongoose.model('Historial', historialSchema);

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

// 2. VERIFICAR SI UN LOCAL EXISTE
app.get('/api/locales/verificar/:busqueda', async (req, res) => {
  try {
    const busquedaLimpia = req.params.busqueda.trim();
    const slugBusqueda = busquedaLimpia.toLowerCase().replace(/[^a-z0-9]/g, '');
    const regexBusqueda = new RegExp(`^${escapeRegex(busquedaLimpia)}$`, 'i');

    const reg = await Local.findOne({
      $or: [
        { local: busquedaLimpia },
        { local: slugBusqueda },
        { nombre: { $regex: regexBusqueda } }
      ]
    });

    if (reg) {
      return res.json({ existe: true, local: reg.local, nombre: reg.nombre });
    } else {
      return res.status(404).json({ existe: false, error: 'Local no encontrado' });
    }
  } catch (error) {
    console.error("Error al verificar local:", error);
    res.status(500).json({ existe: false, error: 'Error al verificar el local' });
  }
});

// 3. CONSULTAR LICENCIA Y ESTADO DE LOCAL
app.get('/api/licencia', async (req, res) => {
  try {
    const localId = (req.query.local || '').trim().toLowerCase();
    if (!localId) return res.status(400).json({ error: 'Parámetro local requerido' });

    const reg = await Local.findOne({ local: localId });
    if (!reg) {
      return res.json({ activo: true, nombre: localId, altaRegistrada: false });
    }

    const esAltaOficial = reg.rut && reg.rut !== 'DEMO-30DIAS' && reg.rut !== 'SIN-RUT';

    return res.json({
      activo: reg.activo,
      nombre: reg.nombre,
      fechaCreacion: reg.fechaCreacion,
      fechaVencimiento: reg.fechaVencimiento,
      anuncio: reg.anuncio || "ok",
      altaRegistrada: esAltaOficial
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar licencia' });
  }
});

// 4. OBTENER TODOS LOS LOCALES (ADMIN GENERAL)
app.get('/api/locales', async (req, res) => {
  try {
    const locales = await Local.find().sort({ fechaCreacion: -1 });
    const localesFormateados = locales.map(l => ({
      _id: l._id,
      id: l.id,
      localId: l.local,
      local: l.local,
      nombre: l.nombre,
      rut: l.rut,
      correo: l.correo,
      activo: l.activo,
      anuncio: l.anuncio || "ok",
      fechaCreacion: l.fechaCreacion,
      fechaVencimiento: l.fechaVencimiento
    }));
    res.json(localesFormateados);
  } catch (error) {
    res.status(500).json({ error: 'Error interno en el servidor' });
  }
});

// 5. DAR DE ALTA UN RESTAURANTE
app.post('/api/locales/alta', async (req, res) => {
  try {
    const { nombre, rut, correo, password, fechaVencimiento: fechaVencBody } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const nombreLimpio = nombre.trim();
    const localSlug = nombreLimpio.toLowerCase().replace(/[^a-z0-9]/g, '');
    const nombreEscaped = escapeRegex(nombreLimpio);

    let reg = await Local.findOne({
      $or: [{ local: localSlug }, { nombre: { $regex: new RegExp(`^${nombreEscaped}$`, 'i') } }]
    });

    const ahora = new Date();
    
    let fechaVencimientoCalculada;
    if (fechaVencBody) {
      fechaVencimientoCalculada = new Date(fechaVencBody);
    } else {
      fechaVencimientoCalculada = new Date(ahora);
      fechaVencimientoCalculada.setDate(ahora.getDate() + 365);
    }

    if (reg) {
      reg.nombre = nombreLimpio;
      reg.rut = rut || reg.rut || 'SIN-RUT';
      reg.correo = correo || reg.correo || 'contacto@local.cl';
      if (password) reg.password = password;
      reg.activo = true;
      reg.fechaVencimiento = fechaVencimientoCalculada;
      await reg.save();
    } else {
      reg = new Local({
        id: Date.now(),
        local: localSlug,
        nombre: nombreLimpio,
        rut: rut || 'SIN-RUT',
        correo: correo || 'contacto@local.cl',
        password: password || '123456',
        activo: true,
        fechaCreacion: ahora,
        fechaVencimiento: fechaVencimientoCalculada,
        menu: [],
        anuncio: "ok"
      });
      await reg.save();
    }

    res.status(201).json({ mensaje: 'Alta realizada con éxito', local: reg.local, localId: reg.local, nombre: reg.nombre });
  } catch (error) {
    console.error("Error al dar de alta:", error);
    res.status(500).json({ error: 'Error interno al procesar el alta' });
  }
});

// CAMBIAR ESTADO ACTIVO/BLOQUEADO (SUPERADMIN)
app.put('/api/locales/estado', async (req, res) => {
  try {
    const { local, activo } = req.body;
    const reg = await Local.findOne({ local: (local || '').toLowerCase().trim() });
    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    reg.activo = Boolean(activo);
    await reg.save();

    res.json({ ok: true, mensaje: `Estado actualizado a ${reg.activo ? 'Activo' : 'Bloqueado'}`, activo: reg.activo });
  } catch (error) {
    res.status(500).json({ error: 'Error al cambiar estado' });
  }
});

// 6. VERIFICAR PASSWORD DE LOCAL
app.post('/api/locales/login', async (req, res) => {
  try {
    const { local, password } = req.body;
    const reg = await Local.findOne({ local: (local || '').toLowerCase().trim() });
    if (!reg) return res.status(404).json({ ok: false, error: 'Local no encontrado' });

    if (reg.password === password) {
      res.json({ ok: true, mensaje: 'Acceso autorizado' });
    } else {
      res.status(401).json({ ok: false, error: 'Contraseña incorrecta' });
    }
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Error al verificar credenciales' });
  }
});

// 7. MENÚ (Consultar estructurado)
app.get('/api/menu', async (req, res) => {
  try {
    const localId = (req.query.local || '').trim().toLowerCase();
    const reg = await Local.findOne({ local: localId });

    if (!reg) return res.json([]);
    if (reg.activo === false) return res.status(403).json({ error: 'Cuenta bloqueada' });

    res.json(reg.menu || []);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener el menú' });
  }
});

// AGREGAR CATEGORÍA A MENÚ
app.post('/api/menu/categoria', async (req, res) => {
  try {
    const { local, categoria } = req.body;
    const reg = await Local.findOne({ local: (local || '').toLowerCase().trim() });
    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    if (!reg.menu) reg.menu = [];
    const existe = reg.menu.some(c => c.categoria.toLowerCase() === categoria.trim().toLowerCase());
    if (!existe) {
      reg.menu.push({ categoria: categoria.trim(), productos: [] });
      await reg.save();
    }
    res.json({ ok: true, menu: reg.menu });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear la categoría' });
  }
});

// ELIMINAR CATEGORÍA
app.delete('/api/menu/categoria', async (req, res) => {
  try {
    const { local, categoria } = req.query;
    const reg = await Local.findOne({ local: (local || '').toLowerCase().trim() });
    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    reg.menu = (reg.menu || []).filter(c => c.categoria !== categoria);
    await reg.save();
    res.json({ ok: true, menu: reg.menu });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar la categoría' });
  }
});

// AGREGAR PRODUCTO A MENÚ
app.post('/api/menu', async (req, res) => {
  try {
    const { local, categoria, nombre, precio } = req.body;
    const reg = await Local.findOne({ local: (local || '').toLowerCase().trim() });
    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    const catObj = (reg.menu || []).find(c => c.categoria === categoria);
    if (catObj) {
      if (!catObj.productos) catObj.productos = [];
      catObj.productos.push({ nombre, precio: Number(precio) });
      reg.markModified('menu');
      await reg.save();
    }
    res.json({ ok: true, menu: reg.menu });
  } catch (error) {
    res.status(500).json({ error: 'Error al agregar producto' });
  }
});

// ELIMINAR PRODUCTO DE MENÚ
app.delete('/api/menu/del', async (req, res) => {
  try {
    const { local, categoria, index } = req.query;
    const reg = await Local.findOne({ local: (local || '').toLowerCase().trim() });
    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    const catObj = (reg.menu || []).find(c => c.categoria === categoria);
    if (catObj && catObj.productos) {
      catObj.productos.splice(Number(index), 1);
      reg.markModified('menu');
      await reg.save();
    }
    res.json({ ok: true, menu: reg.menu });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// EDITAR PRODUCTO DE MENÚ
app.put('/api/menu/edit', async (req, res) => {
  try {
    const { local, categoriaOriginal, indexOriginal, nuevoNombre, nuevoPrecio, nuevaCategoria } = req.body;
    const reg = await Local.findOne({ local: (local || '').toLowerCase().trim() });
    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    const catObj = (reg.menu || []).find(c => c.categoria === categoriaOriginal);
    if (catObj && catObj.productos && catObj.productos[indexOriginal]) {
      catObj.productos[indexOriginal] = { nombre: nuevoNombre, precio: Number(nuevoPrecio) };
      if (nuevaCategoria && nuevaCategoria !== categoriaOriginal) {
        const prodEditado = catObj.productos.splice(indexOriginal, 1)[0];
        let destinoCat = reg.menu.find(c => c.categoria === nuevaCategoria);
        if (!destinoCat) {
          destinoCat = { categoria: nuevaCategoria, productos: [] };
          reg.menu.push(destinoCat);
        }
        destinoCat.productos.push(prodEditado);
      }
      reg.markModified('menu');
      await reg.save();
    }
    res.json({ ok: true, menu: reg.menu });
  } catch (error) {
    res.status(500).json({ error: 'Error al editar producto' });
  }
});

// 8. PEDIDOS (Crear y Listar)
app.get('/api/pedidos', async (req, res) => {
  try {
    const localId = (req.query.local || '').trim().toLowerCase();
    const pedidos = await Pedido.find({ local: localId, estado: { $ne: 'entregado' } }).sort({ createdAt: -1 });
    res.json(pedidos);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener pedidos' });
  }
});

app.post('/api/pedidos', async (req, res) => {
  try {
    const { local, mesa, items, total } = req.body;
    const nuevoPedido = new Pedido({
      local: (local || '').toLowerCase().trim(),
      mesa: String(mesa),
      items: items || [],
      total: Number(total || 0),
      estado: 'pendiente'
    });
    await nuevoPedido.save();
    res.status(201).json({ ok: true, pedido: nuevoPedido });
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar pedido' });
  }
});

app.delete('/api/pedidos/:id', async (req, res) => {
  try {
    await Pedido.findByIdAndDelete(req.params.id);
    res.json({ ok: true, mensaje: 'Pedido eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar pedido' });
  }
});

// 9. HISTORIAL (Garzones y Entregas)
app.get('/api/historials', async (req, res) => {
  try {
    const localId = (req.query.local || '').trim().toLowerCase();
    const registros = await Historial.find({ local: localId }).sort({ createdAt: -1 });
    res.json(registros);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

app.post('/api/historials', async (req, res) => {
  try {
    const nuevoHistorial = new Historial(req.body);
    await nuevoHistorial.save();
    res.status(201).json({ ok: true, historial: nuevoHistorial });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar historial' });
  }
});

// 10. AVISOS Y MENSAJES DEL SISTEMA (OBTENER, CREAR, RESPONDER Y ELIMINAR)
app.get('/api/avisos', async (req, res) => {
  try {
    const localId = (req.query.local || '').trim().toLowerCase();
    let query = {};
    if (localId) {
      query = { $or: [{ destinatario: 'todos' }, { destinatario: localId }] };
    }
    const avisos = await Aviso.find(query).sort({ fecha: -1 });
    res.json(avisos);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los avisos' });
  }
});

app.post('/api/avisos', async (req, res) => {
  try {
    const { destinatario, asunto, texto } = req.body;
    if (!texto) return res.status(400).json({ error: 'El contenido del aviso es requerido' });

    const nuevoAviso = new Aviso({
      destinatario: (destinatario || 'todos').toLowerCase().trim(),
      asunto: asunto || 'Aviso del Sistema',
      texto,
      respuestas: []
    });
    await nuevoAviso.save();
    res.status(201).json({ ok: true, aviso: nuevoAviso });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar el aviso' });
  }
});

// RUTA PARA RESPONDER AVISO DESDE ADMIN.HTML
app.post('/api/avisos/responder', async (req, res) => {
  try {
    const { local, avisoId, respuesta } = req.body;
    if (!avisoId || !respuesta) {
      return res.status(400).json({ error: 'Parámetros incompletos' });
    }

    const aviso = await Aviso.findById(avisoId);
    if (!aviso) {
      return res.status(404).json({ error: 'Aviso no encontrado' });
    }

    aviso.respuestas.push({
      local: (local || 'desconocido').toLowerCase().trim(),
      texto: respuesta.trim(),
      fecha: new Date()
    });

    await aviso.save();
    res.json({ ok: true, mensaje: 'Respuesta guardada con éxito', aviso });
  } catch (error) {
    console.error("Error al responder aviso:", error);
    res.status(500).json({ error: 'Error interno al guardar la respuesta' });
  }
});

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
