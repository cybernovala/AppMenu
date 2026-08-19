const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Brevo = require('@getbrevo/brevo');

const app = express();

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json());

// --- CONFIGURACIÓN DE BREVO ---
const apiInstance = new Brevo.TransactionalEmailsApi();
if (process.env.BREVO_API_KEY) {
  apiInstance.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
}

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

// 3. CONSULTAR LICENCIA Y ESTADO DE LOCAL (CON VALIDACIÓN Y RENOVACIÓN SERVIDOR)
app.get('/api/licencia', async (req, res) => {
  try {
    const localId = (req.query.local || '').trim().toLowerCase();
    if (!localId) return res.status(400).json({ error: 'Parámetro local requerido' });

    const reg = await Local.findOne({ local: localId });
    if (!reg) {
      return res.json({ activo: true, nombre: localId, altaRegistrada: false, diasRestantes: 30 });
    }

    const ahoraServidor = new Date();
    let fechaVenc = reg.fechaVencimiento ? new Date(reg.fechaVencimiento) : new Date(ahoraServidor.getTime() + (30 * 24 * 60 * 60 * 1000));
    let estadoActivo = reg.activo;

    // Verificar si ha vencido la fecha en el servidor
    if (ahoraServidor >= fechaVenc) {
      estadoActivo = false;
      if (reg.activo !== false) {
        reg.activo = false;
        await reg.save();
      }
    }

    const diferenciaMs = fechaVenc.getTime() - ahoraServidor.getTime();
    const diasRestantes = Math.max(0, Math.ceil(diferenciaMs / (1000 * 60 * 60 * 24)));

    const esAltaOficial = Boolean(reg.rut && reg.rut !== 'DEMO-30DIAS' && reg.rut !== 'SIN-RUT');

    return res.json({
      activo: estadoActivo,
      nombre: reg.nombre,
      fechaCreacion: reg.fechaCreacion,
      fechaVencimiento: reg.fechaVencimiento,
      diasRestantes: diasRestantes,
      servidorAhora: ahoraServidor,
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

// CREAR/REGISTRAR DEMO
app.post('/api/locales/demo', async (req, res) => {
  try {
    const { local, nombre, rut, correo, fechaCreacion, fechaVencimiento } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es requerido' });

    const localSlug = (local || nombre).toLowerCase().replace(/[^a-z0-9]/g, '');
    let reg = await Local.findOne({ local: localSlug });

    const ahora = fechaCreacion ? new Date(fechaCreacion) : new Date();
    const venc = fechaVencimiento ? new Date(fechaVencimiento) : new Date(ahora.getTime() + (30 * 24 * 60 * 60 * 1000));

    if (reg) {
      reg.nombre = nombre;
      reg.activo = true;
      reg.fechaVencimiento = venc;
      await reg.save();
    } else {
      reg = new Local({
        id: Date.now(),
        local: localSlug,
        nombre: nombre.trim(),
        rut: rut || 'DEMO-30DIAS',
        correo: correo || 'demo@appmenu.cl',
        password: '123',
        activo: true,
        fechaCreacion: ahora,
        fechaVencimiento: venc,
        menu: [],
        anuncio: "ok"
      });
      await reg.save();
    }

    res.status(201).json({ ok: true, local: reg });
  } catch (error) {
    console.error("Error al crear demo:", error);
    res.status(500).json({ error: 'Error al registrar demo' });
  }
});

// 5. DAR DE ALTA O RENOVAR UN RESTAURANTE (SUMA 30 DÍAS DE EXPIRACIÓN)
app.post('/api/locales/alta', async (req, res) => {
  try {
    const { local: localParam, nombre, rut, correo, password, fechaVencimiento: fechaVencBody, renovar30Dias } = req.body;
    
    let localSlug = localParam ? localParam.toLowerCase().trim() : '';
    let nombreLimpio = nombre ? nombre.trim() : '';

    if (!localSlug && nombreLimpio) {
      localSlug = nombreLimpio.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    if (!localSlug && !nombreLimpio) {
      return res.status(400).json({ error: 'El identificador o nombre es obligatorio' });
    }

    let reg = await Local.findOne({
      $or: [
        { local: localSlug },
        ...(nombreLimpio ? [{ nombre: { $regex: new RegExp(`^${escapeRegex(nombreLimpio)}$`, 'i') } }] : [])
      ]
    });

    const ahora = new Date();
    let fechaVencimientoCalculada;

    if (renovar30Dias && reg && reg.fechaVencimiento) {
      const baseFecha = new Date(reg.fechaVencimiento) > ahora ? new Date(reg.fechaVencimiento) : ahora;
      fechaVencimientoCalculada = new Date(baseFecha);
      fechaVencimientoCalculada.setDate(fechaVencimientoCalculada.getDate() + 30);
    } else if (fechaVencBody) {
      fechaVencimientoCalculada = new Date(fechaVencBody);
    } else {
      fechaVencimientoCalculada = new Date(ahora);
      fechaVencimientoCalculada.setDate(ahora.getDate() + 30);
    }

    const passwordFinal = password || (reg ? reg.password : '123456');

    if (reg) {
      if (nombreLimpio) reg.nombre = nombreLimpio;
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
        nombre: nombreLimpio || localSlug,
        rut: rut || 'SIN-RUT',
        correo: correo || 'contacto@local.cl',
        password: passwordFinal,
        activo: true,
        fechaCreacion: ahora,
        fechaVencimiento: fechaVencimientoCalculada,
        menu: [],
        anuncio: "ok"
      });
      await reg.save();
    }

    // --- ENVIAR CORREO CON BREVO ---
    const destinoCorreo = reg.correo;
    if (destinoCorreo && destinoCorreo !== 'contacto@local.cl' && process.env.BREVO_API_KEY) {
      try {
        const sendSmtpEmail = new Brevo.SendSmtpEmail();
        sendSmtpEmail.subject = `🎉 ¡Bienvenido a AppMenu! Datos de tu Demo: ${reg.nombre}`;
        sendSmtpEmail.htmlContent = `
          <div style="font-family: Arial, sans-serif; background-color: #08070d; color: #ffffff; padding: 20px; border-radius: 10px;">
            <h2 style="color: #ff5500;">¡Hola, ${reg.nombre}!</h2>
            <p>Tu cuenta y entorno demo han sido creados/actualizados exitosamente en nuestra plataforma.</p>
            <p><strong>Detalles de acceso a tu panel:</strong></p>
            <ul>
              <li><strong>Local / ID:</strong> ${reg.local}</li>
              <li><strong>Contraseña:</strong> ${passwordFinal}</li>
              <li><strong>Fecha de Vencimiento:</strong> ${new Date(reg.fechaVencimiento).toLocaleDateString()}</li>
            </ul>
            <p>Puedes acceder a tu panel de administración en el siguiente enlace:</p>
            <a href="https://appmenu-990c3.web.app/admin.html?local=${encodeURIComponent(reg.local)}" 
               style="background-color: #ff007f; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
               Ingresar a mi Administración
            </a>
            <br><br>
            <p style="font-size: 12px; color: #a0a0b0;">Soporte: +56966648585 | appmenu26@gmail.com</p>
          </div>
        `;
        sendSmtpEmail.sender = { name: "AppMenu Digital", email: "appmenu26@gmail.com" };
        sendSmtpEmail.to = [{ email: destinoCorreo, name: reg.nombre }];

        const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
        console.log("🟢 Correo enviado exitosamente vía Brevo:", data);
      } catch (errBrevo) {
        console.error("🔴 Error al enviar correo con Brevo:", errBrevo);
      }
    }

    res.status(201).json({ mensaje: 'Alta/Renovación realizada con éxito', local: reg.local, localId: reg.local, nombre: reg.nombre, fechaVencimiento: reg.fechaVencimiento });
  } catch (error) {
    console.error("Error al dar de alta:", error);
    res.status(500).json({ error: 'Error interno al procesar la alta/renovación' });
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

// 6.B RECUPERAR CONTRASEÑA DE LOCAL
app.post('/api/locales/recuperar-password', async (req, res) => {
  try {
    const { local, correo } = req.body;
    if (!local) return res.status(400).json({ ok: false, error: 'El identificador del local es requerido' });

    const localId = local.toLowerCase().trim();
    const reg = await Local.findOne({ local: localId });

    if (!reg) {
      return res.status(404).json({ ok: false, error: 'Local no encontrado' });
    }

    const destinoCorreo = (correo || reg.correo || '').trim();
    if (!destinoCorreo || destinoCorreo === 'contacto@local.cl') {
      return res.status(400).json({ ok: false, error: 'El local no tiene un correo válido registrado' });
    }

    if (process.env.BREVO_API_KEY) {
      const sendSmtpEmail = new Brevo.SendSmtpEmail();
      sendSmtpEmail.subject = `🔑 Recuperación de contraseña: ${reg.nombre}`;
      sendSmtpEmail.htmlContent = `
        <div style="font-family: Arial, sans-serif; background-color: #08070d; color: #ffffff; padding: 20px; border-radius: 10px;">
          <h2 style="color: #ff5500;">Recuperación de Clave</h2>
          <p>Has solicitado los datos de acceso para tu local <strong>${reg.nombre}</strong>.</p>
          <p><strong>Tus datos de acceso:</strong></p>
          <ul>
            <li><strong>Local / ID:</strong> ${reg.local}</li>
            <li><strong>Contraseña:</strong> ${reg.password}</li>
          </ul>
          <p>Puedes ingresar directamente en el siguiente botón:</p>
          <a href="https://appmenu-990c3.web.app/admin.html?local=${encodeURIComponent(reg.local)}" 
             style="background-color: #ff007f; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
             Ir al Panel Administrador
          </a>
          <br><br>
          <p style="font-size: 12px; color: #a0a0b0;">Soporte: +56966648585 | appmenu26@gmail.com</p>
        </div>
      `;
      sendSmtpEmail.sender = { name: "AppMenu Digital", email: "appmenu26@gmail.com" };
      sendSmtpEmail.to = [{ email: destinoCorreo, name: reg.nombre }];

      await apiInstance.sendTransacEmail(sendSmtpEmail);
    }

    res.json({ ok: true, mensaje: 'Se ha enviado la contraseña al correo asociado' });
  } catch (error) {
    console.error("Error al recuperar contraseña:", error);
    res.status(500).json({ ok: false, error: 'Error interno al procesar la recuperación' });
  }
});

// 7. MENÚ (Consultar estructurado)
app.get('/api/menu', async (req, res) => {
  try {
    const localId = (req.query.local || '').trim().toLowerCase();
    const reg = await Local.findOne({ local: localId });

    if (!reg) return res.json([]);
    
    // Verificar estado o vencimiento
    const ahoraServidor = new Date();
    if (reg.activo === false || (reg.fechaVencimiento && ahoraServidor >= new Date(reg.fechaVencimiento))) {
      return res.status(403).json({ error: 'Cuenta bloqueada o licencia expirada' });
    }

    res.json(reg.menu || []);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener el menú' });
  }
});

// AGREGAR CATEGORÍA A MENÚ
app.post('/api/menu/categoria', async (req, res) => {
  try {
    const { local, categoria } = req.body;
    if (!categoria || !categoria.trim()) return res.status(400).json({ error: 'Nombre de categoría requerido' });

    const reg = await Local.findOne({ local: (local || '').toLowerCase().trim() });
    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    if (!reg.menu) reg.menu = [];
    const existe = reg.menu.some(c => c.categoria.toLowerCase() === categoria.trim().toLowerCase());
    if (!existe) {
      reg.menu.push({ categoria: categoria.trim(), productos: [] });
      reg.markModified('menu');
      await reg.save();
    }
    res.json({ ok: true, menu: reg.menu });
  } catch (error) {
    console.error("Error al crear categoría:", error);
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
    reg.markModified('menu');
    await reg.save();
    res.json({ ok: true, menu: reg.menu });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar la categoría' });
  }
});

// ACTUALIZAR O GUARDAR ESTRUCTURA COMPLETA DE MENÚ / AGREGAR PRODUCTO
app.post('/api/menu', async (req, res) => {
  try {
    const { local, menu, categoria, nombre, precio } = req.body;
    const reg = await Local.findOne({ local: (local || '').toLowerCase().trim() });
    if (!reg) return res.status(404).json({ error: 'Local no encontrado' });

    if (Array.isArray(menu)) {
      reg.menu = menu;
      reg.markModified('menu');
      await reg.save();
      return res.json({ ok: true, menu: reg.menu });
    }

    if (categoria && nombre) {
      if (!reg.menu) reg.menu = [];
      let catObj = reg.menu.find(c => c.categoria === categoria);
      if (!catObj) {
        catObj = { categoria, productos: [] };
        reg.menu.push(catObj);
      }
      if (!catObj.productos) catObj.productos = [];
      catObj.productos.push({ nombre, precio: Number(precio || 0) });
      reg.markModified('menu');
      await reg.save();
      return res.json({ ok: true, menu: reg.menu });
    }

    res.status(400).json({ error: 'Parámetros no válidos' });
  } catch (error) {
    console.error("Error al guardar en el menú:", error);
    res.status(500).json({ error: 'Error al actualizar el menú' });
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

// 10. AVISOS Y MENSAJES DEL SISTEMA
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

// PUERTO DINÁMICO DEL SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`);
});